package table

import (
	"encoding/json"
	"log"
	"time"

	"github.com/aspectrr/online-poker/server/internal/engine"
	"github.com/aspectrr/online-poker/server/internal/protocol"
	"github.com/aspectrr/online-poker/server/internal/ws"
)

// ---- hand lifecycle ----

// seatedCount: occupied seats not sitting out.
func (t *Table) seatedCount() int {
	n := 0
	for _, s := range t.seats {
		if s.userID != "" && !s.sittingOut {
			n++
		}
	}
	return n
}

// maybeScheduleHand: start a hand shortly after enough players sit.
func (t *Table) maybeScheduleHand() {
	if t.runner != nil || t.nextHand != nil {
		return
	}
	if t.seatedCount() < 2 {
		return
	}
	t.nextHand = time.AfterFunc(handStartDelay, func() {
		// fire into the actor loop; timer callback must not touch state
		t.Send(nil, protocol.ClientMsg{Type: "__start_hand"})
	})
}

// seatOfClient: the seat owned by this connection's user, if any.
func (t *Table) seatOfClient(c *ws.Client) *seat {
	for _, s := range t.seats {
		if s.conn == c {
			return s
		}
	}
	return nil
}

// startHand: build engine seats from table seats, run the runner.
func (t *Table) startHand() {
	t.nextHand = nil
	if t.seatedCount() < 2 {
		return
	}
	// Bomb pot trigger match from previous hand's dealt cards. (The previous
	// runner is nil'd in handEnded, so keep its dealt cards on the table.)
	bombPot := false
	if len(t.lastDealt) > 0 && len(t.cfg.BombPotCardTriggers) > 0 {
		bombPot = engine.AnyTriggerMatch(t.cfg.BombPotCardTriggers, t.lastDealt)
		t.lastDealt = nil // trigger consumed: applies to the next hand only
	}
	if t.forceBombPot {
		bombPot = true
		t.forceBombPot = false
	}
	cfg := t.cfg
	cfg.BombPot = bombPot
	t.bombPot = bombPot
	cfg.ButtonSeat = t.button
	cfg.HandID = t.handNo + 1

	var engineSeats []engine.SeatState
	for _, s := range t.seats {
		if s.userID == "" || s.sittingOut || s.stack <= 0 {
			continue
		}
		engineSeats = append(engineSeats, engine.SeatState{
			Seat: s.seat, Player: s.name, Stack: s.stack,
		})
	}
	if len(engineSeats) < 2 {
		return
	}
	var r *engine.HandRunner
	var err error
	holeRounds := cfg.Game.HoleCardCount()
	if bombPot {
		holeRounds = 4
	}
	if len(t.devDeals) > 0 {
		if deck, ok := t.loadedDeck(engineSeats, holeRounds); ok {
			r, err = engine.StartHandWithDeck(cfg, engineSeats, deck)
		} else {
			r, err = engine.StartHand(cfg, engineSeats)
		}
	} else {
		r, err = engine.StartHand(cfg, engineSeats)
	}
	if err != nil {
		log.Printf("table %s: start hand: %v", t.row.ID, err)
		return
	}
	if bombPot {
		log.Printf("table %s hand %d: BOMB POT (trigger matched)", t.row.ID, cfg.HandID)
	}
	t.runner = r
	t.handNo = cfg.HandID
	t.pending = nil
	for _, s := range t.seats {
		s.inHand = s.userID != "" && s.stack > 0 && !s.sittingOut
		s.folded = false
		s.allIn = false
		s.lastAction = ""
		s.streetBet = 0
		s.isWinner = false
		s.lastHoles = r.HolesFor(s.seat)
	}
	evs, err := r.Advance(nil) // drain setup: hand_started, blinds
	if err != nil {
		log.Printf("table %s: advance setup: %v", t.row.ID, err)
	}
	t.publishEvents(evs)
	t.afterAdvance()
}

