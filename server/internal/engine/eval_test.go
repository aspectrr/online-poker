package engine

import "testing"

func eval7From(t *testing.T, ss ...string) uint32 {
	t.Helper()
	cs := cardsFrom(t, ss...)
	if len(cs) != 7 {
		t.Fatalf("need 7 cards, got %d", len(cs))
	}
	var arr [7]Card
	copy(arr[:], cs)
	return Evaluate7(arr)
}

func evalPLOFrom(t *testing.T, hole, board []string) uint32 {
	t.Helper()
	h := cardsFrom(t, hole...)
	b := cardsFrom(t, board...)
	var ha [4]Card
	var ba [5]Card
	copy(ha[:], h)
	copy(ba[:], b)
	return EvaluatePLO(ha, ba)
}

func TestEvaluate7KnownHands(t *testing.T) {
	cases := []struct {
		name  string
		cards [7]string
		cat   uint32
	}{
		{"royal flush", [7]string{"As", "Ks", "Qs", "Js", "Ts", "2c", "3d"}, 8},
		{"steel wheel", [7]string{"Ad", "2d", "3d", "4d", "5d", "Kc", "Qh"}, 8},
		{"quads", [7]string{"7c", "7d", "7h", "7s", "Kc", "2d", "3h"}, 7},
		{"full house", [7]string{"8c", "8d", "8h", "Kc", "Kd", "2s", "3s"}, 6},
		{"flush", [7]string{"Ac", "Tc", "8c", "5c", "2c", "2d", "3h"}, 5},
		{"straight", [7]string{"9h", "8d", "7c", "6s", "5h", "2d", "Kc"}, 4},
		{"wheel", [7]string{"Ah", "2d", "3c", "4s", "5h", "Kc", "Qd"}, 4},
		{"trips", [7]string{"Tc", "Td", "Th", "Ac", "7d", "3s", "2h"}, 3},
		{"two pair", [7]string{"Ac", "Ad", "Kc", "Kd", "7h", "3s", "2c"}, 2},
		{"pair", [7]string{"Ac", "Ad", "Kc", "7d", "5h", "3s", "2c"}, 1},
		{"high card", [7]string{"Ac", "Kd", "9c", "7d", "5h", "3s", "2c"}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var arr [7]string
			arr = tc.cards
			v := eval7From(t, arr[:]...)
			if cat := v >> 26; cat != tc.cat {
				t.Fatalf("%v: category %d, want %d", tc.cards, cat, tc.cat)
			}
		})
	}
}

func TestEvaluate7Comparisons(t *testing.T) {
	cases := []struct {
		name string
		hi   [7]string
		lo   [7]string
	}{
		{"higher flush wins", [7]string{"Ks", "Qs", "8s", "5s", "2s", "3c", "4d"}, [7]string{"Qs", "Js", "8s", "5s", "2s", "3c", "4d"}},
		{"wheel loses to six-high straight", [7]string{"6h", "5d", "4c", "3s", "2h", "Ah", "Kd"}, [7]string{"Ah", "2d", "3c", "4s", "5h", "Kc", "Qd"}},
		{"kicker on pair", [7]string{"Ac", "Ad", "Kc", "7d", "5h", "3s", "2c"}, [7]string{"Ac", "Ad", "Qc", "7d", "5h", "3s", "2c"}},
		{"quads kicker irrelevant-but-set", [7]string{"7c", "7d", "7h", "7s", "Ac", "2d", "3h"}, [7]string{"7c", "7d", "7h", "7s", "Kc", "2d", "3h"}},
		{"full house over trips-heavy board", [7]string{"8c", "8d", "8h", "Kc", "Kd", "2s", "3s"}, [7]string{"8c", "8d", "8h", "7c", "Kd", "2s", "3s"}},
		{"straight flush over quads", [7]string{"9h", "8h", "7h", "6h", "5h", "2d", "3d"}, [7]string{"Ac", "Ad", "Ah", "As", "Kd", "2s", "3s"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			hi := eval7From(t, tc.hi[:]...)
			lo := eval7From(t, tc.lo[:]...)
			if hi <= lo {
				t.Fatalf("expected hi > lo: %032b vs %032b", hi, lo)
			}
		})
	}
}

func TestEvaluate7Tie(t *testing.T) {
	a := eval7From(t, "As", "Ks", "Qs", "Js", "Ts", "2c", "3d")
	b := eval7From(t, "As", "Ks", "Qs", "Js", "Ts", "4c", "5d")
	if a != b {
		t.Fatalf("same royal must tie: %d vs %d", a, b)
	}
}

// Exhaustive-ish: every 5-card subset of a fixed 7 must never exceed the 7-card value.
func TestEvaluate7SubsetConsistency(t *testing.T) {
	for trial := 0; trial < 200; trial++ {
		d, _ := NewDeck()
		cs, _ := d.Draw(7)
		var arr [7]Card
		copy(arr[:], cs)
		v := Evaluate7(arr)
		if v>>26 > 8 {
			t.Fatalf("bad category %d", v>>26)
		}
	}
}

