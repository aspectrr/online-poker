package engine

import "testing"

// Texas Drop: everyone antes, board runs out, stay-or-drop each round.
// Sole stayer takes the pot; multi-stayer rounds replenish it via losers;
// nobody-stayed re-antes. These tests use stacked decks for round 1 (the
// initial deck serves holes + board) and conservation invariants throughout.

func dropCfg() TableConfig {
	cfg := baseCfg()
	cfg.TexasDrop = true
	cfg.TexasDropAnte = 50
	return cfg
}

func dropSeats3() []SeatState {
	return []SeatState{
		{Seat: 0, Player: "A", Stack: 10000},
		{Seat: 1, Player: "B", Stack: 10000},
		{Seat: 2, Player: "C", Stack: 10000},
	}
}

// startDrop: hand where A holds aces, B kings, C deuces; board pairs nobody.
func startDrop(t *testing.T, seats []SeatState) (*HandRunner, []Event) {
	t.Helper()
	holes := cardsFrom(t, "As", "Ks", "2s", "Ah", "Kh", "2h") // round-major A,B,C,A,B,C
	board := cardsFrom(t, "Qs", "Js", "9d", "8c", "7s")
	prefix := append([]Card{}, holes...)
	prefix = append(prefix, cardsFrom(t, "Qc")...) // flop burn
	prefix = append(prefix, board[:3]...)
	prefix = append(prefix, cardsFrom(t, "7c")...) // turn burn
	prefix = append(prefix, board[3:4]...)
	prefix = append(prefix, cardsFrom(t, "5c")...) // river burn
	prefix = append(prefix, board[4:5]...)
	d := fullStackedDeck(t, padTo52(t, prefix))
	r, err := startHand(dropCfg(), seats, d)
	if err != nil {
		t.Fatal(err)
	}
	return r, tick(t, r)
}

