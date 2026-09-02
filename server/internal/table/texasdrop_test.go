package table

import (
	"testing"
	"time"

	"github.com/aspectrr/online-poker/server/internal/protocol"
	"github.com/aspectrr/online-poker/server/internal/store"
)

// texas_drop msg arms the next hand + broadcasts texas_drop_armed; snapshot
// carries texas_drop_next.
func TestArmTexasDrop(t *testing.T) {
	tbl := testTable(t, 0, 0)
	a := connect(t, tbl, "uid-a", 0)
	tbl.Send(a, protocol.ClientMsg{Type: "texas_drop"})
	waitProcessed(t, tbl)
	found := false
	for _, m := range drain(a) {
		if m.Type == "event" && m.Event != nil && m.Event.Type == protocol.EvTexasDropArmed {
			found = true
		}
	}
	if !found {
		t.Fatal("armTexasDrop should broadcast texas_drop_armed")
	}
	if snap := tbl.snapshotFor(0); !snap.TexasDropNext {
		t.Fatal("snapshot should carry texas_drop_next=true while armed")
	}

	// arming twice is a no-op; snapshot still armed
	tbl.Send(a, protocol.ClientMsg{Type: "texas_drop"})
	waitProcessed(t, tbl)
	drain(a)
	if snap := tbl.snapshotFor(0); !snap.TexasDropNext {
		t.Fatal("snapshot lost armed flag")
	}
}

// Ante default: 2.5×BB (50¢ at 10/20) when the table has none configured.
func TestTexasDropAnteDefault(t *testing.T) {
	row := store.GameTable{ID: "x", GameType: "NLHE", Config: store.TableConfig{
		BlindsSBBB: []int64{50, 100},
	}}
	if cfg := engineConfig(row); cfg.TexasDropAnte != 250 {
		t.Fatalf("ante default = %d, want 250 (2.5×BB)", cfg.TexasDropAnte)
	}
	row.Config.TexasDropAnte = 123
	if cfg := engineConfig(row); cfg.TexasDropAnte != 123 {
		t.Fatalf("stored ante = %d, want 123", cfg.TexasDropAnte)
	}
}