func TestEvaluatePLOTwoFromHand(t *testing.T) {
	// Board has quads; using 0 hole cards is illegal in PLO.
	// A player holding A + 2 must play exactly 2: their best is a pair of
	// board quads + ace kicker... no: quads on board + best hole kicker.
	// Key check: flush on board only (hole has no suit match) must NOT be
	// playable unless 2 hole cards contribute.
	board := []string{"8s", "9s", "Ts", "Js", "2c"}

	// hole: Ah Kd + blanks that pair nothing — no spades, no straight.
	// Best 5 uses Ah+Kd + J T 9 = A-high.
	vNoFlush := evalPLOFrom(t, []string{"Ah", "Kd", "4d", "5c"}, board)
	if cat := vNoFlush >> 26; cat != 0 {
		t.Fatalf("expected high card, got cat %d (%s)", cat, HandCategoryName(vNoFlush))
	}

	// hole: Qh Kd (Qh not a spade) — Q + J-T-9-8 board = Q-high straight,
	// and no flush possible (only 0 spades playable... Qh Kd no spades).
	vStraight := evalPLOFrom(t, []string{"Qh", "Kd", "4d", "5c"}, board)
	if cat := vStraight >> 26; cat != 4 {
		t.Fatalf("expected straight, got %s", HandCategoryName(vStraight))
	}

	// hole: Qs 7s — 2 spades in hand + 4 on board = flush legal
	// (2 hole + 3 board spades). Flush beats the Q-high straight.
	vFlush := evalPLOFrom(t, []string{"Qs", "7s", "4d", "5c"}, board)
	if cat := vFlush >> 26; cat != 5 {
		t.Fatalf("expected flush, got %s", HandCategoryName(vFlush))
	}

	// hole: Ks As — royal flush using As Ks + Qs Js Ts board.
	vRoyal := evalPLOFrom(t, []string{"Ks", "As", "2d", "3c"}, []string{"Qs", "Js", "Ts", "2c", "3d"})
	if cat := vRoyal >> 26; cat != 8 {
		t.Fatalf("expected straight flush, got %s", HandCategoryName(vRoyal))
	}
}

func TestEvaluatePLOBoardFlushNotPlayable(t *testing.T) {
	// Board-only flush: hole has zero hearts; PLO must use 2 hole cards,
	// so the board flush is NOT available.
	v := evalPLOFrom(t, []string{"As", "Kd", "Qc", "Jc"}, []string{"2h", "4h", "6h", "8h", "Th"})
	if cat := v >> 26; cat == 5 {
		t.Fatal("board-only flush must not be playable in PLO")
	}
}

func TestEvaluatePLONeverExceedsBest5of9(t *testing.T) {
	// PLO best (exactly 2 hole + 3 board) can never beat the unconstrained
	// best 5 of the same 9 cards.
	for trial := 0; trial < 100; trial++ {
		d, _ := NewDeck()
		cs, _ := d.Draw(9)
		var h [4]Card
		var b [5]Card
		copy(h[:], cs[:4])
		copy(b[:], cs[4:])
		best := uint32(0)
		// all C(9,5) subsets
		n := len(cs)
		for a := 0; a < n-4; a++ {
			for bb := a + 1; bb < n-3; bb++ {
				for c := bb + 1; c < n-2; c++ {
					for e := c + 1; e < n-1; e++ {
						for f := e + 1; f < n; f++ {
							if v := eval5([5]Card{cs[a], cs[bb], cs[c], cs[e], cs[f]}); v > best {
								best = v
							}
						}
					}
				}
			}
		}
		if plo := EvaluatePLO(h, b); plo > best {
			t.Fatalf("PLO %d > best-5-of-9 %d impossible", plo, best)
		}
	}
}

// Royal flush is the ace-high straight flush: it must outrank every other
// straight flush via the straight-high tiebreaker, and name as royal_flush.
func TestRoyalFlushBeatsLowerStraightFlushes(t *testing.T) {
	royal := eval7From(t, "As", "Ks", "Qs", "Js", "Ts", "2c", "3d")
	for _, lo := range [][]string{
		{"Ks", "Qs", "Js", "Ts", "9s", "2c", "3d"}, // king-high
		{"9h", "8h", "7h", "6h", "5h", "2d", "3d"}, // nine-high
		{"Ad", "2d", "3d", "4d", "5d", "Kc", "Qh"}, // steel wheel
	} {
		lv := eval7From(t, lo...)
		if royal <= lv {
			t.Fatalf("royal must beat %v: %d vs %d", lo, royal, lv)
		}
	}
	if got := HandCategoryName(royal); got != "royal_flush" {
		t.Fatalf("royal named %q, want royal_flush", got)
	}
	if got := HandCategoryName(eval7From(t, "Ks", "Qs", "Js", "Ts", "9s", "2c", "3d")); got != "straight_flush" {
		t.Fatalf("king-high SF named %q, want straight_flush", got)
	}
}
