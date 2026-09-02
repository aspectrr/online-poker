package engine

import "math/rand"

// All-in equity: when a runout begins, every in-hand player's expected pot
// share is computed by Monte-Carlo over the unseen cards and emitted on the
// all_in_runout event so the table can watch who has the upper hand.

// computeEquities: expected share per in-hand player, 0-100 (sums to ~100).
// Multi-board hands (RIT / double-board bomb pot) weight each board equally.
func (r *HandRunner) computeEquities() []Equity {
	var in []*player
	for _, p := range r.players {
		if p.inHand() {
			in = append(in, p)
		}
	}
	if len(in) < 2 {
		return nil
	}
	unseen := r.deck.Remaining()
	boards := len(r.board)
	if boards == 0 {
		boards = 1
	}
	need := 5
	if r.board != nil && len(r.board[0]) > 0 {
		need = 5 - len(r.board[0])
	}
	if need < 0 || len(unseen) < need*boards {
		return nil
	}
	samples := 2000
	if need == 0 {
		samples = 1 // board already complete: the answer is exact
	}

	shareSum := make([]float64, len(in))
	perm := append([]Card(nil), unseen...)
	full := make([]Card, 0, 5)
	for range samples {
		if need > 0 {
			rand.Shuffle(len(perm), func(i, j int) { perm[i], perm[j] = perm[j], perm[i] })
		}
		shares := make([]float64, len(in))
		off := 0
		for b := 0; b < boards; b++ {
			var base []Card
			if r.board != nil && r.board[b] != nil {
				base = r.board[b]
			}
			full = append(full[:0], base...)
			full = append(full, perm[off:off+need]...)
			off += need

			best := uint32(0)
			var ws []int
			for i, p := range in {
				v := evalOn(r.cfg.Game, r.bombPot, p.hole, full)
				if v > best {
					best, ws = v, []int{i}
				} else if v == best {
					ws = append(ws, i)
				}
			}
			share := 1 / float64(len(ws))
			for _, i := range ws {
				shares[i] += share
			}
		}
		for i, sh := range shares {
			shareSum[i] += sh / float64(boards)
		}
	}

	out := make([]Equity, len(in))
	for i, p := range in {
		out[i] = Equity{Seat: p.seat, Pct: int(0.5 + 100*shareSum[i]/float64(samples))}
	}
	return out
}

// evalOn: hand value for one hole+board combination.
func evalOn(game GameType, ploHoles bool, hole, board []Card) uint32 {
	if game == PLO4 || ploHoles {
		var h [4]Card
		copy(h[:], hole)
		var bo [5]Card
		copy(bo[:], board)
		return EvaluatePLO(h, bo)
	}
	var seven [7]Card
	copy(seven[:2], hole)
	copy(seven[2:], board)
	return Evaluate7(seven)
}
