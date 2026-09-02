package table

import (
	"testing"

	"github.com/aspectrr/online-poker/server/internal/ws"
)

// TestTopUp: queue rules + credit at the next hand start, never mid-hand.
func TestTopUp(t *testing.T) {
	tbl := testTable(t, 1, 1)
	c := connect(t, tbl, "userA", 0)
	s := tbl.seats[0]
	if s.stack != 100*100 {
		t.Fatalf("expected 100bb start stack, got %d", s.stack)
	}

	// above 100bb: refused
	tbl.topUp(c)
	if s.pendingTopUp != 0 {
		t.Fatal("top-up should be refused above 100bb")
	}

	// below 100bb: queued, not credited yet
	s.stack = 40 * 100
	tbl.topUp(c)
	if s.pendingTopUp != 100*100 {
		t.Fatalf("expected 100bb queued, got %d", s.pendingTopUp)
	}
	if s.stack != 40*100 || s.rebuys != 0 {
		t.Fatal("top-up must not credit mid-hand")
	}

	// cap: 3 total
	s.stack = 0
	tbl.topUp(c)
	tbl.topUp(c)
	if s.rebuys != 0 || len(tbl.seats[0:1]) != 1 {
		t.Fatal("unexpected state before hand start")
	}
	// queue is single: second request while queued is a no-op
	if s.pendingTopUp != 100*100 {
		t.Fatalf("expected single queued top-up, got %d", s.pendingTopUp)
	}

	// credit lands at the next hand start
	tbl.startHand()
	if s.rebuys != 1 {
		t.Fatalf("expected 1 rebuy used, got %d", s.rebuys)
	}
	if s.pendingTopUp != 0 {
		t.Fatal("queue should be consumed at hand start")
	}
	if s.stack != 100*100 {
		t.Fatalf("expected stack topped to 100bb, got %d", s.stack)
	}

	// limit: burn the remaining two, then refused
	for i := 0; i < 2; i++ {
		s.stack = 0
		tbl.topUp(c)
		tbl.startHand()
	}
	if s.rebuys != 3 {
		t.Fatalf("expected 3 rebuys used, got %d", s.rebuys)
	}
	s.stack = 0
	tbl.topUp(c)
	if s.pendingTopUp != 0 {
		t.Fatal("top-up past the cap must be refused")
	}

	// fresh occupant: bookkeeping resets
	s.userID = ""
	s2 := connect(t, tbl, "userB", 0)
	_ = s2
	if tbl.seats[0].rebuys != 0 {
		t.Fatalf("expected clean rebuys on fresh seat, got %d", tbl.seats[0].rebuys)
	}
	_ = ws.NewTestClient
}
