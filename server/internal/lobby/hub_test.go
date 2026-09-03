package lobby

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/aspectrr/online-poker/server/internal/protocol"
	"github.com/aspectrr/online-poker/server/internal/ws"
)

func testRows(seated int) []protocol.LobbyTable {
	return []protocol.LobbyTable{{ID: "t1", Name: "Test", GameType: "NLHE", SmallBlind: 10, BigBlind: 20, MaxSeats: 9, Seated: seated}}
}

func decodeLobby(t *testing.T, c *ws.Client) []protocol.LobbyTable {
	t.Helper()
	msgs := c.RecvMsgs()
	if len(msgs) == 0 {
		t.Fatalf("no messages queued")
	}
	var m protocol.ServerMsg
	if err := json.Unmarshal(msgs[len(msgs)-1], &m); err != nil {
		t.Fatalf("bad frame: %v", err)
	}
	if m.Type != "lobby" {
		t.Fatalf("want type lobby, got %q", m.Type)
	}
	return m.Lobby
}

func TestHubAttachSendsSnapshot(t *testing.T) {
	h := NewHub()
	c := ws.NewTestClient("")
	h.Attach(c, func() []protocol.LobbyTable { return testRows(3) })
	got := decodeLobby(t, c)
	if len(got) != 1 || got[0].Seated != 3 {
		t.Fatalf("want snapshot seated=3, got %+v", got)
	}
}

func TestHubBroadcastsOnChangeOnly(t *testing.T) {
	h := NewHub()
	seated := 0
	snap := func() []protocol.LobbyTable { return testRows(seated) }
	c := ws.NewTestClient("")
	h.Attach(c, snap)

	stop := make(chan struct{})
	go h.Run(snap, 5*time.Millisecond, stop)
	defer close(stop)

	// RecvMsgs drains, so count cumulatively.
	total := 0
	frames := func() int {
		total += len(c.RecvMsgs())
		return total
	}

	// same snapshot: no second frame
	time.Sleep(20 * time.Millisecond)
	if n := frames(); n != 1 {
		t.Fatalf("want 1 frame for unchanged snapshot, got %d", n)
	}

	// change: exactly one new frame
	seated = 2
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if frames() > 1 {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	if n := frames(); n != 2 {
		t.Fatalf("want 2 frames after change, got %d", n)
	}
}

func TestHubDetachStopsBroadcasts(t *testing.T) {
	h := NewHub()
	seated := 0
	snap := func() []protocol.LobbyTable { return testRows(seated) }
	c := ws.NewTestClient("")
	h.Attach(c, snap)
	h.Detach(c)

	seated = 5
	stop := make(chan struct{})
	go h.Run(snap, 5*time.Millisecond, stop)
	defer close(stop)
	time.Sleep(20 * time.Millisecond)
	if n := len(c.RecvMsgs()); n != 1 {
		t.Fatalf("detached client got extra frames: %d", n)
	}
}