// advance applies an action (or nil tick) and publishes resulting events.
func (t *Table) advance(a *engine.Action, actor *seat) *engine.Action {
	evs, err := t.runner.Advance(a)
	if err != nil {
		// Illegal action: reject to actor, keep state.
		if actor != nil && actor.conn != nil {
			actor.conn.TrySend(protocol.ServerMsg{Type: "error", Error: "illegal action: " + err.Error()})
		}
		return nil
	}
	t.publishEvents(evs)
	t.afterAdvance()
	return nil
}

// afterAdvance: hand-over bookkeeping — persist, prompt post-hand
// decisions, arm timers, schedule the next hand.
func (t *Table) afterAdvance() {
	if t.runner == nil {
		return
	}
	r := t.runner

	// (stacks are synced in publishEvents, before the batch's seats frame)

	if r.Done() {
		t.persistHand()
		t.timerStop()
		if t.postHandOffered() {
			return // waiting on winner's decision; hand_end fires after
		}
		t.handEnded()
		return
	}

	if la := r.LegalActionsFor(); la != nil {
		s := t.seatByNo(la.Seat)
		if s != nil && s.conn != nil {
			s.conn.TrySend(protocol.ServerMsg{Type: "action_required", Legal: la})
		}
		t.armTimeout(la)
	}
}

// postHandOffered: engine paused between pot_awarded and hand_ended for
// reveal/muck or rabbit. Sends prompt; returns true when waiting.
func (t *Table) postHandOffered() bool {
	r := t.runner
	reveal, rabbit := r.PendingPostHand()
	if !reveal && !rabbit {
		return false
	}
	// Who is it waiting on? The last pot winner still seated.
	seatNo := t.lastWinnerSeat()
	s := t.seatByNo(seatNo)
	if s == nil {
		return false
	}
	prompt := &protocol.PostHandPrompt{Seat: seatNo}
	prompt.Bounty = reveal
	prompt.Rabbit = rabbit
	t.pending = prompt
	if s.conn != nil {
		s.conn.TrySend(protocol.ServerMsg{Type: "post_hand", Post: prompt})
	}
	t.armPostHandTimeout()
	return true
}

// lastWinnerSeat: seat of the most recent pot_awarded winner this hand.
func (t *Table) lastWinnerSeat() int {
	return t.lastWinner
}

// firstTriggerMatch: first dealt card matching any trigger.
func firstTriggerMatch(triggers []engine.CardTrigger, cards []engine.Card) (engine.Card, bool) {
	for _, c := range cards {
		for _, tr := range triggers {
			if tr.Matches(c) {
				return c, true
			}
		}
	}
	return 0, false
}

// handEnded: cleanup + schedule next hand after inter-hand delay.
func (t *Table) handEnded() {
	// advance button to next occupied seat
	t.button = t.nextButton()
	if t.runner != nil {
		t.lastDealt = t.runner.DealtCards() // for the next hand's bomb-pot triggers
	}
	t.runner = nil
	t.pending = nil
	t.bombPot = false
	// banner for trigger-armed bomb pots: everyone sees it during the
	// inter-hand delay; startHand re-matches and consumes lastDealt itself.
	if !t.forceBombPot && len(t.lastDealt) > 0 && len(t.cfg.BombPotCardTriggers) > 0 {
		if c, ok := firstTriggerMatch(t.cfg.BombPotCardTriggers, t.lastDealt); ok {
			t.broadcastEvent(protocol.Event{Type: protocol.EvBombPotArmed, Cards: []engine.Card{c}})
		}
	}
	delay := time.Duration(t.cfg.InterHandDelaySecs) * time.Second
	if t.seatedCount() >= 2 {
		t.nextHand = time.AfterFunc(delay, func() {
			t.Send(nil, protocol.ClientMsg{Type: "__start_hand"})
		})
	}
}

func (t *Table) nextButton() int {
	for i := 1; i <= len(t.seats); i++ {
		cand := (t.button + i) % len(t.seats)
		s := t.seats[cand]
		if s.userID != "" && !s.sittingOut && s.stack > 0 {
			return cand
		}
	}
	return t.button
}

