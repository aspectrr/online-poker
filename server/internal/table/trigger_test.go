package table

import (
	"testing"

	"github.com/aspectrr/online-poker/server/internal/engine"
	"github.com/aspectrr/online-poker/server/internal/protocol"
	"github.com/aspectrr/online-poker/server/internal/store"
)

func intP(i int) *int { return &i }

// A bomb pot hand's own flop must not arm the next bomb pot (chain bug from
// poker night 2026-09-02). A normal hand's flop still does.
func TestBombPotDoesNotChain(t *testing.T) {
	row := store.GameTable{ID: "x", GameType: "NLHE", Config: store.TableConfig{
		BlindsSBBB:      []int64{50, 100},
		StartingStackBB: 100,
		MaxSeats:        4,
		BombPotTriggers: []store.BombPotTrigger{{Rank: intP(12)}}, // queens
	}}
	tbl := New(row, nil, false)
	t.Cleanup(tbl.Close)

	// Bomb pot hand, 2 players: 8 hole cards then both flops (no burn).
	// Queen of hearts on the first flop.
	qh := engine.NewCard(10, 1)
	order := []engine.Card{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, qh, 10, 11, 12}
	cfg := tbl.cfg
	cfg.BombPot = true
	seats := []engine.SeatState{
		{Seat: 0, Player: "a", Stack: 10000},
		{Seat: 1, Player: "b", Stack: 10000},
	}
	deck, err := engine.LoadedDeck(order)
	if err != nil {
		t.Fatal(err)
	}
	r, err := engine.StartHandWithDeck(cfg, seats, deck)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Advance(nil); err != nil { // drains setup + deals the double flop
		t.Fatal(err)
	}
	flop := r.FlopCards()
	if len(flop) != 6 || !engine.AnyTriggerMatch(tbl.cfg.BombPotCardTriggers, flop) {
		t.Fatalf("test setup: bomb flop should carry the queen, got %v", flop)
	}

	// The bomb pot hand ends: its flop must NOT arm the next hand.
	tbl.runner = r
	tbl.bombPot = true
	tbl.handEnded()
	if tbl.lastDealt != nil {
		t.Fatal("bomb pot hand's flop fed into trigger match — bomb pots would chain")
	}

	// Control: a normal hand with the same queen flop DOES arm the next one.
	// Normal streets burn, so: 4 holes, burn, then 8,9,Qh on the flop.
	deck2, err := engine.LoadedDeck([]engine.Card{0, 1, 2, 3, 7, 8, 9, qh})
	if err != nil {
		t.Fatal(err)
	}
	normal := tbl.cfg
	normal.BombPot = false
	r2, err := engine.StartHandWithDeck(normal, seats, deck2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r2.Advance(nil); err != nil { // blinds
		t.Fatal(err)
	}
	// call the preflop street out so the flop lands
	// call/check the preflop street out so the flop lands
	for !r2.Done() && len(r2.FlopCards()) == 0 {
		la := r2.LegalActionsFor()
		kind := engine.Check
		if la.CanCall {
			kind = engine.Call
		}
		if _, err := r2.Advance(&engine.Action{Seat: la.Seat, Kind: kind}); err != nil {
			t.Fatal(err)
		}
	}
	tbl.runner = r2
	tbl.bombPot = false
	tbl.handEnded()
	if !engine.AnyTriggerMatch(tbl.cfg.BombPotCardTriggers, tbl.lastDealt) {
		t.Fatal("normal hand's trigger flop was not stored — triggers would never fire")
	}
}

// dev-table config: bomb_pot_triggers=[{rank:12}] (a queen, store ranks 2-14).
func TestTriggerConfigWired(t *testing.T) {
	row := store.GameTable{ID: "x", GameType: "NLHE", Config: store.TableConfig{
		BombPotTriggers: []store.BombPotTrigger{{Rank: intP(12)}},
	}}
	cfg := engineConfig(row)
	if len(cfg.BombPotCardTriggers) != 1 {
		t.Fatalf("triggers len = %d, want 1", len(cfg.BombPotCardTriggers))
	}
	tr := cfg.BombPotCardTriggers[0]
	// queen hearts: engine rank 10 (= store 12), suit 1
	qh := engine.NewCard(10, 1)
	if !tr.Matches(qh) {
		t.Fatalf("trigger should match queen of hearts (%d rank %d)", qh, qh.Rank())
	}
	if tr.Matches(engine.NewCard(8, 2)) {
		t.Fatal("trigger should not match ten of diamonds")
	}
	if !engine.AnyTriggerMatch(cfg.BombPotCardTriggers, []engine.Card{engine.NewCard(5, 0), qh}) {
		t.Fatal("AnyTriggerMatch should find the queen")
	}
}

// The lobby's live seated count tracks occupied seats (REST reads it via
// atomics cross-goroutine).
func TestSeatedCountTracksJoins(t *testing.T) {
	tbl := testTable(t, 0, 300)
	if tbl.SeatedCount() != 0 {
		t.Fatalf("fresh table seated = %d, want 0", tbl.SeatedCount())
	}
	a := connect(t, tbl, "uid-a", 0)
	b := connect(t, tbl, "uid-b", 1)
	defer func() {
		tbl.Send(a, protocol.ClientMsg{Type: "leave"})
		tbl.Send(b, protocol.ClientMsg{Type: "leave"})
		waitProcessed(t, tbl)
	}()
	if got := tbl.SeatedCount(); got != 2 {
		t.Fatalf("seated = %d, want 2", got)
	}
}

// Sweep reaps tables with no clients (not mid-hand); Lookup confirms removal.
func TestSweepReapsEmptyTables(t *testing.T) {
	m := NewManager(nil)
	m.Get(store.GameTable{ID: "s1", Name: "s", GameType: "NLHE", Config: store.TableConfig{
		BlindsSBBB: []int64{50, 100}, MaxSeats: 4,
	}})
	ids := m.Sweep(0)
	if len(ids) != 1 || ids[0] != "s1" {
		t.Fatalf("swept %v, want [s1]", ids)
	}
	if m.Lookup("s1") != nil {
		t.Fatal("table still live after sweep")
	}
}
