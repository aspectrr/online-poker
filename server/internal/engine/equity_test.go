package engine

import "testing"

// All-in equities: a dominated heads-up all-in gets a plausible equity,
// the numbers sum to ~100, and the favorite matches the hand strength.
func TestAllInEquities(t *testing.T) {
	cfg := baseCfg()
	cfg.RunItTwice = RITAlways
	seats := []SeatState{
		{Seat: 0, Player: "A", Stack: 10000},
		{Seat: 1, Player: "B", Stack: 10000},
	}
	holes := cardsFrom(t, "As", "Ks", "Ah", "Kh") // A: aces, B: kings
	d := fullStackedDeck(t, padTo52(t, holes))
	r, err := startHand(cfg, seats, d)
	if err != nil {
		t.Fatal(err)
	}
	tick(t, r)
	evs := act(t, r, Action{Seat: 0, Kind: Raise, Amount: 10000})
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: Call})...)

	var eq *Event
	for i := range evs {
		if evs[i].Type == EvAllInRunout {
			eq = &evs[i]
		}
	}
	if eq == nil {
		t.Fatal("no all_in_runout event")
	}
	if len(eq.Equities) != 2 {
		t.Fatalf("%d equities, want 2", len(eq.Equities))
	}
	sum := 0
	bySeat := map[int]int{}
	for _, e := range eq.Equities {
		sum += e.Pct
		bySeat[e.Seat] = e.Pct
	}
	if sum < 98 || sum > 102 {
		t.Fatalf("equities sum %d, want ~100", sum)
	}
	// RIT doubles the boards: pairs hold up more often, but aces stay ahead
	if bySeat[0] <= bySeat[1] {
		t.Fatalf("aces equity %d not above kings %d", bySeat[0], bySeat[1])
	}
	if bySeat[0] < 60 || bySeat[0] > 98 {
		t.Fatalf("aces equity %d outside plausible 60-98", bySeat[0])
	}
}

// Rabbit hunt is offered on an incomplete board but NOT once five cards are
// out — a full-board rabbit reveals nothing and just stalls the table.
func TestRabbitNotOfferedOnFullBoard(t *testing.T) {
	// A: aces, B: deuces. A bets every street; B folds on the river.
	seats := []SeatState{
		{Seat: 0, Player: "A", Stack: 10000},
		{Seat: 1, Player: "B", Stack: 10000},
	}
	holes := cardsFrom(t, "As", "2s", "Ah", "2h")
	board := cardsFrom(t, "Ks", "Qd", "9c", "7h", "3c")
	prefix := append([]Card{}, holes...)
	prefix = append(prefix, cardsFrom(t, "Qc")...)
	prefix = append(prefix, board[:3]...)
	prefix = append(prefix, cardsFrom(t, "7c")...)
	prefix = append(prefix, board[3:4]...)
	prefix = append(prefix, cardsFrom(t, "5c")...)
	prefix = append(prefix, board[4:5]...)
	d := fullStackedDeck(t, padTo52(t, prefix))

	cfg := baseCfg()
	cfg.RabbitHunt = true
	r, err := startHand(cfg, seats, d)
	if err != nil {
		t.Fatal(err)
	}
	tick(t, r)
	act(t, r, Action{Seat: 0, Kind: Raise, Amount: 300})
	act(t, r, Action{Seat: 1, Kind: Call})
	tick(t, r) // flop (heads-up: seat 1 acts first postflop)
	act(t, r, Action{Seat: 1, Kind: Check})
	act(t, r, Action{Seat: 0, Kind: Check})
	tick(t, r) // turn
	act(t, r, Action{Seat: 1, Kind: Check})
	act(t, r, Action{Seat: 0, Kind: Check})
	tick(t, r) // river
	act(t, r, Action{Seat: 1, Kind: Check})
	act(t, r, Action{Seat: 0, Kind: Raise, Amount: 200})
	act(t, r, Action{Seat: 1, Kind: Fold}) // uncontested on a FULL board

	reveal, rabbit := r.PendingPostHand()
	if rabbit {
		t.Fatal("rabbit offered with the board already complete")
	}
	if reveal {
		t.Fatal("unexpected 7-2 reveal prompt")
	}
	// no pending decision: the hand ends immediately (correct — nothing to reveal)
}

// ...and it IS offered when the board is incomplete (preflop fold-out).
func TestRabbitOfferedOnShortBoard(t *testing.T) {
	cfg := baseCfg()
	cfg.RabbitHunt = true
	seats := seats2()
	r, err := startHand(cfg, seats, mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	tick(t, r)
	act(t, r, Action{Seat: 0, Kind: Raise, Amount: 10000})
	evs := act(t, r, Action{Seat: 1, Kind: Fold})
	found := false
	for _, e := range evs {
		if e.Type == EvRabbitHunt {
			found = true
		}
	}
	_ = found
	if _, rabbit := r.PendingPostHand(); !rabbit {
		t.Fatal("rabbit not offered on preflop fold-out")
	}
}
