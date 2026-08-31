package table

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/aspectrr/online-poker/server/internal/engine"
	"github.com/aspectrr/online-poker/server/internal/protocol"
	"github.com/aspectrr/online-poker/server/internal/store"
	"github.com/aspectrr/online-poker/server/internal/ws"
)

func testTable(t *testing.T, timeoutSecs, interHand int) *Table {
	t.Helper()
	row := store.GameTable{
		ID:       "t1",
		Name:     "test",
		GameType: "NLHE",
		Config: store.TableConfig{
			BlindsSBBB:      []int64{50, 100},
			StartingStackBB: 100,
			ActionTimeoutS:  timeoutSecs,
			InterHandDelayS: interHand,
			MaxSeats:        4,
		},
	}
	tbl := New(row, nil, false)
	t.Cleanup(tbl.Close)
	return tbl
}

// connect: attach a test client and take a seat.
func connect(t *testing.T, tbl *Table, userID string, seat int) *ws.Client {
	t.Helper()
	c := ws.NewTestClient(userID)
	tbl.Attach(c)
	waitProcessed(t, tbl)
	tbl.Send(c, protocol.ClientMsg{Type: "join", Seat: seat})
	waitProcessed(t, tbl)
	return c
}

// waitProcessed: nudge a no-op through the inbox; when it lands, prior
// messages were handled. Uses the inbox being buffered + actor loop.
func waitProcessed(t *testing.T, tbl *Table) {
	t.Helper()
	done := make(chan struct{})
	// send a detach of a nil client — handled instantly, but ordering
	// guarantees everything before it is done.
	go func() {
		tbl.inbox <- inbox{client: ws.NewTestClient("nobody"), msg: protocol.ClientMsg{Type: "__detach"}}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("table actor stalled")
	}
	time.Sleep(10 * time.Millisecond) // let handler finish
}

// drain: read all queued messages from a test client.
func drain(c *ws.Client) []protocol.ServerMsg {
	var out []protocol.ServerMsg
	for _, data := range c.RecvMsgs() {
		var m protocol.ServerMsg
		json.Unmarshal(data, &m)
		out = append(out, m)
	}
	return out
}

func findEvent(msgs []protocol.ServerMsg, typ protocol.EventType) *protocol.Event {
	for i := range msgs {
		if msgs[i].Type == "event" && msgs[i].Event != nil && msgs[i].Event.Type == typ {
			return msgs[i].Event
		}
	}
	return nil
}

// TestHubBroadcast: two seated clients + observer all receive the same
// public event; seat-join broadcasts reach everyone.
func TestHubBroadcast(t *testing.T) {
	tbl := testTable(t, 0, 300) // no timeout, no auto next hand
	a := connect(t, tbl, "userA", 0)
	b := connect(t, tbl, "userB", 1)
	waitProcessed(t, tbl)

	// both joined: everyone saw 2 seats broadcasts + own state snapshot
	msgsB := drain(b)
	seatBroadcasts := 0
	for _, m := range msgsB {
		if m.Type == "seats" && len(m.Seats) == 4 && m.Seats[0].Player != "" {
			seatBroadcasts++
		}
	}
	if seatBroadcasts < 1 {
		t.Fatalf("seat B never saw seat A join: %+v", msgsB)
	}

	// chat broadcasts to all
	tbl.Send(a, protocol.ClientMsg{Type: "chat", Text: "hello"})
	waitProcessed(t, tbl)
	for _, c := range []*ws.Client{a, b} {
		found := false
		for _, m := range drain(c) {
			if m.Type == "chat" && m.Chat != nil && m.Chat.Text == "hello" {
				found = true
			}
		}
		if !found {
			t.Fatal("chat not broadcast")
		}
	}
}

