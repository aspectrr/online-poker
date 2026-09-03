package engine

import (
	"testing"
)

// Card helpers: Card = rank*4+suit (s=3 h=1 d=2 c=0); 2=0 … A=12.
var (
	twoC   = Card(0)  // 2c
	twoH   = Card(1)  // 2h
	twoD   = Card(2)  // 2d
	twoS   = Card(3)  // 2s
	threeC = Card(4)  // 3c
	sixS   = Card(27) // 6s
	sixD   = Card(26) // 6d
	sevenC = Card(28) // 7c
	sevenD = Card(30) // 7d
	sevenS = Card(31) // 7s
	kingC  = Card(44) // Kc
	kingD  = Card(46) // Kd
	kingH  = Card(45) // Kh
	kingS  = Card(47) // Ks
	queenC = Card(40) // Qc
	queenD = Card(42) // Qd
	queenS = Card(43) // Qs
	jackS  = Card(39) // Js
	aceC   = Card(48) // Ac
	aceH   = Card(49) // Ah
	aceD   = Card(50) // Ad
	aceS   = Card(51) // As
)

// bombAllInRunner: bomb-pot hand, both players all-in from the ante (stacks
// below the 1BB ante), loaded deck deals holes round-major then both flops;
// streets run out to showdown. Returns the runner + every event.
func bombAllInRunner(t *testing.T, order []Card) (*HandRunner, []Event) {
	t.Helper()
	deck, err := LoadedDeck(order)
	if err != nil {
		t.Fatal(err)
	}
	cfg := TableConfig{
		Game:               NLHE,
		SmallBlind:         50,
		BigBlind:           100,
		StartingStackBB:    1,
		BombPot:            true,
		InterHandDelaySecs: 5,
		ActionTimeoutSecs:  5,
		ButtonSeat:         0,
		HandID:             1,
	}
	seats := []SeatState{
		{Seat: 0, Player: "A", Stack: 50}, // ante caps at stack -> all-in
		{Seat: 1, Player: "B", Stack: 50},
	}
	r, err := StartHandWithDeck(cfg, seats, deck)
	if err != nil {
		t.Fatal(err)
	}
	var evs []Event
	for !r.Done() {
		out, err := r.Advance(nil)
		if err != nil {
			t.Fatal(err)
		}
		evs = append(evs, out...)
	}
	return r, evs
}