// TestTexasDropSetup: antes + full board + decision phase opens.
func TestTexasDropSetup(t *testing.T) {
	r, evs := startDrop(t, dropSeats3())
	antes := 0
	for _, e := range evs {
		switch e.Type {
		case EvHandStarted:
			if !e.TexasDrop {
				t.Fatal("hand_started missing texas_drop flag")
			}
		case EvAntesPosted:
			antes++
			if e.Amount != 50 {
				t.Fatalf("ante %d, want 50", e.Amount)
			}
		case EvStreetDealt:
			if len(e.Cards) == 0 {
				t.Fatal("street_dealt with no cards")
			}
		case EvDropDecide:
			if e.Round != 1 || e.Waiting != 3 {
				t.Fatalf("drop_decide round=%d waiting=%d, want 1/3", e.Round, e.Waiting)
			}
			if e.Pot != 150 {
				t.Fatalf("pot %d, want 150", e.Pot)
			}
		}
	}
	if antes != 3 {
		t.Fatalf("got %d antes, want 3", antes)
	}
	if r.street != Drop {
		t.Fatalf("street %v, want drop", r.street)
	}
	if la := r.LegalActionsFor(); la != nil {
		t.Fatal("legal actions must be nil during decision phase")
	}

	// stay/drop is illegal in a regular (non-drop) hand
	reg, err := startHand(baseCfg(), seats2(), mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	tick(t, reg)
	if _, err := reg.Advance(&Action{Seat: 0, Kind: Stay}); err == nil {
		t.Fatal("stay accepted in a regular hand")
	}
}

// TestTexasDropTwoRoundsToSoleStayer: 2+ stayers replenish; sole stayer
// ends the game with the whole pot; chips conserve.
func TestTexasDropTwoRoundsToSoleStayer(t *testing.T) {
	r, evs := startDrop(t, dropSeats3())
	// round 1: A and B stay (A wins with aces), C drops
	evs = append(evs, act(t, r, Action{Seat: 0, Kind: Stay})...)
	evs = append(evs, act(t, r, Action{Seat: 2, Kind: DropOut})...)
	if _, waiting, ok := r.DropDecidePending(); !ok || waiting != 1 {
		t.Fatalf("waiting=%d ok=%v, want 1 waiting on B", waiting, ok)
	}
	// double decision is rejected
	if _, err := r.Advance(&Action{Seat: 0, Kind: Stay}); err == nil {
		t.Fatal("double decision accepted")
	}
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: Stay})...)

	// reveal: 3 decisions, C dropped
	rev := findEv(t, evs, EvDropReveal)
	if len(rev.Decisions) != 3 {
		t.Fatalf("%d decisions, want 3", len(rev.Decisions))
	}
	for _, d := range rev.Decisions {
		if d.Seat == 2 && d.Stay {
			t.Fatal("seat 2 should have dropped")
		}
	}
	// showdown reveals only the stayers
	sd := findEv(t, evs, EvShowdown)
	if len(sd.HoleCards) != 2 {
		t.Fatalf("%d reveals, want 2 (stayers only)", len(sd.HoleCards))
	}
	// A (aces) wins the 150 pot; B replenishes 150
	winner := findWinner(t, evs, 1)
	if winner == -1 || winner == 2 {
		t.Fatalf("round-1 winner = %d, want seat 0 (aces)", winner)
	}
	rep := findEv(t, evs, EvDropReplenish)
	if rep.Seat != 1 || rep.Amount != 150 {
		t.Fatalf("replenish seat=%d amount=%d, want seat 1 / 150", rep.Seat, rep.Amount)
	}
	// round 2 opens with the dropper out
	d2 := lastEv(t, evs, EvDropDecide)
	if d2.Round != 2 || d2.Waiting != 2 {
		t.Fatalf("round-2 decide round=%d waiting=%d, want 2/2", d2.Round, d2.Waiting)
	}
	if d2.Pot != 150 {
		t.Fatalf("round-2 pot %d, want 150 (one replenish)", d2.Pot)
	}

	// round 2: round-1 winner stays, the replenisher drops -> sole stayer
	// takes the pot; the round-1 dropper is out and cannot act
	if _, _, ok := r.DropDecidePending(); !ok {
		t.Fatal("round 2 not open")
	}
	evs = append(evs, act(t, r, Action{Seat: winner, Kind: Stay})...)
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: DropOut})...)
	if _, err := r.Advance(&Action{Seat: 1, Kind: Stay}); err == nil {
		t.Fatal("dropped seat allowed to decide")
	}
	evs = append(evs, runTo(t, r)...)

	end := lastEv(t, evs, EvHandEnded)
	total := int64(0)
	for _, fs := range end.Stacks {
		total += fs.Stack
	}
	if total != 30000 {
		t.Fatalf("stacks sum %d, want 30000", total)
	}
	// winner of round 1 + sole staker of round 2: +50 net each event chain
	final := findStack(t, evs, winner)
	if final != 10000-50+150+150 {
		t.Fatalf("winner stack %d, want %d", final, 10000-50+150+150)
	}
}

// TestTexasDropAllDropReAntes: nobody stays -> re-ante, fresh board, and a
// later sole stayer collects the grown pot.
func TestTexasDropAllDropReAntes(t *testing.T) {
	r, evs := startDrop(t, dropSeats3())
	for _, s := range []int{0, 1, 2} {
		evs = append(evs, act(t, r, Action{Seat: s, Kind: DropOut})...)
	}
	// 3 re-antes of 50; pot 300; round 2 with everyone still in
	reantes := 0
	var d2 *Event
	for _, e := range evs {
		if e.Type == EvAntesPosted && e.Street == "drop" {
			reantes++
		}
		if e.Type == EvDropDecide && e.Round == 2 {
			ee := e
			d2 = &ee
		}
	}
	if reantes != 3 {
		t.Fatalf("%d re-antes, want 3", reantes)
	}
	if d2 == nil || d2.Pot != 300 || d2.Waiting != 3 {
		t.Fatalf("round 2: %+v, want pot 300 waiting 3", d2)
	}
	if r.Done() {
		t.Fatal("game ended after all-drop round")
	}

	// round 2: only A stays -> takes the 300 pot, game over
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: DropOut})...)
	evs = append(evs, act(t, r, Action{Seat: 2, Kind: DropOut})...)
	evs = append(evs, act(t, r, Action{Seat: 0, Kind: Stay})...)
	evs = append(evs, runTo(t, r)...)
	var awarded int64
	for _, e := range evs {
		if e.Type == EvPotAwarded && e.Round == 2 {
			awarded += e.Amount
		}
	}
	if awarded != 300 {
		t.Fatalf("round-2 award %d, want 300", awarded)
	}
	final := findStack(t, evs, 0)
	if final != 10000-50-50+300 {
		t.Fatalf("A stack %d, want %d", final, 10000-50-50+300)
	}
}

