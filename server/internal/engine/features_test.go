package engine

import "testing"

// RIT test: heads-up, both all-in preflop, RunItTwice=always.
// Verify: two boards dealt, each pot half, chips conserved.
func TestRunItTwiceSplits(t *testing.T) {
	cfg := baseCfg()
	cfg.RunItTwice = RITAlways
	seats := seats2() // seat 0 btn/sb acts first
	r, err := startHand(cfg, seats, mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	evs := tick(t, r)
	act(t, r, Action{Seat: 0, Kind: Raise, Amount: 10000}) // all-in
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: Call})...)
	evs = append(evs, runTo(t, r)...)

	// two boards' worth of street_dealt events with distinct board_index
	boardCards := map[int]int{}
	for _, e := range evs {
		if e.Type == EvStreetDealt {
			boardCards[e.BoardIndex] += len(e.Cards)
		}
	}
	if len(boardCards) != 2 {
		t.Fatalf("expected 2 boards, got %d", len(boardCards))
	}
	for b, n := range boardCards {
		if n != 5 {
			t.Fatalf("board %d got %d cards, want 5", b, n)
		}
	}

	// pot: sb 50 + bb 100 + call 9950 = 10000+... seat0 commits 10000, seat1 commits 10000 → 20000
	var awarded int64
	for _, e := range evs {
		if e.Type == EvPotAwarded {
			awarded += e.Amount
		}
	}
	if awarded != 20000 {
		t.Fatalf("awarded %d, want 20000", awarded)
	}
	// per-board awards sum to half each
	perBoard := map[int]int64{}
	for _, e := range evs {
		if e.Type == EvPotAwarded {
			perBoard[e.BoardIndex] += e.Amount
		}
	}
	for b, amt := range perBoard {
		if amt != 10000 {
			t.Fatalf("board %d awarded %d, want 10000 (half pot)", b, amt)
		}
	}
	s0, s1 := stackFromEvents(t, evs, 0), stackFromEvents(t, evs, 1)
	if s0+s1 != 20000 {
		t.Fatalf("conservation: %d+%d", s0, s1)
	}
}

// RIT with differing stacks: side pot halves per board too.
func TestRunItTwiceWithSidePot(t *testing.T) {
	cfg := baseCfg()
	cfg.RunItTwice = RITAlways
	seats := []SeatState{
		{Seat: 0, Player: "A", Stack: 3000},
		{Seat: 1, Player: "B", Stack: 10000},
	}
	r, err := startHand(cfg, seats, mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	evs := tick(t, r)
	evs = append(evs, act(t, r, Action{Seat: 0, Kind: Raise, Amount: 3000})...) // all-in
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: Call})...)
	evs = append(evs, runTo(t, r)...)

	// total 6000; main layer 6000 (both at 3000); halves 3000 each
	var awarded int64
	perBoard := map[int]int64{}
	for _, e := range evs {
		if e.Type == EvPotAwarded {
			awarded += e.Amount
			perBoard[e.BoardIndex] += e.Amount
		}
	}
	if awarded != 6000 {
		t.Fatalf("awarded %d, want 6000", awarded)
	}
	for b, amt := range perBoard {
		if amt != 3000 {
			t.Fatalf("board %d awarded %d, want 3000", b, amt)
		}
	}
}

// RIT never: single board even heads-up all-in.
func TestRunItTwiceNever(t *testing.T) {
	cfg := baseCfg()
	cfg.RunItTwice = RITNever
	r, err := startHand(cfg, seats2(), mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	evs := tick(t, r)
	evs = append(evs, act(t, r, Action{Seat: 0, Kind: Raise, Amount: 10000})...)
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: Call})...)
	evs = append(evs, runTo(t, r)...)
	boardCards := map[int]int{}
	for _, e := range evs {
		if e.Type == EvStreetDealt {
			boardCards[e.BoardIndex] += len(e.Cards)
		}
	}
	if len(boardCards) != 1 || boardCards[0] != 5 {
		t.Fatalf("expected single 5-card board, got %v", boardCards)
	}
}

