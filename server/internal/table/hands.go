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
	// Bomb pot trigger match from previous hand's dealt cards.
	bombPot := false
	if t.runner != nil && len(t.cfg.BombPotCardTriggers) > 0 {
		bombPot = engine.AnyTriggerMatch(t.cfg.BombPotCardTriggers, t.runner.DealtCards())
	}
	cfg := t.cfg
	cfg.BombPot = bombPot
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
	r, err := engine.StartHand(cfg, engineSeats)
	if err != nil {
		log.Printf("table %s: start hand: %v", t.row.ID, err)
		return
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

	// Sync stacks + street bets from engine after every advance.
	t.syncSeats()

	if r.Done() {
		t.persistHand()
		t.timerStop()
		// post-hand prompt (reveal/muck for 7-2, then rabbit) if offered
		if la := r.LegalActionsFor(); la == nil && !r.Done() {
			// unreachable; Done checked above
		}
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
	if r.LegalActionsFor() != nil || r.Done() {
		return false
	}
	// Who is it waiting on? The last pot winner still seated.
	seatNo := t.lastWinnerSeat()
	s := t.seatByNo(seatNo)
	if s == nil {
		return false
	}
	prompt := &protocol.PostHandPrompt{Seat: seatNo}
	// ponytail: distinguishing bounty-vs-rabbit from outside the engine is
	// approximated: bounty offered when 7-2 enabled, rabbit when cfg allows.
	if t.cfg.SevenDeuce.Enabled {
		prompt.Bounty = true
	}
	if t.cfg.RabbitHunt {
		prompt.Rabbit = true
	}
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

// handEnded: cleanup + schedule next hand after inter-hand delay.
func (t *Table) handEnded() {
	// advance button to next occupied seat
	t.button = t.nextButton()
	t.runner = nil
	t.pending = nil
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

// syncSeats: pull stacks/streetBets/allIn from engine into seat view.
func (t *Table) syncSeats() {
	for _, fs := range t.runner.Stacks() {
		if s := t.seatByNo(fs.Seat); s != nil {
			s.stack = fs.Stack
		}
	}
	// streetBet: engine doesn't export per-street bets; derive from
	// last ActionAccepted events in publishEvents instead.
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
func (t *Table) publishEvents(evs []protocol.Event) {
	t.handEvents = append(t.handEvents, evs...)
	for i := range evs {
		ev := evs[i]
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
}

// ---- timeouts ----

func (t *Table) armTimeout(la *engine.LegalActions) {
	t.timerStop()
	if t.cfg.ActionTimeoutSecs <= 0 {
		return
	}
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
	if t.runner != nil && t.runner.Done() {
		t.afterAdvance()
	}
}

// onPostTimeout: winner didn't decide in time — muck (no bounty), skip rabbit.
func (t *Table) onPostTimeout() {
	t.timer = nil
	if t.runner == nil || t.pending == nil {
		return
	}
	t.advance(&engine.Action{Seat: t.pending.Seat, Kind: engine.Muck}, nil)
	if t.runner != nil && t.runner.Done() {
		t.afterAdvance()
	}
}
