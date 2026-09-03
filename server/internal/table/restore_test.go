package table

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aspectrr/online-poker/server/internal/engine"
	"github.com/aspectrr/online-poker/server/internal/store"
)

// fakePersist serves one recorded last-hand (nil = fresh table).
type fakePersist struct {
	last json.RawMessage
}

func (f *fakePersist) InsertHand(context.Context, string, int, json.RawMessage) (*store.Hand, error) {
	return &store.Hand{}, nil
}

func (f *fakePersist) LastHand(context.Context, string) (json.RawMessage, error) {
	if f.last == nil {
		return nil, store.ErrNotFound
	}
	return f.last, nil
}

// After a restart, a returning player gets their last recorded stack back
// (matched by userID), while a new player buys in normally.
func TestStackRestoreOnJoin(t *testing.T) {
	hist := map[string]any{
		"stacks":   []engine.FinalStack{{Seat: 0, Player: "a", Stack: 5555}, {Seat: 1, Player: "b", Stack: 777}},
		"user_ids": map[int]string{0: "uid-a", 1: "uid-b"},
	}
	data, err := json.Marshal(hist)
	if err != nil {
		t.Fatal(err)
	}
	row := store.GameTable{ID: "r1", Name: "restore", GameType: "NLHE", Config: store.TableConfig{
		BlindsSBBB: []int64{50, 100}, StartingStackBB: 100, MaxSeats: 4,
	}}
	tbl := New(row, &fakePersist{last: data}, false)
	t.Cleanup(tbl.Close)

	a := connect(t, tbl, "uid-a", 0)
	if snap := tbl.snapshotFor(0); snap.Seats[0].Stack != 5555 {
		t.Fatalf("uid-a stack = %d, want restored 5555", snap.Seats[0].Stack)
	}
	drain(a)
	b := connect(t, tbl, "uid-c", 1) // new player: normal buy-in
	if snap := tbl.snapshotFor(1); snap.Seats[1].Stack != 10000 {
		t.Fatalf("uid-c stack = %d, want default 10000", snap.Seats[1].Stack)
	}
	drain(b)
}

// Fresh table (no persisted hands): everyone buys in normally.
func TestStackRestoreFreshTable(t *testing.T) {
	tbl := New(store.GameTable{ID: "r2", Name: "fresh", GameType: "NLHE", Config: store.TableConfig{
		BlindsSBBB: []int64{50, 100}, StartingStackBB: 100, MaxSeats: 4,
	}}, &fakePersist{}, false)
	t.Cleanup(tbl.Close)
	a := connect(t, tbl, "uid-a", 0)
	if snap := tbl.snapshotFor(0); snap.Seats[0].Stack != 10000 {
		t.Fatalf("stack = %d, want default 10000", snap.Seats[0].Stack)
	}
	drain(a)
}

// persistHand records seat→userID so restores land on the right person.
func TestSeatUserIDs(t *testing.T) {
	tbl := testTable(t, 0, 300)
	connect(t, tbl, "uid-a", 0)
	connect(t, tbl, "uid-b", 1)
	tbl.handStart = []engine.FinalStack{{Seat: 0, Player: "a"}, {Seat: 1, Player: "b"}, {Seat: 2, Player: "ghost"}}
	ids := tbl.seatUserIDs()
	if ids[0] != "uid-a" || ids[1] != "uid-b" {
		t.Fatalf("seatUserIDs = %v, want 0:uid-a 1:uid-b", ids)
	}
	if _, ok := ids[2]; ok {
		t.Fatal("empty seat must not map to a userID")
	}
}