func uniqCards(cards []Card) []Card {
	seen := map[Card]bool{}
	out := make([]Card, 0, len(cards))
	for _, c := range cards {
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out
}

// PLO bomb pot: the single ante pool splits per board. A (quad aces) wins
// board 0, B (deuces full) wins board 1 — exactly half the pot each.
func TestBombPotTwoBoardsSplitPerBoard(t *testing.T) {
	order := []Card{
		// holes round-major — A: As Ah Ks Kh, B: 2s 2h Qs Js
		aceS, twoS, aceH, twoH, kingS, queenS, kingH, jackS,
		// flopA: Ad Ac 2c — A: quad aces, B: deuces full of aces -> A
		aceD, aceC, twoC,
		// flopB: Qd Qc 2d — A: two pair K+Q, B: deuces full of queens -> B
		queenD, queenC, twoD,
	}
	r, evs := bombAllInRunner(t, order)

	if len(r.dealt) != len(uniqCards(r.dealt)) {
		t.Fatalf("duplicate cards dealt: %v", r.dealt)
	}
	var awards []Event
	for _, ev := range evs {
		if ev.Type == EvPotAwarded {
			awards = append(awards, ev)
		}
	}
	if len(awards) != 2 {
		t.Fatalf("want 2 pot_awarded (one per board), got %d", len(awards))
	}
	byBoard := map[int]Event{}
	for _, ev := range awards {
		byBoard[ev.BoardIndex] = ev
	}
	if ev := byBoard[0]; ev.Seat != 0 || ev.Amount != 50 {
		t.Fatalf("board 0: want seat 0 / 50, got seat %d / %d (%s)",
			ev.Seat, ev.Amount, ev.Winners[0].HandName)
	}
	if ev := byBoard[1]; ev.Seat != 1 || ev.Amount != 50 {
		t.Fatalf("board 1: want seat 1 / 50, got seat %d / %d (%s)",
			ev.Seat, ev.Amount, ev.Winners[0].HandName)
	}
	stacks := r.Stacks()
	if stacks[0].Stack != 50 || stacks[1].Stack != 50 {
		t.Fatalf("stacks: want 50/50 (each ante 50, each won one board), got %d/%d", stacks[0].Stack, stacks[1].Stack)
	}
}

// One player best on BOTH boards scoops the whole pot — legal, and the
// "surprised he won both" case from poker night.
func TestBombPotWholePotOnBothBoards(t *testing.T) {
	order := []Card{
		// holes — A: As Ah 2s 2h, B: 7s 7d 6s 6d
		aceS, sevenS, aceH, sevenD, twoS, sixS, twoH, sixD,
		// flopA: Ad Ac Kc — A: quad aces; B: sevens full of aces -> A
		aceD, aceC, kingC,
		// flopB: 2d 2c 3c — A: quad deuces; B: deuces full of sevens -> A
		twoD, twoC, threeC,
	}
	r, evs := bombAllInRunner(t, order)

	var awards []Event
	for _, ev := range evs {
		if ev.Type == EvPotAwarded {
			awards = append(awards, ev)
		}
	}
	if len(awards) != 2 {
		t.Fatalf("want 2 pot_awarded, got %d", len(awards))
	}
	for _, ev := range awards {
		if ev.BoardIndex == 0 && (ev.Seat != 0 || ev.Amount != 50) {
			t.Fatalf("board 0: want seat 0 / 50, got seat %d / %d", ev.Seat, ev.Amount)
		}
		if ev.BoardIndex == 1 && (ev.Seat != 0 || ev.Amount != 50) {
			t.Fatalf("board 1: want seat 0 / 50, got seat %d / %d", ev.Seat, ev.Amount)
		}
	}
	stacks := r.Stacks()
	if stacks[0].Stack != 100 || stacks[1].Stack != 0 {
		t.Fatalf("stacks: want A scoops whole 100 ante pool (100/0), got %d/%d", stacks[0].Stack, stacks[1].Stack)
	}
}

// Drop rounds are complete fresh hands: round 2 deals brand-new hole
// cards (EvDropHoles) from a brand-new deck, replacing round 1's.
func TestDropRoundDealsFreshHoles(t *testing.T) {
	cfg := TableConfig{
		Game: NLHE, SmallBlind: 50, BigBlind: 100, StartingStackBB: 100,
		TexasDrop: true, TexasDropAnte: 50,
		ButtonSeat: 0, HandID: 1, ActionTimeoutSecs: 5, InterHandDelaySecs: 5,
	}
	seats := []SeatState{
		{Seat: 0, Player: "A", Stack: 10000},
		{Seat: 1, Player: "B", Stack: 10000},
	}
	deck, err := LoadedDeck([]Card{aceS, kingS, aceH, kingH})
	if err != nil {
		t.Fatal(err)
	}
	r, err := StartHandWithDeck(cfg, seats, deck)
	if err != nil {
		t.Fatal(err)
	}
	round1 := map[int][]Card{0: {aceS, aceH}, 1: {kingS, kingH}}

	var evs []Event
	step := func(a *Action) {
		out, err := r.Advance(a)
		if err != nil {
			t.Fatal(err)
		}
		evs = append(evs, out...)
	}
	step(nil) // setup + round-1 board
	step(&Action{Seat: 0, Kind: Stay})
	step(&Action{Seat: 1, Kind: Stay}) // resolves round 1, starts round 2

	var dropHoles *Event
	for i := range evs {
		ev := evs[i]
		if ev.Type == EvDropHoles && ev.Round == 2 {
			dropHoles = &evs[i]
		}
	}
	if dropHoles == nil || len(dropHoles.HoleCards) != 2 {
		t.Fatalf("round 2 should deal fresh holes to both players, got %+v", dropHoles)
	}
	for _, h := range dropHoles.HoleCards {
		if len(h.Cards) != 2 {
			t.Fatalf("seat %d: want 2 fresh cards, got %v", h.Seat, h.Cards)
		}
		old := round1[h.Seat]
		if h.Cards[0] == old[0] && h.Cards[1] == old[1] {
			t.Fatalf("seat %d kept round-1 holes %v", h.Seat, h.Cards)
		}
		if h.Cards[0] == h.Cards[1] {
			t.Fatalf("seat %d dealt a duplicate card: %v", h.Seat, h.Cards)
		}
	}
	// fresh 2-card hands live in the runner
	if got := r.HolesFor(0); len(got) != 2 || (got[0] == aceS && got[1] == aceH) {
		t.Fatalf("runner holes for seat 0 should be fresh, got %v", got)
	}
}

// MadeHandName: live category per street — NLHE trips on the flop, PLO
// respects the 2-hole rule, "" preflop.
func TestMadeHandNamePerStreet(t *testing.T) {
	// NLHE: Ac Ad + flop Ah 2c 7d -> trips aces
	r := &HandRunner{
		cfg:     TableConfig{Game: NLHE},
		players: []*player{{seat: 0, hole: []Card{aceC, aceD}}},
		board:   [][]Card{{aceH, twoC, Card(30)}}, // 7d
	}
	if got := r.MadeHandName(0); got != "trips" {
		t.Fatalf("NLHE flop made hand = %q, want trips", got)
	}
	if got := r.MadeHandName(1); got != "" {
		t.Fatalf("unknown seat should be empty, got %q", got)
	}

	// PLO: hole As Ah + flop Ad Kd 2c -> trips (exactly-2-hole rule); a
	// board-only interpretation can't beat trips here anyway, so also check
	// a hand where the rule matters: hole 2c 2d + board Ad Ac 2c must be
	// trips+pair = FULL HOUSE (222AA... actually 2,2,2,A,A -> deuces full),
	// not quads (only two 2s in the hole are usable).
	r2 := &HandRunner{
		cfg:     TableConfig{Game: PLO4},
		players: []*player{{seat: 0, hole: []Card{twoC, twoD}}},
		board:   [][]Card{{aceD, aceC, twoC}},
	}
	if got := r2.MadeHandName(0); got != "full_house" {
		t.Fatalf("PLO flop made hand = %q, want full_house", got)
	}

	// river via the full evaluator path
	r3 := &HandRunner{
		cfg:     TableConfig{Game: NLHE},
		players: []*player{{seat: 0, hole: []Card{aceS, aceH}}},
		board:   [][]Card{{aceD, twoC, twoD, kingS, kingH}},
	}
	if got := r3.MadeHandName(0); got != "full_house" {
		t.Fatalf("NLHE river made hand = %q, want full_house", got)
	}

	// preflop: no board, no label
	r4 := &HandRunner{
		cfg:     TableConfig{Game: NLHE},
		players: []*player{{seat: 0, hole: []Card{aceS, aceH}}},
	}
	if got := r4.MadeHandName(0); got != "" {
		t.Fatalf("preflop should be empty, got %q", got)
	}
}