// TestHoleCardRedaction: seat B never receives seat A's hole cards.
func TestHoleCardRedaction(t *testing.T) {
	tbl := testTable(t, 0, 300)
	a := connect(t, tbl, "userA", 0)
	b := connect(t, tbl, "userB", 1)
	waitProcessed(t, tbl)

	// trigger hand start
	tbl.Send(nil, protocol.ClientMsg{Type: "__start_hand"})
	waitProcessed(t, tbl)

	msgsA, msgsB := drain(a), drain(b)
	started := findEvent(msgsA, protocol.EvHandStarted)
	if started == nil {
		t.Fatalf("no hand_started: %+v", msgsA)
	}
	holesA := findEvent(msgsA, protocol.EvHolesDealt)
	if holesA == nil || len(holesA.Cards) != 2 {
		t.Fatalf("seat A never got private holes: %+v", msgsA)
	}
	holesB := findEvent(msgsB, protocol.EvHolesDealt)
	if holesB == nil || len(holesB.Cards) != 2 {
		t.Fatalf("seat B never got private holes: %+v", msgsB)
	}
	if holesA.Cards[0] == holesB.Cards[0] && holesA.Cards[1] == holesB.Cards[1] {
		t.Fatal("same cards delivered to both seats?")
	}
	// B's holes_dealt must carry B's seat, never A's cards
	if holesB.Seat != 1 {
		t.Fatalf("B got holes for seat %d", holesB.Seat)
	}
	// any event with cards delivered to B must not equal A's holes
	for _, m := range msgsB {
		if m.Type == "event" && m.Event != nil && m.Event.Type == protocol.EvHolesDealt {
			if m.Event.Seat != 1 {
				t.Fatalf("B received holes for seat %d", m.Event.Seat)
			}
		}
	}
}

// TestTimeoutAutoAction: timeout folds/checks for the actor.
func TestTimeoutAutoAction(t *testing.T) {
	tbl := testTable(t, 5, 300) // 5s action timeout... too slow; we test the
	// timeout path by invoking __timeout directly with a short config.
	tbl.cfg.ActionTimeoutSecs = 1
	a := connect(t, tbl, "userA", 0)
	b := connect(t, tbl, "userB", 1)
	waitProcessed(t, tbl)
	tbl.Send(nil, protocol.ClientMsg{Type: "__start_hand"})
	waitProcessed(t, tbl)

	// whose turn? engine: HU button=SB acts first preflop; button starts 0.
	la := tbl.runner.LegalActionsFor()
	if la == nil {
		t.Fatal("no actor after hand start")
	}
	seatNo := la.Seat
	drain(a)
	drain(b)

	// fire timeout for the actor
	tbl.Send(nil, protocol.ClientMsg{Type: "__timeout", Seat: seatNo})
	waitProcessed(t, tbl)

	// the actor's seat must show an accepted auto action (fold or check)
	var saw bool
	for _, m := range drain(a) {
		if m.Type == "event" && m.Event != nil && m.Event.Type == protocol.EvActionAccepted && m.Event.Seat == seatNo {
			saw = true
		}
	}
	for _, m := range drain(b) {
		if m.Type == "event" && m.Event != nil && m.Event.Type == protocol.EvActionAccepted && m.Event.Seat == seatNo {
			saw = true
		}
	}
	if !saw {
		t.Fatal("timeout did not produce an auto action")
	}
	// fold in HU ends the hand (uncontested win): runner nil, next hand scheduled
	if tbl.runner != nil {
		t.Fatal("hand still live after fold")
	}
}

