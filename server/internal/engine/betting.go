package engine

import "fmt"

// Advance processes one action (nil = tick: drain setup events, close
// streets, run out boards after all-ins). Returns events since last call.
//
// Lifecycle: betting until streets complete; if one player remains the hand
// finishes uncontested (winner may be offered Reveal/Muck for 7-2 bounty,
// then RabbitHunt if enabled). Advance returns an error once fully terminal.
func (r *HandRunner) Advance(a *Action) ([]Event, error) {
	if r.done && r.pendingRevealIdx < 0 && !r.rabbitAvailable {
		return nil, fmt.Errorf("hand over")
	}
	var evs []Event

	if r.setupEvents != nil {
		evs = append(evs, r.setupEvents...)
		r.setupEvents = nil
	}

	if a != nil {
		more, err := r.applyAction(a)
		if err != nil {
			return append(evs, more...), err
		}
		evs = append(evs, more...)
	}

	if !r.done {
		evs = append(evs, r.autoAdvance()...)
	}
	return evs, nil
}

// canAct: players with chips still in hand. Betting possible only if >= 2.
func (r *HandRunner) canActCount() int {
	n := 0
	for _, p := range r.players {
		if p.inHand() && !p.allIn {
			n++
		}
	}
	return n
}

// anyPendingActor: someone owes a decision (owes chips or hasn't acted
// since the last aggression). During a Texas Drop decision phase, every
// in-hand player owes a stay/drop. A lone chip-holder never gets prompted
// once all bets are matched — the hand runs out instead.
func (r *HandRunner) anyPendingActor() bool {
	if r.street == Drop {
		for i, p := range r.players {
			if _, ok := r.dropDecided[i]; p.inHand() && !ok {
				return true
			}
		}
		return false
	}
	lone := r.canActCount() < 2
	for i, p := range r.players {
		if !p.inHand() || p.allIn {
			continue
		}
		if p.streetBet < r.highBet {
			return true // owes chips: must call/fold even heads-up vs all-in
		}
		if !lone && !r.responded[i] {
			return true
		}
	}
	return false
}

// autoAdvance: while nobody owes action, progress streets / finish hand.
func (r *HandRunner) autoAdvance() []Event {
	var evs []Event
	for !r.done && !r.anyPendingActor() {
		if r.activeCount() <= 1 {
			evs = append(evs, r.finishUncontested()...)
			return evs
		}
		switch {
		case r.street == Preflop && r.bombPot:
			evs = append(evs, r.dealBombFlop()...)
		case r.street == Preflop && r.texasDrop:
			evs = append(evs, r.dealDropBoard()...)
		case r.street == Drop:
			evs = append(evs, r.resolveDropRound()...)
		case r.street < River:
			evs = append(evs, r.beginRunoutIfNeeded())
			evs = append(evs, r.dealNextStreet()...)
		case r.street == River:
			evs = append(evs, r.finishShowdown()...)
		default:
			return evs
		}
	}
	return evs
}

