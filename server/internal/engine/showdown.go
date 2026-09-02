package engine

import (
	"fmt"
	"sort"
)

// potLayer: chips between commitment levels. Players still in the hand
// (not folded) with committed >= cap are eligible to win the layer.
type potLayer struct {
	cap      int64         // commitment level this layer caps at
	amount   int64         // chips in layer
	contrib  map[int]int64 // seat -> chips into this layer
	eligible []int         // seats that can win this layer
}

// buildPots: total committed chips -> side-pot layers by commitment level
// of non-folded players. Folded chips stay in the layers they reached
// (dead money), eligible only to that layer's winner.
func (r *HandRunner) buildPots() []potLayer {
	levels := map[int64]bool{}
	for _, p := range r.players {
		if p.inHand() {
			levels[p.committed] = true
		}
	}
	var sorted []int64
	for l := range levels {
		sorted = append(sorted, l)
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

	var layers []potLayer
	prev := int64(0)
	for _, cap := range sorted {
		if cap <= prev {
			continue
		}
		layer := potLayer{cap: cap, contrib: map[int]int64{}}
		for _, p := range r.players {
			c := min64(p.committed, cap) - min64(p.committed, prev)
			if c > 0 {
				layer.amount += c
				layer.contrib[p.seat] += c
			}
			if p.inHand() && p.committed >= cap {
				layer.eligible = append(layer.eligible, p.seat)
			}
		}
		layers = append(layers, layer)
		prev = cap
	}
	return layers
}

// evalSeat: hand value for seat on board index b.
func (r *HandRunner) evalSeat(seat int, b int) uint32 {
	var p *player
	for i := range r.players {
		if r.players[i].seat == seat {
			p = r.players[i]
			break
		}
	}
	board := r.board[b]
	if r.cfg.Game == PLO4 || r.bombPot {
		var h [4]Card
		copy(h[:], p.hole)
		var bo [5]Card
		copy(bo[:], board)
		return EvaluatePLO(h, bo)
	}
	var seven [7]Card
	copy(seven[:2], p.hole)
	copy(seven[2:], board)
	return Evaluate7(seven)
}

// finishShowdown: reveal, award per board (RIT / bomb pot double board),
// settle 7-2 bounty, end hand.
func (r *HandRunner) finishShowdown() []Event {
	var evs []Event
	layers := r.buildPots()

	var reveals []HoleReveal
	for _, p := range r.players {
		if p.inHand() {
			reveals = append(reveals, HoleReveal{Seat: p.seat, Cards: p.hole})
		}
	}
	evs = append(evs, Event{Type: EvShowdown, HandID: r.handID, Street: Showdown.String(), HoleCards: reveals, Pot: r.potTotal()})

	for b := 0; b < len(r.board); b++ {
		if r.board[b] == nil {
			continue
		}
		// two boards: pot split per board (RIT halves; bomb pot: the single
		// ante pool splits half/half). Odd chip goes to board 0.
		splitCount := len(r.board)
		for li, layer := range layers {
			layerAmt := layer.amount / int64(splitCount)
			if b == 0 {
				layerAmt += layer.amount % int64(splitCount)
			}
			winners := r.winnersForLayer(layer, b)
			share := layerAmt / int64(len(winners))
			rem := layerAmt % int64(len(winners))
			// odd chip(s): first winner left of button (standard rule)
			order := r.seatOrderFromButton()
			wset := map[int]bool{}
			for _, w := range winners {
				wset[w] = true
			}
			oddPaid := false
			for _, seat := range order {
				if !wset[seat] {
					continue
				}
				amt := share
				if rem > 0 && !oddPaid {
					amt += rem
					oddPaid = true
				}
				r.payout(seat, amt)
				evs = append(evs, Event{
					Type:       EvPotAwarded,
					HandID:     r.handID,
					Street:     Showdown.String(),
					Seat:       seat,
					Player:     r.playerBySeat(seat).name,
					Amount:     amt,
					Pot:        layerAmt,
					PotIndex:   li,
					BoardIndex: b,
					Winners: []Winner{{
						Seat:       seat,
						Amount:     amt,
						PotIndex:   li,
						BoardIndex: b,
						BoardCards: r.board[b],
						HandName:   HandCategoryName(r.evalSeat(seat, b)),
					}},
				})
			}
		}
	}

	// 7-2 bounty at showdown: NLHE pot won holding 7 AND 2
	if r.cfg.SevenDeuce.Enabled && r.cfg.Game == NLHE && !r.bombPot {
		if w, ok := r.sevenDeuceShowdownWinner(layers); ok {
			evs = append(evs, r.applySevenDeuce(w)...)
		}
	}

	evs = append(evs, r.endHand()...)
	return evs
}

// seatOrderFromButton: seats clockwise from left of button.
func (r *HandRunner) seatOrderFromButton() []int {
	out := make([]int, 0, len(r.players))
	for i := r.nextIdx(r.btn); len(out) < len(r.players); i = r.nextIdx(i) {
		out = append(out, r.players[i].seat)
	}
	return out
}

func (r *HandRunner) playerBySeat(seat int) *player {
	for _, p := range r.players {
		if p.seat == seat {
			return p
		}
	}
	return nil
}

func (r *HandRunner) payout(seat int, amount int64) {
	r.playerBySeat(seat).stack += amount
}

// payoutOut: award chips out of the live pot — stack up, committed down, so
// potTotal() keeps tracking the pot between Texas Drop rounds (the hand
// doesn't end after most awards).
func (r *HandRunner) payoutOut(seat int, amount int64) {
	p := r.playerBySeat(seat)
	p.stack += amount
	p.committed -= amount
}

// sevenDeuceShowdownWinner: sole pot winner (no split) holding 7 AND 2.
func (r *HandRunner) sevenDeuceShowdownWinner(layers []potLayer) (int, bool) {
	if len(layers) != 1 {
		return 0, false // split/multi-pot: no bounty (house simplification)
	}
	ws := r.winnersForLayer(layers[0], 0)
	if len(ws) != 1 {
		return 0, false
	}
	if !holdsSevenDeuce(r.playerBySeat(ws[0])) {
		return 0, false
	}
	return ws[0], true
}

func holdsSevenDeuce(p *player) bool {
	has7, has2 := false, false
	for _, c := range p.hole {
		if c.Rank() == Rank7 {
			has7 = true
		}
		if c.Rank() == Rank2 {
			has2 = true
		}
	}
	return has7 && has2
}

// applySevenDeuce: every dealt-in player except winner pays bounty.
func (r *HandRunner) applySevenDeuce(winnerSeat int) []Event {
	var evs []Event
	amt := r.cfg.SevenDeuce.Amount
	for _, p := range r.players {
		if p.seat == winnerSeat || len(p.hole) == 0 {
			continue
		}
		pay := min64(amt, p.stack)
		p.stack -= pay
		r.payout(winnerSeat, pay)
		evs = append(evs, Event{Type: EvSevenDeuceBounty, HandID: r.handID, Seat: p.seat, Player: p.name, Amount: pay})
	}
	return evs
}

// finishUncontested: last player standing takes pot; offer reveal (7-2),
// then rabbit hunt.
func (r *HandRunner) finishUncontested() []Event {
	var evs []Event
	w := -1
	for _, p := range r.players {
		if p.inHand() {
			w = p.seat
			break
		}
	}
	if w < 0 {
		return evs
	}
	total := r.potTotal()
	r.payout(w, total)
	evs = append(evs, Event{Type: EvPotAwarded, HandID: r.handID, Seat: w, Player: r.playerBySeat(w).name, Amount: total, Pot: total, Winners: []Winner{{Seat: w, Amount: total}}})

	r.done = true

	// 7-2 uncontested: only if winner reveals (decided via Reveal action)
	if r.cfg.SevenDeuce.Enabled && r.cfg.Game == NLHE && !r.bombPot && holdsSevenDeuce(r.playerBySeat(w)) {
		r.pendingRevealIdx = r.idxOfSeat(w)
	} else if r.cfg.RabbitHunt && !r.bombPot { // offered even preflop (full board rabbited)
		r.rabbitAvailable = true
	}
	// no terminal event yet if a decision is pending
	if r.pendingRevealIdx < 0 && !r.rabbitAvailable {
		evs = append(evs, r.endHand()...)
	}
	return evs
}

// applyPostHand: Reveal/Muck/RabbitHunt decisions.
func (r *HandRunner) applyPostHand(a *Action) ([]Event, error) {
	if r.pendingRevealIdx >= 0 {
		p := r.players[r.pendingRevealIdx]
		if a.Seat != p.seat {
			return nil, fmt.Errorf("waiting on seat %d", p.seat)
		}
		var evs []Event
		r.pendingRevealIdx = -1
		switch a.Kind {
		case Reveal:
			evs = append(evs, Event{Type: EvShowdown, HandID: r.handID, HoleCards: []HoleReveal{{Seat: p.seat, Cards: p.hole}}, Uncontested: true})
			evs = append(evs, r.applySevenDeuce(p.seat)...)
		case Muck:
			// no reveal, no bounty
		default:
			r.pendingRevealIdx = r.idxOfSeat(p.seat) // restore
			return nil, fmt.Errorf("expected Reveal or Muck from seat %d", p.seat)
		}
		if r.cfg.RabbitHunt && !r.bombPot && (r.board == nil || len(r.board[0]) < 5) {
			r.rabbitAvailable = true
			return evs, nil
		}
		evs = append(evs, r.endHand()...)
		return evs, nil
	}
	if r.rabbitAvailable {
		if a.Kind != RabbitHunt && a.Kind != Muck {
			return nil, fmt.Errorf("expected RabbitHunt or Muck")
		}
		r.rabbitAvailable = false
		var evs []Event
		if a.Kind == RabbitHunt && !r.rabbitTaken {
			r.rabbitTaken = true
			// remaining cards: burn convention per street, then board card
			onBoard := 0
			if r.board != nil && r.board[0] != nil {
				onBoard = len(r.board[0])
			}
			need := 5 - onBoard
			var cards []Card
			for i := 0; i < need; i++ {
				burn, _ := r.deck.Draw(1)
				r.dealt = append(r.dealt, burn...)
				c, _ := r.deck.Draw(1)
				r.dealt = append(r.dealt, c...)
				cards = append(cards, c...)
			}
			evs = append(evs, Event{Type: EvRabbitHunt, HandID: r.handID, Rabbit: cards})
		}
		evs = append(evs, r.endHand()...)
		return evs, nil
	}
	return nil, fmt.Errorf("no post-hand action pending")
}

func (r *HandRunner) idxOfSeat(seat int) int {
	for i, p := range r.players {
		if p.seat == seat {
			return i
		}
	}
	return -1
}

// endHand: terminal event with final stacks.
func (r *HandRunner) endHand() []Event {
	r.done = true
	r.rabbitAvailable = false
	return []Event{{Type: EvHandEnded, HandID: r.handID, Stacks: r.Stacks()}}
}

// winnersForLayer: best hand value among layer-eligible players on board b.
func (r *HandRunner) winnersForLayer(layer potLayer, b int) []int {
	var best uint32
	var winners []int
	for _, seat := range layer.eligible {
		v := r.evalSeat(seat, b)
		if v > best {
			best = v
			winners = []int{seat}
		} else if v == best {
			winners = append(winners, seat)
		}
	}
	return winners
}