// syncSeats: pull stacks/allIn from engine into seat view.
func (t *Table) syncSeats() {
	for _, fs := range t.runner.Stacks() {
		if s := t.seatByNo(fs.Seat); s != nil {
			s.stack = fs.Stack
			// engine doesn't export an all-in flag; zero stack mid-hand is it
			s.allIn = s.inHand && !s.folded && fs.Stack == 0
		}
	}
}

// persistHand: write hand history jsonb.
func (t *Table) persistHand() {
	if t.persist == nil || t.runner == nil {
		return
	}
	hist := map[string]any{
		"hand_no": t.handNo,
		"events":  t.handEvents,
		"stacks":  t.runner.Stacks(),
	}
	data, err := json.Marshal(hist)
	if err == nil {
		if _, err := t.persist.InsertHand(t.ctx, t.row.ID, int(t.handNo), data); err != nil {
			log.Printf("table %s: persist hand: %v", t.row.ID, err)
		}
	}
}

// ---- events / redaction ----

// publishEvents: broadcast each event; private hole deliveries per seat.
// Also folds public event fields into the seat view (street bets, folds,
// winner flags) so snapshots + seats broadcasts carry them, then sends one
// seats frame per batch.
func (t *Table) publishEvents(evs []protocol.Event) {
	t.syncSeats() // stacks/allIn current before any seats frame goes out
	t.handEvents = append(t.handEvents, evs...)
	for i := range evs {
		ev := evs[i]
		t.applyEventToSeats(&ev)
		if ev.Type == protocol.EvPotAwarded && len(ev.Winners) > 0 {
			t.lastWinner = ev.Winners[0].Seat
		}
		if ev.Type == protocol.EvHandStarted && t.runner != nil {
			// hand_started goes to everyone; private holes only to their seat
			for c := range t.clients {
				out := ev
				c.TrySend(protocol.ServerMsg{Type: "event", Event: &out})
			}
			for _, s := range t.seats {
				if !s.inHand || s.conn == nil {
					continue
				}
				private := ev
				private.Type = protocol.EvHolesDealt
				private.Seat = s.seat
				private.Player = s.name
				private.Cards = t.runner.HolesFor(s.seat)
				s.conn.TrySend(protocol.ServerMsg{Type: "event", Event: &private})
			}
			continue
		}
		for c := range t.clients {
			out := ev
			c.TrySend(protocol.ServerMsg{Type: "event", Event: &out})
		}
	}
	t.broadcastSeats()
}

// applyEventToSeats: mirror event facts into the per-seat view so clients
// see street bets / folds / winners without re-deriving from events.
func (t *Table) applyEventToSeats(ev *protocol.Event) {
	if ev.Type == protocol.EvPotAwarded {
		log.Printf("table %s hand %d: pot_awarded seat=%d amount=%d",
			t.row.ID, t.handNo, ev.Winners[0].Seat, ev.Winners[0].Amount)
	}
	if ev.Type == protocol.EvHandEnded {
		var sum int64
		for _, fs := range ev.Stacks {
			sum += fs.Stack
		}
		log.Printf("table %s hand %d: hand_ended stacks=%v sum=%d", t.row.ID, t.handNo, ev.Stacks, sum)
	}
	seatBy := func(n int) *seat {
		if s := t.seatByNo(n); s != nil {
			return s
		}
		return &seat{} // no-op sink
	}
	switch ev.Type {
	case protocol.EvBlindsPosted:
		s := seatBy(ev.Seat)
		s.streetBet += ev.Amount
		s.lastAction = "sb"
		if ev.Amount != t.cfg.SmallBlind {
			s.lastAction = "bb"
		}
	case protocol.EvAntesPosted:
		s := seatBy(ev.Seat)
		s.streetBet += ev.Amount
		s.lastAction = "ante"
	case protocol.EvActionAccepted:
		s := seatBy(ev.Seat)
		if ev.Action != nil {
			s.lastAction = ev.Action.Kind.String()
			if ev.Action.Kind == engine.Fold {
				s.folded = true
			}
		}
		if ev.To > 0 {
			s.streetBet = ev.To // raise-TO total
		} else if ev.Amount > 0 {
			s.streetBet += ev.Amount // call pay
		}
	case protocol.EvStreetDealt:
		for _, s := range t.seats {
			s.streetBet = 0
		}
	case protocol.EvPotAwarded:
		for _, w := range ev.Winners {
			seatBy(w.Seat).isWinner = true
		}
	}
}