// applyAction validates and applies one player action.
func (r *HandRunner) applyAction(a *Action) ([]Event, error) {
	if a.Kind == Stay || a.Kind == DropOut {
		return r.applyDropDecision(a)
	}
	if a.Kind == Reveal || a.Kind == Muck || a.Kind == RabbitHunt {
		return r.applyPostHand(a)
	}
	if r.pendingRevealIdx >= 0 {
		return nil, fmt.Errorf("waiting on reveal decision from seat %d", r.players[r.pendingRevealIdx].seat)
	}
	if r.toActIdx < 0 {
		return nil, fmt.Errorf("no action pending")
	}
	p := r.players[r.toActIdx]
	if a.Seat != p.seat {
		return nil, fmt.Errorf("not seat %d's turn (seat %d to act)", a.Seat, p.seat)
	}

	la := r.legalActions()
	var evs []Event
	switch a.Kind {
	case Fold:
		p.folded = true
		evs = append(evs, Event{Type: EvActionAccepted, HandID: r.handID, Street: r.street.String(), Seat: p.seat, Player: p.name, Action: &Action{Seat: p.seat, Kind: Fold}})
		r.advanceTurn()

	case Check:
		if !la.CanCheck {
			return nil, fmt.Errorf("check illegal: owe %d", la.CallAmount)
		}
		evs = append(evs, Event{Type: EvActionAccepted, HandID: r.handID, Street: r.street.String(), Seat: p.seat, Player: p.name, Action: &Action{Seat: p.seat, Kind: Check}})
		r.responded[r.toActIdx] = true
		r.advanceTurn()

	case Call:
		if !la.CanCall {
			return nil, fmt.Errorf("call illegal: nothing to call")
		}
		pay := min64(la.CallAmount, p.stack)
		p.stack -= pay
		p.committed += pay
		p.streetBet += pay
		if p.stack == 0 {
			p.allIn = true
		}
		evs = append(evs, Event{Type: EvActionAccepted, HandID: r.handID, Street: r.street.String(), Seat: p.seat, Player: p.name, Amount: pay, Action: &Action{Seat: p.seat, Kind: Call}})
		r.responded[r.toActIdx] = true
		r.advanceTurn()

	case Raise:
		if !la.CanRaise {
			return nil, fmt.Errorf("raise illegal (stack=%d highBet=%d)", p.stack, r.highBet)
		}
		if a.Amount < la.MinRaiseTo || a.Amount > la.MaxRaiseTo {
			return nil, fmt.Errorf("raise TO %d out of bounds [%d, %d]", a.Amount, la.MinRaiseTo, la.MaxRaiseTo)
		}
		pay := a.Amount - p.streetBet
		if pay > p.stack {
			return nil, fmt.Errorf("insufficient chips to raise TO %d", a.Amount)
		}
		raiseSize := a.Amount - r.highBet
		if raiseSize >= r.lastFullRaise {
			// full raise reopens action for everyone
			r.lastFullRaise = raiseSize
			r.responded = map[int]bool{r.toActIdx: true}
		} else {
			// incomplete all-in raise: action NOT reopened
			r.responded[r.toActIdx] = true
		}
		p.stack -= pay
		p.committed += pay
		p.streetBet = a.Amount
		if p.stack == 0 {
			p.allIn = true
		}
		evs = append(evs, Event{Type: EvActionAccepted, HandID: r.handID, Street: r.street.String(), Seat: p.seat, Player: p.name, Amount: pay, To: a.Amount, Action: &Action{Seat: p.seat, Kind: Raise, Amount: a.Amount}})
		r.highBet = a.Amount
		r.advanceTurn()

	default:
		return nil, fmt.Errorf("unknown action kind %d", a.Kind)
	}

	// hand may have ended via last fold
	if !r.done && r.toActIdx >= 0 && r.activeCount() >= 2 {
		evs = append(evs, r.turnEvent())
	}
	return evs, nil
}

// advanceTurn: move toActIdx to the next player owing action, or -1.
func (r *HandRunner) advanceTurn() {
	start := r.toActIdx
	if start < 0 {
		return
	}
	for i := r.nextIdx(start); ; i = r.nextIdx(i) {
		p := r.players[i]
		if p.inHand() && !p.allIn && (!r.responded[i] || p.streetBet < r.highBet) {
			r.toActIdx = i
			return
		}
		if i == start {
			break
		}
	}
	r.toActIdx = -1
}

// legalActions for the current actor.
func (r *HandRunner) legalActions() LegalActions {
	p := r.players[r.toActIdx]
	la := LegalActions{
		Seat:       p.seat,
		CanFold:    true,
		CallAmount: r.highBet - p.streetBet,
	}
	la.CanCheck = la.CallAmount == 0
	la.CanCall = la.CallAmount > 0
	la.MaxRaiseTo = p.streetBet + p.stack
	// raising requires either not having acted since the last full raise,
	// or a new full raise having reopened the action (responded reset)
	canRaise := !r.responded[r.toActIdx]
	if la.CallAmount >= p.stack {
		la.CanRaise = false // calling all-in or folding only
	} else {
		la.MinRaiseTo = min64(r.highBet+r.lastFullRaise, la.MaxRaiseTo)
		la.CanRaise = canRaise && la.MaxRaiseTo > r.highBet
	}
	return la
}

// LegalActionsFor exposes current options to the transport layer.
func (r *HandRunner) LegalActionsFor() *LegalActions {
	if r.done || r.toActIdx < 0 || r.pendingRevealIdx >= 0 || r.street == Drop {
		return nil
	}
	la := r.legalActions()
	return &la
}

// DropDecidePending: a stay/drop round is open — round no., seats yet to
// decide. Transport arms its own decision timeout (stay/drop isn't a
// betting turn, so LegalActionsFor is nil here).
func (r *HandRunner) DropDecidePending() (round int, waiting int, ok bool) {
	if r.done || r.street != Drop {
		return 0, 0, false
	}
	for i, p := range r.players {
		if _, decided := r.dropDecided[i]; p.inHand() && !decided {
			waiting++
		}
	}
	return r.dropRound, waiting, true
}

