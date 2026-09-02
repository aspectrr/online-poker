package engine

import "fmt"

// Texas Drop: one HandRunner spans the whole game. Per round: fresh board
// runs out, every in-hand player secretly picks stay or drop, then one
// reveal resolves the round:
//
//   - 1 stayer  -> takes the pot, game over
//   - 2+ stayers -> best hand wins; each losing stayer pays the pot amount
//     back in (capped at stack), fresh board, next round
//   - 0 stayers -> everyone re-antes, fresh board, next round
//
// Dropping folds the seat (mucked, out of the drop game). Staying is free —
// only losing stayers pay.

// dealDropBoard: burn + full 5-card board for this round, then open the
// stay/drop decision phase. ponytail: fresh deck from round 2 — a single
// shared deck runs dry after 4 rounds 9-handed (18 hole + 8×5); round 1
// keeps the initial deck so stacked-deck tests (and dealt-card history)
// stay coherent.
func (r *HandRunner) dealDropBoard() []Event {
	var evs []Event
	if r.dropRound > 1 {
		if d, err := NewDeck(); err == nil {
			r.deck = d
		}
	}
	r.board = [][]Card{nil}
	for _, n := range []int{3, 1, 1} {
		r.street++
		burn, _ := r.deck.Draw(1)
		r.dealt = append(r.dealt, burn...)
		cards, _ := r.deck.Draw(n)
		r.dealt = append(r.dealt, cards...)
		r.board[0] = append(r.board[0], cards...)
		evs = append(evs, Event{Type: EvStreetDealt, HandID: r.handID, Street: r.street.String(), Cards: cards, Pot: r.potTotal()})
	}
	for i := range r.players {
		r.players[i].streetBet = 0
	}
	r.street = Drop
	r.dropDecided = map[int]ActionKind{}
	evs = append(evs, Event{
		Type:    EvDropDecide,
		HandID:  r.handID,
		Round:   r.dropRound,
		Pot:     r.potTotal(),
		Waiting: r.undecidedCount(),
	})
	return evs
}

// applyDropDecision: record one seat's stay/drop. Decisions are secret and
// simultaneous — the only event is a private ack the transport delivers to
// the decider alone; the reveal happens once everyone is in.
func (r *HandRunner) applyDropDecision(a *Action) ([]Event, error) {
	if r.done || r.street != Drop {
		return nil, fmt.Errorf("no drop decision pending")
	}
	i := r.idxOfSeat(a.Seat)
	if i < 0 || !r.players[i].inHand() {
		return nil, fmt.Errorf("seat %d is not in the drop game", a.Seat)
	}
	if _, decided := r.dropDecided[i]; decided {
		return nil, fmt.Errorf("seat %d already decided", a.Seat)
	}
	r.dropDecided[i] = a.Kind
	return []Event{{
		Type: EvDropDecided, HandID: r.handID, Round: r.dropRound,
		Seat: a.Seat, Player: r.players[i].name, Stay: a.Kind == Stay,
	}}, nil
}