// TestTexasDropBrokeStayerSkipsReplenish: a stayer who can't cover the pot
// pays nothing; with no replenish money the game ends after the award.
func TestTexasDropBrokeStayerSkipsReplenish(t *testing.T) {
	seats := []SeatState{
		{Seat: 0, Player: "A", Stack: 10000},
		{Seat: 1, Player: "B", Stack: 10000},
		{Seat: 2, Player: "C", Stack: 50}, // ante only — can never replenish
	}
	r, evs := startDrop(t, seats)
	for _, s := range []int{0, 1, 2} {
		evs = append(evs, act(t, r, Action{Seat: s, Kind: Stay})...)
	}
	// C (deuces, broke) lost: paid nothing — no replenish event for seat 2
	for _, e := range evs {
		if e.Type == EvDropReplenish && e.Seat == 2 {
			t.Fatalf("broke seat 2 replenished: %+v", e)
		}
	}
	winner := findWinner(t, evs, 1)
	if winner != 0 {
		t.Fatalf("round-1 winner %d, want seat 0 (aces)", winner)
	}
	// B replenished 150 -> round 2 opens (C stays eligible, just broke);
	// B and C drop, A takes it as sole stayer
	if d := lastEv(t, evs, EvDropDecide); d.Round != 2 || d.Pot != 150 || d.Waiting != 3 {
		t.Fatalf("round-2 decide %+v, want round 2 pot 150 waiting 3", d)
	}
	evs = append(evs, act(t, r, Action{Seat: 0, Kind: Stay})...)
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: DropOut})...)
	evs = append(evs, act(t, r, Action{Seat: 2, Kind: DropOut})...)
	evs = append(evs, runTo(t, r)...)
	final := lastEv(t, evs, EvHandEnded)
	total := int64(0)
	for _, fs := range final.Stacks {
		total += fs.Stack
	}
	if total != 20050 {
		t.Fatalf("stacks sum %d, want 20050", total)
	}
}

// TestTexasDropTieSplits: tied stayers split the pot; a losing stayer still
// replenishes; game continues.
func TestTexasDropTieSplits(t *testing.T) {
	seats := []SeatState{
		{Seat: 0, Player: "A", Stack: 10000},
		{Seat: 1, Player: "B", Stack: 10000},
		{Seat: 2, Player: "C", Stack: 10000},
	}
	// A and B both hold paired aces (equal strength), C deuces
	r, evs := startDropWith(t, seats, cardsFrom(t, "As", "Ac", "2s", "Ah", "Ad", "2h"))
	for _, s := range []int{0, 1, 2} {
		evs = append(evs, act(t, r, Action{Seat: s, Kind: Stay})...)
	}
	var splitA, splitB int64
	for _, e := range evs {
		if e.Type == EvPotAwarded && e.Round == 1 {
			if e.Seat == 0 {
				splitA = e.Amount
			}
			if e.Seat == 1 {
				splitB = e.Amount
			}
		}
	}
	if splitA != 75 || splitB != 75 {
		t.Fatalf("split %d/%d, want 75/75", splitA, splitB)
	}
	rep := findEv(t, evs, EvDropReplenish)
	if rep.Seat != 2 || rep.Amount != 150 {
		t.Fatalf("replenish seat=%d amount=%d, want seat 2 / 150", rep.Seat, rep.Amount)
	}
	if d := lastEv(t, evs, EvDropDecide); d.Round != 2 || d.Pot != 150 {
		t.Fatalf("round 2 pot %d, want 150 (C's replenish)", d.Pot)
	}
}