// Bomb pot: double board PLO, all ante BB, 4 cards, no preflop betting.
func TestBombPotFlow(t *testing.T) {
	cfg := baseCfg()
	cfg.BombPot = true
	seats := []SeatState{
		{Seat: 0, Player: "A", Stack: 10000},
		{Seat: 1, Player: "B", Stack: 10000},
		{Seat: 2, Player: "C", Stack: 10000},
	}
	r, err := startHand(cfg, seats, mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	if r.street != Preflop || len(r.players[0].hole) != 4 {
		t.Fatalf("bomb pot should deal 4 hole cards, got %d", len(r.players[0].hole))
	}
	evs := tick(t, r)
	// antes: 100 each
	var antes int64
	for _, e := range evs {
		if e.Type == EvAntesPosted {
			antes += e.Amount
		}
	}
	if antes != 300 {
		t.Fatalf("antes %d, want 300", antes)
	}
	// no action pending preflop; first tick deals double flop + opens flop betting
	flopBoards := map[int]int{}
	for _, e := range evs {
		if e.Type == EvStreetDealt && e.Street == "flop" {
			flopBoards[e.BoardIndex] += len(e.Cards)
		}
	}
	if len(flopBoards) != 2 {
		t.Fatalf("expected double flop (2 boards), got %d", len(flopBoards))
	}
	la := r.LegalActionsFor()
	if la == nil {
		t.Fatal("flop betting should be open after bomb flop")
	}
	// pot starts at 300 antes; bet on flop
	if la.CallAmount != 0 || !la.CanCheck {
		t.Fatalf("flop opens checked; call=%d", la.CallAmount)
	}

	// run it: everyone checks through, showdown on both boards
	for !r.Done() {
		la := r.LegalActionsFor()
		if la == nil {
			evs = append(evs, runTo(t, r)...)
			break
		}
		evs = append(evs, act(t, r, Action{Seat: la.Seat, Kind: Check})...)
	}
	if !r.Done() {
		t.Fatal("hand should complete")
	}
	// showdown happened
	if !hasEvent(evs, EvShowdown) {
		t.Fatal("expected showdown")
	}
	// awards: two boards, each pot = 150 (300 antes / 2)? No — bomb pot is
	// TWO SEPARATE POTS of the full ante pool: each board awards full 300.
	var awarded int64
	for _, e := range evs {
		if e.Type == EvPotAwarded {
			awarded += e.Amount
		}
	}
	if awarded != 300 {
		t.Fatalf("bomb pot awarded %d, want 300 (each board awards half; both boards sum to ante pool)", awarded)
	}
}

// 7-2 bounty at showdown: winner holding 7 AND 2 gets bounty from each dealt-in player.
func TestSevenDeuceShowdownBounty(t *testing.T) {
	cfg := baseCfg()
	cfg.SevenDeuce = SevenDeuceConfig{Enabled: true, Amount: 500}
	// stacked deck: give seat 1 (bb) 7h 2d; seat 0 (btn/sb) gets trash.
	// heads-up NLHE: deal order btn first (seat0: 2 cards), then seat1.
	hole := cardsFrom(t, "3c", "7h", "3d", "2d") // s0=3c3d, s1=7h2d
	// burn + board: pair the board for seat0's 3s so seat1's 7-high wins?
	// No: seat1 wins with 7 AND 2 only if hand wins. Give board 2 2 →
	// seat1 has 2-2 pair (using 2d hole + board). seat0 has 33 → needs board
	// to not help. Board: 2s 5c 9h Kd 4s → seat1 pair of 2s... seat0 33 wins.
	// Make seat0's cards 3c 3d, board 2s 2c 5d 9h Kd: seat0 = 33 vs seat1 = 22 → seat0 wins, no bounty.
	// Instead: board 7s 2s 5d 9h Kd → seat0: 3+3 nothing = K high... pair? no.
	// seat1: 7h+7s trips vs board. seat1 wins with 7 AND 2 in hand → bounty!
	board := cardsFrom(t, "7s", "2s", "5d", "9h", "Kd")
	// deal order: hole (4) then burn, flop(3), burn, turn, burn, river
	order := append([]Card{}, hole...)
	order = append(order, mustCard(t, "Ah")) // burn
	order = append(order, board[0:3]...)
	order = append(order, mustCard(t, "Ad")) // burn
	order = append(order, board[3])
	order = append(order, mustCard(t, "Ac")) // burn
	order = append(order, board[4])

	seats := seats2()
	r, err := startHand(cfg, seats, fullStackedDeck(t, padTo52(t, order)))
	if err != nil {
		t.Fatal(err)
	}
	evs := tick(t, r)
	// seat0 (btn/sb) first: bet; seat1 calls; runout
	evs = append(evs, act(t, r, Action{Seat: 0, Kind: Call})...)  // limps (call 50 more)
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: Check})...) // bb checks
	// flop 7s 2s 5d: seat0 checks, seat1 bets, seat0 calls... all streets
	for !r.Done() {
		la := r.LegalActionsFor()
		if la == nil {
			evs = append(evs, runTo(t, r)...)
			break
		}
		if la.CallAmount == 0 {
			evs = append(evs, act(t, r, Action{Seat: la.Seat, Kind: Check})...)
		} else {
			evs = append(evs, act(t, r, Action{Seat: la.Seat, Kind: Call})...)
		}
	}

	// seat1 wins showdown with 7h 2d in hand: bounty from seat0
	bounties := 0
	var bountyAmt int64
	for _, e := range evs {
		if e.Type == EvSevenDeuceBounty {
			bounties++
			bountyAmt += e.Amount
		}
	}
	if bounties != 1 || bountyAmt != 500 {
		t.Fatalf("bounties=%d amt=%d, want 1 x 500", bounties, bountyAmt)
	}
	// stacks: seat1 = 10000 + pot (100) + 500 bounty
	s1 := stackFromEvents(t, evs, 1)
	if s1 != 10000+100+500 {
		t.Fatalf("seat1 stack %d, want 10600", s1)
	}
}