// ---- timeouts ----

func (t *Table) armTimeout(la *engine.LegalActions) {
	t.timerStop()
	if t.cfg.ActionTimeoutSecs <= 0 {
		return
	}
	t.deadline = time.Now().Add(time.Duration(t.cfg.ActionTimeoutSecs) * time.Second).UnixMilli()
	seatNo := la.Seat
	t.timer = time.AfterFunc(time.Duration(t.cfg.ActionTimeoutSecs)*time.Second, func() {
		t.Send(nil, protocol.ClientMsg{Type: "__timeout", Seat: seatNo})
	})
}

// onTimeout: auto check (when free) else fold for the seat.
func (t *Table) onTimeout() {
	t.timer = nil
	if t.runner == nil {
		return
	}
	la := t.runner.LegalActionsFor()
	if la == nil || la.Seat != t.timeoutSeat {
		return
	}
	kind := engine.Fold
	if la.CanCheck && !la.CanCall {
		kind = engine.Check
	}
	if la.CanCall && la.CallAmount == 0 {
		kind = engine.Check
	}
	t.advance(&engine.Action{Seat: la.Seat, Kind: kind}, nil)
}

// armPostHandTimeout: winner has one action-timeout to decide, else muck/skip.
func (t *Table) armPostHandTimeout() {
	t.timerStop()
	if t.cfg.ActionTimeoutSecs <= 0 {
		return
	}
	seatNo := t.pending.Seat
	t.timer = time.AfterFunc(time.Duration(t.cfg.ActionTimeoutSecs)*time.Second, func() {
		t.Send(nil, protocol.ClientMsg{Type: "__timeout_post", Seat: seatNo})
	})
}

func (t *Table) timerStop() {
	if t.timer != nil {
		t.timer.Stop()
		t.timer = nil
	}
	t.deadline = 0
}

// ---- chat ----

func (t *Table) chat(c *ws.Client, m protocol.ClientMsg) {
	text := []rune(m.Text)
	if len(text) == 0 || len(text) > maxChat {
		return
	}
	s := t.seatOfClient(c)
	cm := protocol.ChatMsg{Text: string(text)}
	if s != nil {
		cm.Seat = s.seat
		cm.Player = s.name
	}
	for cl := range t.clients {
		cl.TrySend(protocol.ServerMsg{Type: "chat", Chat: &cm})
	}
}

// rabbit / post-hand decisions (called from dispatch).
func rabbitReveal(t *Table, in inbox) {
	s := t.seatOfClient(in.client)
	if s == nil || t.runner == nil || t.pending == nil || t.pending.Seat != s.seat {
		return
	}
	if in.msg.Reveal != nil {
		// reveal/muck decision for 7-2 bounty
		if *in.msg.Reveal {
			t.advance(&engine.Action{Seat: s.seat, Kind: engine.Reveal}, s)
		} else {
			t.advance(&engine.Action{Seat: s.seat, Kind: engine.Muck}, s)
		}
	} else {
		t.advance(&engine.Action{Seat: s.seat, Kind: engine.RabbitHunt}, s)
	}
}

// onPostTimeout: winner didn't decide in time — muck (no bounty), skip rabbit.
func (t *Table) onPostTimeout() {
	t.timer = nil
	if t.runner == nil || t.pending == nil {
		return
	}
	t.advance(&engine.Action{Seat: t.pending.Seat, Kind: engine.Muck}, nil)
}