// Full drop game through the table actor: stay/drop actions drive rounds,
// the private drop_decided ack goes only to the decider, and the game ends
// with a pot award + hand_ended.
func TestTexasDropGameOnTable(t *testing.T) {
	tbl := testTable(t, 0, 50)
	a := connect(t, tbl, "uid-a", 0)
	b := connect(t, tbl, "uid-b", 1)
	c := connect(t, tbl, "uid-c", 2)
	drain(a)
	drain(b)
	drain(c)

	// arm the drop game, then start the hand directly (skips the 3s fill delay)
	tbl.Send(a, protocol.ClientMsg{Type: "texas_drop"})
	waitProcessed(t, tbl)
	drain(a)
	tbl.Send(nil, protocol.ClientMsg{Type: "__start_hand"})
	waitProcessed(t, tbl)
	if ev := findEvent(drain(a), protocol.EvDropDecide); ev == nil || ev.Round != 1 {
		t.Fatal("no round-1 drop_decide for seat a")
	}
	if snap := tbl.snapshotFor(0); !snap.TexasDrop || snap.DropRound != 1 || snap.DropWaiting != 3 {
		t.Fatalf("snapshot drop state: texas_drop=%v round=%d waiting=%d",
			snap.TexasDrop, snap.DropRound, snap.DropWaiting)
	}

	// everyone drops round 1 -> re-ante, round 2
	tbl.Send(a, protocol.ClientMsg{Type: "action", Kind: "drop"})
	waitProcessed(t, tbl)
	tbl.Send(b, protocol.ClientMsg{Type: "action", Kind: "drop"})
	waitProcessed(t, tbl)
	tbl.Send(c, protocol.ClientMsg{Type: "action", Kind: "drop"})
	waitProcessed(t, tbl)

	sawAck, sawReveal, sawRound2 := false, false, false
	for _, m := range drain(c) {
		if m.Type != "event" || m.Event == nil {
			continue
		}
		switch m.Event.Type {
		case protocol.EvDropDecided:
			if m.Event.Seat == 2 {
				sawAck = true
			} else {
				t.Fatalf("seat c received another seat's ack: %+v", m.Event)
			}
		case protocol.EvDropReveal:
			sawReveal = true
		case protocol.EvDropDecide:
			if m.Event.Round == 2 {
				sawRound2 = true
			}
		}
	}
	if !sawAck || !sawReveal || !sawRound2 {
		t.Fatalf("ack=%v reveal=%v round2=%v", sawAck, sawReveal, sawRound2)
	}
	// seat a may see its own ack but NOT seats b/c's
	for _, m := range drain(a) {
		if m.Type == "event" && m.Event != nil && m.Event.Type == protocol.EvDropDecided && m.Event.Seat != 0 {
			t.Fatalf("seat a saw seat %d's ack", m.Event.Seat)
		}
	}

	// round 2: a stays alone -> sole stayer takes the pot, game ends
	tbl.Send(b, protocol.ClientMsg{Type: "action", Kind: "drop"})
	waitProcessed(t, tbl)
	tbl.Send(c, protocol.ClientMsg{Type: "action", Kind: "drop"})
	waitProcessed(t, tbl)
	tbl.Send(a, protocol.ClientMsg{Type: "action", Kind: "stay"})
	waitProcessed(t, tbl)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		var awarded, ended bool
		for _, m := range drain(a) {
			if m.Type == "event" && m.Event != nil {
				if m.Event.Type == protocol.EvPotAwarded {
					awarded = true
				}
				if m.Event.Type == protocol.EvHandEnded {
					ended = true
				}
			}
		}
		if awarded && ended {
			if snap := tbl.snapshotFor(0); snap.TexasDrop {
				t.Fatal("snapshot still flags texas_drop after the game ended")
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("drop game did not finish")
}

// junk action kinds are rejected.
func TestActionKindParsing(t *testing.T) {
	tbl := testTable(t, 0, 0)
	a := connect(t, tbl, "uid-a", 0)
	b := connect(t, tbl, "uid-b", 1)
	drain(a)
	drain(b)
	tbl.Send(nil, protocol.ClientMsg{Type: "__start_hand"})
	waitProcessed(t, tbl)
	drain(a)
	tbl.Send(a, protocol.ClientMsg{Type: "action", Kind: "snooze"})
	waitProcessed(t, tbl)
	for _, m := range drain(a) {
		if m.Type == "error" && m.Error == "unknown action kind" {
			return
		}
	}
	t.Fatal("junk action kind should error")
}

// decision timeout auto-drops everyone who hasn't chosen; the round
// resolves into the nobody-stayed re-ante path.
func TestDropDecisionTimeout(t *testing.T) {
	tbl := testTable(t, 1, 0) // 1s decision timeout
	a := connect(t, tbl, "uid-a", 0)
	b := connect(t, tbl, "uid-b", 1)
	drain(a)
	drain(b)
	tbl.Send(a, protocol.ClientMsg{Type: "texas_drop"})
	waitProcessed(t, tbl)
	drain(a)
	tbl.Send(nil, protocol.ClientMsg{Type: "__start_hand"})
	waitProcessed(t, tbl)
	drain(a)
	if snap := tbl.snapshotFor(0); !snap.TexasDrop {
		t.Fatal("hand should be a drop game")
	}
	// wait past the 1s decision clock; nobody acts -> all auto-drop -> re-ante
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		found := false
		for _, m := range drain(a) {
			if m.Type == "event" && m.Event != nil &&
				m.Event.Type == protocol.EvDropDecide && m.Event.Round == 2 {
				found = true
			}
		}
		if found {
			return // round 2 opened via timeout auto-drops + re-ante
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("timeout did not auto-drop into round 2")
}