func mustCard(t *testing.T, s string) Card {
	t.Helper()
	cs := cardsFrom(t, s)
	return cs[0]
}

// 7-2 uncontested with reveal.
func TestSevenDeuceUncontestedReveal(t *testing.T) {
	cfg := baseCfg()
	cfg.SevenDeuce = SevenDeuceConfig{Enabled: true, Amount: 500}
	// seat0 gets 7c 2c; folds seat1 out preflop
	hole := cardsFrom(t, "7c", "Ah", "2c", "Ad") // s0=7c2c
	seats := seats2()
	r, err := startHand(cfg, seats, fullStackedDeck(t, padTo52(t, hole)))
	if err != nil {
		t.Fatal(err)
	}
	evs := tick(t, r)
	evs = append(evs, act(t, r, Action{Seat: 0, Kind: Raise, Amount: 300})...)
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: Fold})...)

	// reveal decision pending for seat0
	more, err := r.Advance(&Action{Seat: 0, Kind: Reveal})
	if err != nil {
		t.Fatalf("reveal: %v", err)
	}
	evs = append(evs, more...)
	if !hasEvent(evs, EvSevenDeuceBounty) {
		t.Fatal("expected 7-2 bounty after reveal")
	}
	s0 := stackFromEvents(t, evs, 0)
	// seat0: -300 raise + 400 pot (300 own + 100 bb) + 500 bounty = 10600
	if s0 != 10600 {
		t.Fatalf("seat0 stack %d, want 10600", s0)
	}
	if !r.Done() {
		t.Fatal("hand done after reveal (rabbit disabled)")
	}
}

// 7-2 uncontested, winner mucks: no bounty.
func TestSevenDeuceUncontestedMuck(t *testing.T) {
	cfg := baseCfg()
	cfg.SevenDeuce = SevenDeuceConfig{Enabled: true, Amount: 500}
	hole := cardsFrom(t, "7c", "Ah", "2c", "Ad") // s0=7c2c
	r, err := startHand(cfg, seats2(), fullStackedDeck(t, padTo52(t, hole)))
	if err != nil {
		t.Fatal(err)
	}
	evs := tick(t, r)
	evs = append(evs, act(t, r, Action{Seat: 0, Kind: Raise, Amount: 300})...)
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: Fold})...)
	more, err := r.Advance(&Action{Seat: 0, Kind: Muck})
	if err != nil {
		t.Fatalf("muck: %v", err)
	}
	evs = append(evs, more...)
	if hasEvent(evs, EvSevenDeuceBounty) {
		t.Fatal("no bounty after muck")
	}
	s0 := stackFromEvents(t, evs, 0)
	if s0 != 10000-300+400 {
		t.Fatalf("seat0 stack %d, want 10100", s0)
	}
}

