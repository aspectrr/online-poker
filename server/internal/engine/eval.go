package engine

// Evaluate7 returns the best 5-card hand value from exactly 7 cards
// (NLHE: 2 hole + 5 board). Higher value wins; equal = tie.
//
// Compact: no 7462-table. For each of the C(7,5)=21 five-card subsets,
// compute a 32-bit value: category<<26 | tiebreak ranks packed 4 bits each.
// Fast enough for friends-only play money (21 subset evals per showdown).
// ponytail: swap in a real 7462 lookup table if profiling demands it.
func Evaluate7(cards [7]Card) uint32 {
	best := uint32(0)
	var idx [5]int
	// iterate all 21 combinations of 5 indices out of 7
	for a := 0; a < 3; a++ {
		for b := a + 1; b < 4; b++ {
			for c := b + 1; c < 5; c++ {
				for d := c + 1; d < 6; d++ {
					for e := d + 1; e < 7; e++ {
						idx = [5]int{a, b, c, d, e}
						var hand [5]Card
						for i, v := range idx {
							hand[i] = cards[v]
						}
						if v := eval5(hand); v > best {
							best = v
						}
					}
				}
			}
		}
	}
	return best
}

// EvaluatePLO: exactly 2 from hole (4 cards) + exactly 3 from board (5 cards).
// C(4,2)*C(5,3) = 6*10 = 60 combos.
func EvaluatePLO(hole [4]Card, board [5]Card) uint32 {
	best := uint32(0)
	for a := 0; a < 3; a++ {
		for b := a + 1; b < 4; b++ {
			h0, h1 := hole[a], hole[b]
			for i := 0; i < 3; i++ {
				for j := i + 1; j < 4; j++ {
					for k := j + 1; k < 5; k++ {
						if v := eval5([5]Card{h0, h1, board[i], board[j], board[k]}); v > best {
							best = v
						}
					}
				}
			}
		}
	}
	return best
}

// eval5: value = category<<26 | r0<<22 | r1<<18 | ... (4 bits/rank, 5 ranks).
// Categories: 8=straight flush, 7=quads, 6=full house, 5=flush, 4=straight,
// 3=trips, 2=two pair, 1=pair, 0=high card.
// Backed by prime-product lookup tables (see evaltables.go) — ~10x faster
// than the analytical version, which survives as eval5Analytical (used to
// generate the tables at init).
func eval5(c [5]Card) uint32 {
	if s := c[0].Suit(); c[1].Suit() == s && c[2].Suit() == s && c[3].Suit() == s && c[4].Suit() == s {
		prod := uint32(1)
		for _, card := range c {
			prod *= rankPrimes[card.Rank()]
		}
		return flushLookup[prod]
	}
	prod := uint32(1)
	for _, card := range c {
		prod *= rankPrimes[card.Rank()]
	}
	return unsuitedLookup[prod]
}

// HandCategoryName for events/notes.
func HandCategoryName(v uint32) string {
	switch v >> 26 {
	case 8:
		// royal = ace-high straight flush (tb[0] holds the straight high)
		if (v>>22)&0xF == 12 {
			return "royal_flush"
		}
		return "straight_flush"
	case 7:
		return "quads"
	case 6:
		return "full_house"
	case 5:
		return "flush"
	case 4:
		return "straight"
	case 3:
		return "trips"
	case 2:
		return "two_pair"
	case 1:
		return "pair"
	default:
		return "high_card"
	}
}

// EvaluatePartial: best 5-card value from 5..7 cards — live hand naming
// on earlier streets (flop = 5 cards, turn = 6, river = full Evaluate7).
func EvaluatePartial(cards []Card) uint32 {
	switch len(cards) {
	case 5:
		var h [5]Card
		copy(h[:], cards)
		return eval5(h)
	case 6:
		best := uint32(0)
		for skip := 0; skip < 6; skip++ {
			var h [5]Card
			j := 0
			for i := 0; i < 6; i++ {
				if i != skip {
					h[j] = cards[i]
					j++
				}
			}
			if v := eval5(h); v > best {
				best = v
			}
		}
		return best
	default:
		var h [7]Card
		copy(h[:], cards)
		return Evaluate7(h)
	}
}

// EvaluatePLOPartial: PLO rule (exactly 2 hole + exactly 3 board) over a
// board that may still be growing (3 = flop, 4 = turn, 5 = river).
func EvaluatePLOPartial(hole [4]Card, board []Card) uint32 {
	best := uint32(0)
	for a := 0; a < 3; a++ {
		for b := a + 1; b < 4; b++ {
			for i := 0; i+2 < len(board); i++ {
				for j := i + 1; j+1 < len(board); j++ {
					for k := j + 1; k < len(board); k++ {
						hand := [5]Card{hole[a], hole[b], board[i], board[j], board[k]}
						if v := eval5(hand); v > best {
							best = v
						}
					}
				}
			}
		}
	}
	return best
}