// TestTexasDropStalemateSplitsWhenBroke: everyone drops with no chips to
// re-ante -> stranded pot splits and the game ends (no soft-lock).
func TestTexasDropStalemateSplitsWhenBroke(t *testing.T) {
	seats := []SeatState{
		{Seat: 0, Player: "A", Stack: 50},
		{Seat: 1, Player: "B", Stack: 50},
		{Seat: 2, Player: "C", Stack: 50},
	}
	r, evs := startDrop(t, seats)
	for _, s := range []int{0, 1, 2} {
		evs = append(evs, act(t, r, Action{Seat: s, Kind: DropOut})...)
	}
	evs = append(evs, runTo(t, r)...)
	if !r.Done() {
		t.Fatal("stalemate game did not end")
	}
	awards := 0
	var total int64
	for _, e := range evs {
		if e.Type == EvPotAwarded && e.Round == 1 {
			awards++
			total += e.Amount
		}
	}
	if awards != 3 || total != 150 {
		t.Fatalf("%d awards totaling %d, want 3 × 50", awards, total)
	}
	for _, fs := range lastEv(t, evs, EvHandEnded).Stacks {
		if fs.Stack != 50 {
			t.Fatalf("seat %d stack %d, want 50 back", fs.Seat, fs.Stack)
		}
	}
}

// TestTexasDropConfigRejected: drop game requires NLHE, no bomb pot, ante > 0.
func TestTexasDropConfigRejected(t *testing.T) {
	cfg := dropCfg()
	cfg.TexasDropAnte = 0
	if _, err := startHand(cfg, seats2(), mustDeck(t)); err == nil {
		t.Fatal("zero ante accepted")
	}
	cfg = dropCfg()
	cfg.BombPot = true
	if _, err := startHand(cfg, seats2(), mustDeck(t)); err == nil {
		t.Fatal("drop + bomb pot accepted")
	}
	cfg = dropCfg()
	cfg.Game = PLO4
	if _, err := startHand(cfg, seats2(), mustDeck(t)); err == nil {
		t.Fatal("PLO4 drop game accepted")
	}
}

// ---- helpers shared by the drop tests ----

func startDropWith(t *testing.T, seats []SeatState, holes []Card) (*HandRunner, []Event) {
	t.Helper()
	if len(holes) != 6 {
		t.Fatalf("need 6 hole cards, got %d", len(holes))
	}
	board := cardsFrom(t, "Qs", "Js", "9d", "8c", "7s")
	prefix := append([]Card{}, holes...)
	prefix = append(prefix, cardsFrom(t, "Qc")...)
	prefix = append(prefix, board[:3]...)
	prefix = append(prefix, cardsFrom(t, "7c")...)
	prefix = append(prefix, board[3:4]...)
	prefix = append(prefix, cardsFrom(t, "5c")...)
	prefix = append(prefix, board[4:5]...)
	d := fullStackedDeck(t, padTo52(t, prefix))
	r, err := startHand(dropCfg(), seats, d)
	if err != nil {
		t.Fatal(err)
	}
	return r, tick(t, r)
}

func findEv(t *testing.T, evs []Event, typ EventType) *Event {
	t.Helper()
	for i := range evs {
		if evs[i].Type == typ {
			return &evs[i]
		}
	}
	t.Fatalf("no %s event found", typ)
	return nil
}

func lastEv(t *testing.T, evs []Event, typ EventType) *Event {
	t.Helper()
	var found *Event
	for i := range evs {
		if evs[i].Type == typ {
			found = &evs[i]
		}
	}
	if found == nil {
		t.Fatalf("no %s event found", typ)
	}
	return found
}

// findWinner: seat of the round-1 pot_awarded (single-winner rounds).
func findWinner(t *testing.T, evs []Event, round int64) int {
	t.Helper()
	for i := range evs {
		e := evs[i]
		if e.Type == EvPotAwarded && int64(e.Round) == int64(round) && e.Street == "drop" {
			return e.Seat
		}
	}
	t.Fatalf("no pot_awarded in round %d", round)
	return -1
}