// UndecidedSeats: seats that still owe a stay/drop this round (timeout
// auto-drops them).
func (r *HandRunner) UndecidedSeats() []int {
	var out []int
	for i, p := range r.players {
		if _, decided := r.dropDecided[i]; p.inHand() && !decided {
			out = append(out, p.seat)
		}
	}
	return out
}

// SeatDecided: this seat has locked a stay/drop choice for the round.
func (r *HandRunner) SeatDecided(seat int) bool {
	i := r.idxOfSeat(seat)
	if i < 0 {
		return false
	}
	_, ok := r.dropDecided[i]
	return ok
}

// beginRunoutIfNeeded: when betting is over with >= 2 players contested,
// announce the runout; if RIT, clone the board so both run independently.
// Only when no further betting is possible (canActCount < 2) — otherwise
// postflop action remains and boards must stay single.
func (r *HandRunner) beginRunoutIfNeeded() Event {
	if r.runoutAnnounced || r.canActCount() >= 2 {
		return Event{}
	}
	r.runoutAnnounced = true
	if r.runItTwice {
		if r.board == nil {
			r.board = [][]Card{nil, nil} // preflop all-in: two fresh boards
		} else if len(r.board) == 1 {
			second := make([]Card, len(r.board[0]))
			copy(second, r.board[0]) // shared history, independent runout
			r.board = append(r.board, second)
		}
	}
	return Event{
		Type:       EvAllInRunout,
		HandID:     r.handID,
		Street:     r.street.String(),
		Pot:        r.potTotal(),
		BoardIndex: len(r.board) - 1, // 1 when running it twice
	}
}

// dealNextStreet: burn + deal next cards for every board in play.
// ponytail: Draw errors ignored — worst-case hand (9-way bomb pot) uses
// 36 hole + 6 burn + 10 board = 52 cards exactly, so Draw cannot fail.
func (r *HandRunner) dealNextStreet() []Event {
	var evs []Event
	r.street++
	r.responded = map[int]bool{}
	r.lastFullRaise = r.cfg.BigBlind
	if r.board == nil {
		r.board = [][]Card{nil} // single board; second added only by RIT
	}
	n := 3
	if r.street != Flop {
		n = 1
	}
	for b := range r.board {
		burn, _ := r.deck.Draw(1)
		r.dealt = append(r.dealt, burn...)
		cards, _ := r.deck.Draw(n)
		r.dealt = append(r.dealt, cards...)
		r.board[b] = append(r.board[b], cards...)
		evs = append(evs, Event{Type: EvStreetDealt, HandID: r.handID, Street: r.street.String(), BoardIndex: b, Cards: cards, Pot: r.potTotal()})
	}
	for i := range r.players {
		r.players[i].streetBet = 0
	}
	r.highBet = 0
	r.toActIdx = r.firstToActPostflop()
	if r.toActIdx >= 0 {
		evs = append(evs, r.turnEvent())
	}
	return evs
}

// firstToActPostflop: first seat left of button who can act; -1 if betting
// is impossible (fewer than 2 players with chips).
func (r *HandRunner) firstToActPostflop() int {
	if r.canActCount() < 2 {
		return -1
	}
	for i := r.nextIdx(r.btn); ; i = r.nextIdx(i) {
		if r.players[i].inHand() && !r.players[i].allIn {
			return i
		}
	}
}

// dealBombFlop: both boards' flops, no burn (bomb pot house convention).
func (r *HandRunner) dealBombFlop() []Event {
	var evs []Event
	r.street = Flop
	r.responded = map[int]bool{}
	r.lastFullRaise = r.cfg.BigBlind
	for b := 0; b < 2; b++ {
		cards, _ := r.deck.Draw(3)
		r.dealt = append(r.dealt, cards...)
		r.board[b] = cards
		evs = append(evs, Event{Type: EvStreetDealt, HandID: r.handID, Street: Flop.String(), BoardIndex: b, Cards: cards, BombPot: true, Pot: r.potTotal()})
	}
	for i := range r.players {
		r.players[i].streetBet = 0
	}
	r.highBet = 0
	r.toActIdx = r.firstToActPostflop()
	if r.toActIdx >= 0 {
		evs = append(evs, r.turnEvent())
	}
	return evs
}

func (r *HandRunner) turnEvent() Event {
	p := r.players[r.toActIdx]
	return Event{Type: EvTurnChanged, HandID: r.handID, Street: r.street.String(), Seat: p.seat, Player: p.name, ToAct: p.seat, DeadlineUnixMs: r.deadline(), Pot: r.potTotal()}
}