// TestTimeoutAutoCheck: when check is free, timeout checks not folds.
func TestTimeoutAutoCheck(t *testing.T) {
	tbl := testTable(t, 0, 300)
	a := connect(t, tbl, "userA", 0)
	b := connect(t, tbl, "userB", 1)
	waitProcessed(t, tbl)
	tbl.Send(nil, protocol.ClientMsg{Type: "__start_hand"})
	waitProcessed(t, tbl)

	// seat 0 is SB/button HU: acts first preflop, faces a call.
	// Have seat 0 call, then seat 1 (BB) faces no bet → check available.
	la := tbl.runner.LegalActionsFor()
	first := la.Seat
	tbl.advance(&(engine.Action{Seat: first, Kind: engine.Call}), nil)
	waitProcessed(t, tbl)
	la = tbl.runner.LegalActionsFor()
	if la == nil || la.Seat == first {
		// hand may have run out (both called → flop). If flop actor exists:
		if la == nil {
			t.Skip("hand ran to showdown on call/call — engine dealt it out")
		}
	}
	next := la.Seat
	drain(a)
	drain(b)
	tbl.Send(nil, protocol.ClientMsg{Type: "__timeout", Seat: next})
	waitProcessed(t, tbl)
	var kind string
	for _, m := range drain(a) {
		if m.Type == "event" && m.Event != nil && m.Event.Type == protocol.EvActionAccepted && m.Event.Seat == next {
			kind = m.Event.Action.Kind.String()
		}
	}
	if kind != "check" {
		t.Fatalf("timeout with free check produced %q, want check", kind)
	}
}

// bomb_pot msg arms the next hand + broadcasts bomb_pot_armed to everyone.
func TestArmBombPotBroadcasts(t *testing.T) {
	tbl := testTable(t, 0, 0)
	a := connect(t, tbl, "uid-a", 0)
	b := connect(t, tbl, "uid-b", 1)
	tbl.Send(a, protocol.ClientMsg{Type: "bomb_pot"})
	waitProcessed(t, tbl)
	msgs := drain(a)
	found := false
	for _, m := range msgs {
		if m.Type == "event" && m.Event != nil && m.Event.Type == protocol.EvBombPotArmed {
			found = true
		}
	}
	if !found {
		t.Fatal("armBombPot should broadcast bomb_pot_armed")
	}
	msgs = drain(b)
	for _, m := range msgs {
		if m.Type == "event" && m.Event != nil && m.Event.Type == protocol.EvBombPotArmed {
			_ = m
			return
		}
	}
	t.Fatal("seat b should also receive bomb_pot_armed")
}

// snapshot carries bomb_pot_next while armed.
func TestSnapshotBombPotNext(t *testing.T) {
	tbl := testTable(t, 0, 0)
	a := connect(t, tbl, "uid-a", 0)
	tbl.Send(a, protocol.ClientMsg{Type: "bomb_pot"})
	waitProcessed(t, tbl)
	drain(a)
	snap := tbl.snapshotFor(0)
	if !snap.BombPotNext {
		t.Fatal("snapshot should carry bomb_pot_next=true while armed")
	}
}

// dev_deal is rejected on non-dev tables.
func TestDevDealGated(t *testing.T) {
	tbl := testTable(t, 0, 0)
	a := connect(t, tbl, "uid-a", 0)
	tbl.Send(a, protocol.ClientMsg{Type: "dev_deal", Seat: 0, Cards: []engine.Card{0, 1}})
	waitProcessed(t, tbl)
	for _, m := range drain(a) {
		if m.Type == "error" && strings.Contains(m.Error, "DEV_AUTH") {
			return
		}
	}
	t.Fatal("dev_deal on non-dev table should error")
}

// TestJoinStack: requested buy-in is honored and clamped; 0 = table default.
func TestJoinStack(t *testing.T) {
	tbl := testTable(t, 0, 300) // 50/100 blinds, 100bb default = 10000
	c := ws.NewTestClient("userS")
	tbl.Attach(c)
	waitProcessed(t, tbl)

	if got := tbl.joinStack(0); got != 10000 {
		t.Fatalf("default stack = %d, want 10000", got)
	}
	if got := tbl.joinStack(2500); got != 2500 {
		t.Fatalf("requested stack = %d, want 2500", got)
	}
	if got := tbl.joinStack(50); got != 100 { // below 1bb -> clamped to bb
		t.Fatalf("sub-bb stack = %d, want 100", got)
	}
	if got := tbl.joinStack(999_999_999); got != 100_000 { // above 1000bb -> clamped
		t.Fatalf("huge stack = %d, want 100000", got)
	}
}
