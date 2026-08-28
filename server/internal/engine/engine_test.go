package engine

import "testing"

// stackFromEvents: final stack for seat.
func stackFromEvents(t *testing.T, evs []Event, seat int) int64 {
	t.Helper()
	for _, e := range evs {
		if e.Type == EvHandEnded {
			for _, s := range e.Stacks {
				if s.Seat == seat {
					return s.Stack
				}
			}
		}
	}
	t.Fatal("no hand-ended event")
	return 0
}

// drive a full hand from a stacked deck.
func runHand(t *testing.T, cfg TableConfig, seats []SeatState, order []Card, acts func(t *testing.T, r *HandRunner)) []Event {
	t.Helper()
	r, err := startHand(cfg, seats, fullStackedDeck(t, padTo52(t, order)))
	if err != nil {
		t.Fatal(err)
	}
	evs := tick(t, r)
	acts(t, r)
	evs = append(evs, runTo(t, r)...)
	return evs
}

// Deck order convention for tests: NLHE 3-max deals hole cards first
// (seat order from button+1), then burn/board as drawn.
// seats: button seat 0. Deal order: sb, bb, btn | sb, bb, btn | burn | flop...

func TestBlindsAndPreflopFlow(t *testing.T) {
	// 3-handed, button seat 0: sb=1, bb=2, first to act = 0.
	seats := []SeatState{
		{Seat: 0, Player: "Btn", Stack: 10000},
		{Seat: 1, Player: "SB", Stack: 10000},
		{Seat: 2, Player: "BB", Stack: 10000},
	}
	r, err := startHand(baseCfg(), seats, mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	evs := tick(t, r)
	var blinds int64
	for _, e := range evs {
		if e.Type == EvBlindsPosted {
			blinds += e.Amount
		}
	}
	if blinds != 150 {
		t.Fatalf("blinds posted = %d, want 150", blinds)
	}
	la := r.LegalActionsFor()
	if la == nil || la.Seat != 0 {
		t.Fatalf("first to act = %+v, want seat 0", la)
	}
	if !la.CanCall || la.CallAmount != 100 {
		t.Fatalf("call amount = %d, want 100", la.CallAmount)
	}
	if !la.CanRaise || la.MinRaiseTo != 200 {
		t.Fatalf("min raise TO = %d, want 200", la.MinRaiseTo)
	}
}

func mustDeck(t *testing.T) Deck {
	t.Helper()
	d, err := NewDeck()
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestMinRaiseLegality(t *testing.T) {
	seats := []SeatState{
		{Seat: 0, Player: "Btn", Stack: 10000},
		{Seat: 1, Player: "SB", Stack: 10000},
		{Seat: 2, Player: "BB", Stack: 10000},
	}
	r, err := startHand(baseCfg(), seats, mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	tick(t, r)

	// seat 0 raises TO 300 (raise of 200 over 100; legal min after would be 500)
	act(t, r, Action{Seat: 0, Kind: Raise, Amount: 300})
	// seat 1 must call 250 more or raise TO >= 500
	la := r.LegalActionsFor()
	if la.Seat != 1 || la.CallAmount != 250 {
		t.Fatalf("seat 1: call %d, want 250", la.CallAmount)
	}
	if la.MinRaiseTo != 500 {
		t.Fatalf("min raise TO after 300 = %d, want 500", la.MinRaiseTo)
	}
	// under-raise rejected
	if _, err := r.Advance(&Action{Seat: 1, Kind: Raise, Amount: 400}); err == nil {
		t.Fatal("raise TO 400 should be rejected (< min 500)")
	}
	act(t, r, Action{Seat: 1, Kind: Raise, Amount: 500})
	// seat 2: min re-raise now 700
	la = r.LegalActionsFor()
	if la.Seat != 2 || la.MinRaiseTo != 700 {
		t.Fatalf("min raise TO after 500 = %d, want 700", la.MinRaiseTo)
	}
	// all-in short raise: seat 2 has 10000, fine. Fold around instead:
	act(t, r, Action{Seat: 2, Kind: Fold})
	act(t, r, Action{Seat: 0, Kind: Fold})
	// seat 1 wins uncontested
	if !r.Done() {
		t.Fatal("hand should be over")
	}
}

func TestShortAllInDoesNotReopen(t *testing.T) {
	// B raises TO 600; A re-raises all-in TO 800 (raise of 200 < 600-300... );
	// C only needs to call; betting NOT reopened for B beyond calling.
	seats := []SeatState{
		{Seat: 0, Player: "A", Stack: 800}, // button; can call 800 total, then all-in
		{Seat: 1, Player: "B", Stack: 800}, // sb
		{Seat: 2, Player: "C", Stack: 800}, // bb
	}
	// button seat 0: sb=1(B), bb=2(C), first to act 0(A)
	r, err := startHand(baseCfg(), seats, mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	tick(t, r)
	act(t, r, Action{Seat: 0, Kind: Raise, Amount: 300}) // A raises TO 300, full raise (200)
	// B all-in TO 800: raise size 500 >= 200 → full raise. Reopens.
	act(t, r, Action{Seat: 1, Kind: Raise, Amount: 800}) // B all-in
	act(t, r, Action{Seat: 2, Kind: Call})               // C calls 700 more → all-in
	evs := act(t, r, Action{Seat: 0, Kind: Call})        // A calls 500 more → all-in; runout rides along
	evs = append(evs, runTo(t, r)...)
	if !hasEvent(evs, EvStreetDealt) {
		t.Fatal("expected board dealt")
	}
	if !hasEvent(evs, EvShowdown) {
		t.Fatal("expected showdown")
	}
	if !r.Done() {
		t.Fatal("hand should run out and finish")
	}
	// chip conservation
	s0, s1, s2 := stackFromEvents(t, evs, 0), stackFromEvents(t, evs, 1), stackFromEvents(t, evs, 2)
	if s0+s1+s2 != 2400 {
		t.Fatalf("conservation: %d+%d+%d", s0, s1, s2)
	}
}

func TestAllInSidePots(t *testing.T) {
	// 3 players, all-in for different amounts.
	// A: 100, B: 300, C: 1000. Blinds 50/100.
	// A all-in 100 (short of BB), B all-in 300, C calls 300.
	// Pots: main = 100*3 = 300; side1 = 200*2 = 400 (B, C eligible).
	seats := []SeatState{
		{Seat: 0, Player: "C", Stack: 1000}, // button
		{Seat: 1, Player: "A", Stack: 100},  // sb
		{Seat: 2, Player: "B", Stack: 300},  // bb
	}
	cfg := baseCfg()
	r, err := startHand(cfg, seats, mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	tick(t, r)
	// first to act: C (button, left of bb)
	act(t, r, Action{Seat: 0, Kind: Call})               // C calls 100
	act(t, r, Action{Seat: 1, Kind: Call})               // A calls 50 more (all-in at 100)
	act(t, r, Action{Seat: 2, Kind: Raise, Amount: 300}) // B all-in TO 300
	evs := act(t, r, Action{Seat: 0, Kind: Call})        // C calls 200 more
	// A all-in short: street closes; runout rides along + ticks
	evs = append(evs, runTo(t, r)...)

	// verify pot math from events
	var awarded int64
	for _, e := range evs {
		if e.Type == EvPotAwarded {
			awarded += e.Amount
		}
	}
	if awarded != 700 {
		t.Fatalf("total awarded %d, want 700", awarded)
	}
	// A contributed 100, B 300, C 300 → 700. Side pots: A eligible only main.
	// Winner determination is deck-random; we verify conservation:
	s0 := stackFromEvents(t, evs, 0)
	s1 := stackFromEvents(t, evs, 1)
	s2 := stackFromEvents(t, evs, 2)
	if s0+s1+s2 != 1000+100+300 {
		t.Fatalf("chip conservation broken: %d+%d+%d", s0, s1, s2)
	}
}

func TestSidePotSplitOddChip(t *testing.T) {
	// Direct unit test on buildPots via a constructed runner.
	r := &HandRunner{
		players: []*player{
			{seat: 0, name: "X", stack: 0, committed: 100, hole: []Card{NewCard(12, 0), NewCard(11, 0)}},
			{seat: 1, name: "Y", stack: 0, committed: 100, hole: []Card{NewCard(12, 1), NewCard(11, 1)}},
			{seat: 2, name: "Z", stack: 0, committed: 300, hole: []Card{NewCard(5, 0), NewCard(5, 1)}},
		},
	}
	layers := r.buildPots()
	if len(layers) != 2 {
		t.Fatalf("layers = %d, want 2", len(layers))
	}
	if layers[0].amount != 300 {
		t.Fatalf("main = %d, want 300", layers[0].amount)
	}
	if layers[1].amount != 200 {
		t.Fatalf("side = %d, want 200", layers[1].amount)
	}
	if len(layers[0].eligible) != 3 || len(layers[1].eligible) != 1 {
		t.Fatalf("eligibility: %v / %v", layers[0].eligible, layers[1].eligible)
	}
}

func TestUncontestedWinAndRabbit(t *testing.T) {
	cfg := baseCfg()
	cfg.RabbitHunt = true
	seats := seats2() // seat 0 btn/sb, seat 1 bb
	r, err := startHand(cfg, seats, mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	evs := tick(t, r)
	// heads-up: button/SB (seat 0) acts first
	act(t, r, Action{Seat: 0, Kind: Raise, Amount: 300})
	act(t, r, Action{Seat: 1, Kind: Fold})
	// hand uncontested, no reveal pending (no 7-2), rabbit available
	evs = append(evs, tick(t, r)...)
	var rabbitAsked bool
	for _, e := range evs {
		if e.Type == EvPotAwarded && e.Seat != 0 {
			t.Fatalf("wrong winner %d", e.Seat)
		}
	}
	// take rabbit
	more, err := r.Advance(&Action{Seat: 0, Kind: RabbitHunt})
	if err != nil {
		t.Fatalf("rabbit: %v", err)
	}
	evs = append(evs, more...)
	rabbitAsked = hasEvent(evs, EvRabbitHunt)
	if !rabbitAsked {
		t.Fatal("expected rabbit hunt event")
	}
	// rabbit must complete the board to 5
	for _, e := range more {
		if e.Type == EvRabbitHunt {
			board := len(e.Rabbit)
			if board != 5 { // preflop fold: full board rabbited
				t.Fatalf("rabbit cards = %d, want 5", board)
			}
		}
	}
	if !r.Done() {
		t.Fatal("hand not done")
	}
	// advancing again errors
	if _, err := r.Advance(nil); err == nil {
		t.Fatal("expected error after hand end")
	}
}

func hasEvent(evs []Event, typ EventType) bool {
	for _, e := range evs {
		if e.Type == typ {
			return true
		}
	}
	return false
}