// resolveDropRound: all decisions in — reveal, pay out, set up the next
// round (or end the game). Runs inside autoAdvance when nothing is pending.
func (r *HandRunner) resolveDropRound() []Event {
	var evs []Event
	pot := r.potTotal()

	var stayers []int
	decisions := make([]DropDecision, 0, len(r.players))
	for i, p := range r.players {
		if !p.inHand() {
			continue
		}
		kind := r.dropDecided[i] // all decided: anyPendingActor guards the loop
		stay := kind == Stay
		decisions = append(decisions, DropDecision{Seat: p.seat, Stay: stay})
		if stay {
			stayers = append(stayers, i)
		}
	}
	evs = append(evs, Event{
		Type: EvDropReveal, HandID: r.handID, Round: r.dropRound,
		Decisions: decisions, Pot: pot,
	})

	switch {
	case len(stayers) == 1:
		// sole stayer takes the pot — game over
		w := r.players[stayers[0]]
		r.payoutOut(w.seat, pot)
		evs = append(evs, Event{
			Type: EvPotAwarded, HandID: r.handID, Street: Drop.String(),
			Seat: w.seat, Player: w.name, Amount: pot, Pot: pot, Round: r.dropRound,
			Winners: []Winner{{Seat: w.seat, Amount: pot}},
		})
		evs = append(evs, r.endHand()...)
		return evs

	case len(stayers) == 0:
		// nobody stayed: nobody is out — everyone re-antes and the same crew
		// goes again on a fresh board
		collected := int64(0)
		for _, p := range r.players {
			if !p.inHand() {
				continue
			}
			a := min64(r.cfg.TexasDropAnte, p.stack)
			if a <= 0 {
				continue
			}
			p.stack -= a
			p.committed += a
			p.streetBet += a
			collected += a
			evs = append(evs, Event{Type: EvAntesPosted, HandID: r.handID, Street: Drop.String(), Seat: p.seat, Player: p.name, Amount: a, Pot: pot + collected, Round: r.dropRound})
		}
		if collected == 0 {
			// nobody can re-ante and nobody stayed: split the stranded pot
			// among the remaining players so the game can't soft-lock
			evs = append(evs, r.splitStrandedPot(pot)...)
			evs = append(evs, r.endHand()...)
			return evs
		}

	default:
		// 2+ stayers: droppers muck out; stayers reveal, best hand takes the
		// pot, the rest replenish it
		for _, p := range r.players {
			if p.inHand() {
				if i := r.idxOfSeat(p.seat); r.dropDecided[i] == DropOut {
					p.folded = true
				}
			}
		}
		var reveals []HoleReveal
		for _, i := range stayers {
			reveals = append(reveals, HoleReveal{Seat: r.players[i].seat, Cards: r.players[i].hole})
		}
		evs = append(evs, Event{Type: EvShowdown, HandID: r.handID, Street: Drop.String(), HoleCards: reveals, Pot: pot, Round: r.dropRound})

		best := uint32(0)
		var winners []int
		for _, i := range stayers {
			v := r.evalSeat(r.players[i].seat, 0)
			if v > best {
				best, winners = v, []int{i}
			} else if v == best {
				winners = append(winners, i)
			}
		}
		// split the pot between tied winners, odd chip left of button
		share := pot / int64(len(winners))
		rem := pot % int64(len(winners))
		order := r.seatOrderFromButton()
		wset := map[int]bool{}
		for _, i := range winners {
			wset[i] = true
		}
		oddPaid := false
		for _, seat := range order {
			for _, i := range winners {
				if r.players[i].seat != seat {
					continue
				}
				amt := share
				if rem > 0 && !oddPaid {
					amt += rem
					oddPaid = true
				}
				r.payoutOut(seat, amt)
				evs = append(evs, Event{
					Type: EvPotAwarded, HandID: r.handID, Street: Drop.String(),
					Seat: seat, Player: r.players[i].name, Amount: amt, Pot: pot, Round: r.dropRound,
					Winners: []Winner{{Seat: seat, Amount: amt, BoardCards: r.board[0], HandName: HandCategoryName(best)}},
				})
			}
		}

		// losing stayers put the pot amount back in (capped at stack)
		replenished := int64(0)
		for _, i := range stayers {
			if wset[i] {
				continue
			}
			p := r.players[i]
			pay := min64(pot, p.stack)
			if pay > 0 {
				p.stack -= pay
				p.committed += pay
				p.streetBet += pay
				replenished += pay
				evs = append(evs, Event{
					Type: EvDropReplenish, HandID: r.handID, Street: Drop.String(),
					Seat: p.seat, Player: p.name, Amount: pay, Pot: pot + replenished, Round: r.dropRound,
				})
			}
		}
		if replenished == 0 {
			// pot fully claimed, nobody could replenish — nothing left to
			// play for
			evs = append(evs, r.endHand()...)
			return evs
		}
	}

	// next round
	r.dropRound++
	r.street = Preflop
	r.board = nil
	r.dropDecided = map[int]ActionKind{}
	for i := range r.players {
		r.players[i].streetBet = 0
	}
	return evs
}

// splitStrandedPot: split `pot` evenly among remaining in-hand players,
// odd chip left of button (all-broke stalemate termination).
func (r *HandRunner) splitStrandedPot(pot int64) []Event {
	if pot <= 0 {
		return nil
	}
	var in []int
	for i, p := range r.players {
		if p.inHand() {
			in = append(in, i)
		}
	}
	if len(in) == 0 {
		return nil
	}
	var evs []Event
	share := pot / int64(len(in))
	rem := pot % int64(len(in))
	oddPaid := false
	for _, seat := range r.seatOrderFromButton() {
		for _, i := range in {
			if r.players[i].seat != seat {
				continue
			}
			amt := share
			if rem > 0 && !oddPaid {
				amt += rem
				oddPaid = true
			}
			r.payoutOut(seat, amt)
			evs = append(evs, Event{
				Type: EvPotAwarded, HandID: r.handID, Street: Drop.String(),
				Seat: seat, Player: r.players[i].name, Amount: amt, Pot: pot, Round: r.dropRound,
				Reason:  "stalemate — pot split",
				Winners: []Winner{{Seat: seat, Amount: amt}},
			})
		}
	}
	return evs
}

func (r *HandRunner) undecidedCount() int {
	n := 0
	for i, p := range r.players {
		if _, decided := r.dropDecided[i]; p.inHand() && !decided {
			n++
		}
	}
	return n
}
