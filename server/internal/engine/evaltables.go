package engine

// Deuces-style lookup tables (idea from github.com/chehsunliu/poker, which
// benchmarks 6.2x faster than the analytical eval5): eval5 becomes one
// prime-product table hit. Tables are generated at init from eval5 itself,
// so the encoding (category<<26 | packed tiebreakers) is identical by
// construction — golden/fuzz tests validate it unchanged.
//
// Rank primes: products of 5 ranks (with repetition, max 4 of a kind)
// stay under 2^31, so keys are plain uint32 maps (~7.5k entries total).
// ponytail: if profiles ever demand it, swap the maps for tiered arrays.

var (
	unsuitedLookup map[uint32]uint32 // non-flush 5-card hands
	flushLookup    map[uint32]uint32 // flushes (5 distinct ranks, one suit)
)

var rankPrimes = [13]uint32{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41}

func init() {
	unsuitedLookup = make(map[uint32]uint32, 6188)
	flushLookup = make(map[uint32]uint32, 1287)

	// Unsuited: every rank multiset of size 5 (C(13+5-1,5) = 6188, quad
	// multiplicities included). Suits alternate so the sample hand is never
	// a flush; the value depends only on ranks.
	var counts [13]int
	var multiset func(pos, left int, prod uint32)
	multiset = func(pos, left int, prod uint32) {
		if pos == 13 {
			if left != 0 {
				return
			}
			var c [5]Card
			i := 0
			for r := 0; r < 13; r++ {
				for k := 0; k < counts[r]; k++ {
					c[i] = NewCard(r, [3]int{0, 1, 2}[i%3])
					i++
				}
			}
			unsuitedLookup[prod] = eval5Analytical(c)
			return
		}
		for k := 0; k <= left && k <= 4; k++ { // max 4 of a rank in a real hand
			counts[pos] = k
			p := prod
			for j := 0; j < k; j++ {
				p *= rankPrimes[pos]
			}
			multiset(pos+1, left-k, p)
		}
	}
	multiset(0, 5, 1)

	// Flush: every 5-subset of distinct ranks (C(13,5) = 1287), all one suit.
	var subset func(start, have int, bits uint32, prod uint32, ranks [5]int)
	subset = func(start, have int, bits, prod uint32, ranks [5]int) {
		if have == 5 {
			var c [5]Card
			for i, r := range ranks {
				c[i] = NewCard(r, 0)
			}
			flushLookup[prod] = eval5Analytical(c)
			return
		}
		for r := start; r <= 12-(4-have); r++ {
			ranks[have] = r
			subset(r+1, have+1, bits|1<<r, prod*rankPrimes[r], ranks)
		}
	}
	subset(0, 0, 0, 1, [5]int{})
}

func primeProductOfRanks(bits uint32) uint32 {
	p := uint32(1)
	for r := 0; r < 13; r++ {
		if bits&(1<<r) != 0 {
			p *= rankPrimes[r]
		}
	}
	return p
}

// eval5Analytical is the original counting evaluator. It now exists only to
// generate the tables (and as the semantic reference for them).
func eval5Analytical(c [5]Card) uint32 {
	var rankCounts [13]uint8
	var suitCounts [4]uint8
	for _, card := range c {
		rankCounts[card.Rank()]++
		suitCounts[card.Suit()]++
	}

	flush := false
	for _, n := range suitCounts {
		if n == 5 {
			flush = true
		}
	}

	// distinct ranks ordered by count desc, then rank desc
	// (so quads/full-house/two-pair put the significant rank first
	// even when a singleton kicker outranks it)
	var ranks []int
	for cnt := uint8(4); cnt >= 1; cnt-- {
		for r := 12; r >= 0; r-- {
			if rankCounts[r] == cnt {
				ranks = append(ranks, r)
			}
		}
	}

	// straight detection (wheel-aware). Returns top rank of straight or -1.
	straightHigh := func() int {
		if len(ranks) != 5 {
			return -1
		}
		// ranks descending consecutive?
		if ranks[0]-ranks[4] == 4 {
			return ranks[0]
		}
		// wheel: A-5 (A=12, 5=3, 4=2, 3=1, 2=0) -> top is 5 (rank 3)
		if ranks[0] == 12 && ranks[1] == 3 && ranks[2] == 2 && ranks[3] == 1 && ranks[4] == 0 {
			return 3
		}
		return -1
	}()

	var cat int
	var tb [5]int // tiebreakers, most significant first
	switch {
	case flush && straightHigh >= 0:
		cat = 8
		tb[0] = straightHigh
	case rankCounts[ranks[0]] == 4:
		cat = 7
		tb[0] = ranks[0]
		tb[1] = ranks[1]
	case rankCounts[ranks[0]] == 3 && rankCounts[ranks[1]] == 2:
		cat = 6
		tb[0] = ranks[0]
		tb[1] = ranks[1]
	case flush:
		cat = 5
		copy(tb[:], ranks)
	case straightHigh >= 0:
		cat = 4
		tb[0] = straightHigh
	case rankCounts[ranks[0]] == 3:
		cat = 3
		tb[0] = ranks[0]
		tb[1] = ranks[1]
		tb[2] = ranks[2]
	case rankCounts[ranks[0]] == 2 && rankCounts[ranks[1]] == 2:
		cat = 2
		tb[0] = ranks[0]
		tb[1] = ranks[1]
		tb[2] = ranks[2]
	case rankCounts[ranks[0]] == 2:
		cat = 1
		tb[0] = ranks[0]
		copy(tb[1:3], ranks[1:3])
		tb[3] = ranks[3]
	default: // high card
		cat = 0
		copy(tb[:], ranks)
	}

	v := uint32(cat) << 26
	for i := 0; i < 5; i++ {
		v |= uint32(tb[i]&0xF) << uint(22-4*i)
	}
	return v
}