// RIT regression: with postflop betting still possible (no all-in), the
// board stays single and no all_in_runout is announced, even though street
// transitions pass through the same code path.
func TestRITNotClonedWhileBettingPossible(t *testing.T) {
	cfg := baseCfg()
	cfg.RunItTwice = RITAlways
	r, err := startHand(cfg, seats2(), mustDeck(t))
	if err != nil {
		t.Fatal(err)
	}
	evs := tick(t, r)
	evs = append(evs, act(t, r, Action{Seat: 0, Kind: Call})...) // SB completes
	evs = append(evs, act(t, r, Action{Seat: 1, Kind: Check})...) // BB checks -> flop
	// postflop betting must still be possible: two boards would be wrong
	if len(r.Board()) != 1 {
		t.Fatalf("board cloned while betting possible: %d boards", len(r.Board()))
	}
	for _, e := range evs {
		if e.Type == EvAllInRunout {
			t.Fatal("all_in_runout announced while betting still possible")
		}
	}
	if la := r.LegalActionsFor(); la == nil {
		t.Fatal("postflop action expected")
	}
	// check it down: BB (seat 1) acts first postflop, every street
	for street := 0; street < 3; street++ {
		evs = append(evs, act(t, r, Action{Seat: 1, Kind: Check})...)
		evs = append(evs, act(t, r, Action{Seat: 0, Kind: Check})...)
	}
	evs = append(evs, runTo(t, r)...)
	if n := len(r.Board()); n != 1 {
		t.Fatalf("final board count = %d, want 1", n)
	}
}

// LoadedDeck + StartHandWithDeck: forced hole delivery order (dev path).
func TestLoadedDeckServesOrderThenRemainder(t *testing.T) {
	prefix := cardsFrom(t, "As", "7d", "2c", "Kh")
	full := padTo52(t, prefix) // all 52, prefix first
	d, err := LoadedDeck(full)
	if err != nil {
		t.Fatalf("LoadedDeck: %v", err)
	}
	got, err := d.Draw(1)
	if err != nil || got[0] != prefix[0] {
		t.Fatalf("first draw = %v (%v), want %v", got, err, prefix[0])
	}
	for i := 1; i < 4; i++ {
		got, err := d.Draw(1)
		if err != nil || got[0] != prefix[i] {
			t.Fatalf("draw %d = %v (%v), want %v", i, got, err, prefix[i])
		}
	}
	if d.remaining != 48 {
		t.Fatalf("remaining = %d, want 48", d.remaining)
	}
}

func TestLoadedDeckRejectsDuplicates(t *testing.T) {
	c := NewCard(5, 0)
	if _, err := LoadedDeck([]Card{c, c}); err == nil {
		t.Fatal("want error on duplicate card")
	}
}

func TestStartHandWithDeckForcesHoles(t *testing.T) {
	cfg := TableConfig{Game: NLHE, SmallBlind: 50, BigBlind: 100, ButtonSeat: 0}
	seats := []SeatState{{Seat: 0, Player: "a", Stack: 10000}, {Seat: 1, Player: "b", Stack: 10000}}
	// dealing is round-major over seat-sorted players: a,b,a,b
	prefix := cardsFrom(t, "Ah", "Ad", "7s", "2s")
	// padTo52 returns all 52 with the prefix first — exactly a full order
	full, err := LoadedDeck(padTo52(t, prefix))
	if err != nil {
		t.Fatalf("LoadedDeck: %v", err)
	}
	r, err := StartHandWithDeck(cfg, seats, full)
	if err != nil {
		t.Fatalf("StartHandWithDeck: %v", err)
	}
	if h := r.HolesFor(0); len(h) != 2 || h[0] != prefix[0] || h[1] != prefix[2] {
		t.Fatalf("seat 0 holes = %v, want [%v %v]", h, prefix[0], prefix[2])
	}
	if h := r.HolesFor(1); len(h) != 2 || h[0] != prefix[1] || h[1] != prefix[3] {
		t.Fatalf("seat 1 holes = %v, want [%v %v]", h, prefix[1], prefix[3])
	}
}
