package table

import (
	"strings"

	"github.com/aspectrr/online-poker/server/internal/engine"
	"github.com/aspectrr/online-poker/server/internal/protocol"
	"github.com/aspectrr/online-poker/server/internal/store"
	"github.com/aspectrr/online-poker/server/internal/ws"
)

// ---- client commands ----

// leave: stand up (between hands) or sit out (mid-hand keeps chips in play).
func (t *Table) leave(c *ws.Client) {
	s := t.seatOfClient(c)
	if s == nil {
		return
	}
	if t.runner != nil && s.inHand && !s.folded {
		// mid-hand: fold them out but keep the seat occupied until hand end
		if la := t.runner.LegalActionsFor(); la != nil && la.Seat == s.seat {
			t.advance(&engine.Action{Seat: s.seat, Kind: engine.Fold}, nil)
			return
		}
		s.sittingOut = true // picked up next hand
		t.broadcastSeats()
		return
	}
	s.userID = ""
	s.name = ""
	s.conn = nil
	s.stack = 0
	s.pendingTopUp = 0
	s.rebuys = 0
	s.inHand = false
	s.sittingOut = false
	s.lastAction = ""
	t.broadcastSeats()
}

// action: betting / stay-drop action from the seat owning this connection.
func (t *Table) action(c *ws.Client, m protocol.ClientMsg) {
	s := t.seatOfClient(c)
	if s == nil || t.runner == nil || t.pending != nil {
		return
	}
	var kind engine.ActionKind
	switch strings.ToLower(m.Kind) {
	case "fold":
		kind = engine.Fold
	case "check":
		kind = engine.Check
	case "call":
		kind = engine.Call
	case "bet", "raise":
		kind = engine.Raise
	case "stay":
		kind = engine.Stay
	case "drop":
		kind = engine.DropOut
	default:
		s.conn.TrySend(protocol.ServerMsg{Type: "error", Error: "unknown action kind"})
		return
	}
	if kind == engine.Stay || kind == engine.DropOut {
		// stay/drop isn't a betting turn — LegalActionsFor is nil during the
		// decision phase; the engine validates eligibility and double choices
		t.advance(&engine.Action{Seat: s.seat, Kind: kind}, s)
		return
	}
	la := t.runner.LegalActionsFor()
	if la == nil || la.Seat != s.seat {
		if s.conn != nil {
			s.conn.TrySend(protocol.ServerMsg{Type: "error", Error: "not your turn"})
		}
		return
	}
	t.advance(&engine.Action{Seat: s.seat, Kind: kind, Amount: m.Amount}, s)
}

// ---- snapshots / seat view ----

func (t *Table) seatByNo(n int) *seat {
	for _, s := range t.seats {
		if s.seat == n {
			return s
		}
	}
	return nil
}

// broadcastSeats: public seat occupancy/stack update to everyone.
func (t *Table) broadcastSeats() {
	var occ int64
	for _, s := range t.seats {
		if s.userID != "" {
			occ++
		}
	}
	t.occupied.Store(occ)
	seats := t.seatsWire()
	for c := range t.clients {
		c.TrySend(protocol.ServerMsg{Type: "seats", Seats: seats})
	}
}

func (t *Table) seatsWire() []protocol.SeatWire {
	out := make([]protocol.SeatWire, len(t.seats))
	for i, s := range t.seats {
		out[i] = protocol.SeatWire{
			Seat:       s.seat,
			Player:     s.name,
			UserID:     s.userID,
			Stack:      s.stack,
			InHand:     s.inHand,
			Folded:     s.folded,
			AllIn:      s.allIn,
			SittingOut: s.sittingOut,
			IsButton:   s.seat == t.button,
			IsWinner:   s.isWinner,
			LastAction: s.lastAction,
			StreetBet:  s.streetBet,
		}
	}
	return out
}

// snapshotFor: full TableState for a given viewer seat (-1 = observer).
// hole-card redaction: YourCards only for the viewer's own seat.
func (t *Table) snapshotFor(viewer int) *protocol.TableState {
	st := &protocol.TableState{
		TableID:  t.row.ID,
		Name:     t.row.Name,
		GameType: t.row.GameType,
		Config: protocol.ConfigWire{
			GameType:         t.row.GameType,
			SmallBlind:       t.cfg.SmallBlind,
			BigBlind:         t.cfg.BigBlind,
			MaxSeats:         len(t.seats),
			ActionTimeoutS:   t.cfg.ActionTimeoutSecs,
			InterHandDelayS:  t.row.Config.InterHandDelayS,
			RIT:              t.row.Config.RIT,
			RabbitHunt:       t.row.Config.RabbitHunt,
			SevenDeuce:       t.row.Config.SevenDeuce,
			SevenDeuceBounty: t.row.Config.SevenDeuceBounty,
			BombPotMode:      t.row.Config.BombPotMode,
			BombPotTriggers:  triggersWire(t.row.Config.BombPotTriggers),
			TexasDropAnte:    t.cfg.TexasDropAnte,
		},
		Seats:         t.seatsWire(),
		YourSeat:      viewer,
		HandNo:        t.handNo,
		BombPotNext:   t.forceBombPot,
		BombPot:       t.bombPot && t.runner != nil,
		TexasDropNext: t.forceTexasDrop,
		TexasDrop:     t.texasDrop && t.runner != nil,
	}
	if t.runner != nil {
		st.HandInProgress = true
		st.Street = t.runnerStreet()
		st.Board = t.runner.Board()
		st.Pot = t.runner.Pot()
		if la := t.runner.LegalActionsFor(); la != nil {
			seat := la.Seat
			st.ToActSeat = &seat
			st.DeadlineUnixMs = t.deadlineMs()
			if la.Seat == viewer {
				st.LegalActions = la
			}
		}
		if round, waiting, ok := t.runner.DropDecidePending(); ok {
			st.DropRound = round
			st.DropWaiting = waiting
			if viewer >= 0 {
				st.DropDecided = t.runner.SeatDecided(viewer)
			}
			st.DeadlineUnixMs = t.deadlineMs() // drop decision clock
		}
		if viewer >= 0 {
			if s := t.seatByNo(viewer); s != nil {
				st.YourCards = s.lastHoles // private: viewer's own seat only
				st.YourHand = t.runner.MadeHandName(viewer)
				st.RebuysUsed = s.rebuys
				st.TopUpQueued = s.pendingTopUp > 0
			}
		}
	}
	return st
}

// triggersWire: store jsonb triggers -> display wire form.
func triggersWire(in []store.BombPotTrigger) []protocol.TriggerWire {
	if len(in) == 0 {
		return nil
	}
	out := make([]protocol.TriggerWire, 0, len(in))
	for _, tr := range in {
		w := protocol.TriggerWire{Rank: tr.Rank, Suit: tr.Suit}
		if tr.Color != nil {
			w.Color = *tr.Color
		}
		out = append(out, w)
	}
	return out
}

// runnerStreet: current street name, "" before first action.
func (t *Table) runnerStreet() string {
	if t.runner == nil {
		return ""
	}
	// last street_dealt event tells us; preflop until one appears
	for i := len(t.handEvents) - 1; i >= 0; i-- {
		if ev := t.handEvents[i]; ev.Type == protocol.EvStreetDealt {
			return ev.Street
		}
	}
	return "preflop"
}

// deadlineMs: when the current actor must act (armed when the timeout timer
// starts; 0 mid-street or when no timeout is configured).
func (t *Table) deadlineMs() int64 {
	return t.deadline
}

// sanitizeName: client-provided display name, or a uid-derived fallback.
func sanitizeName(name, uid string) string {
	name = strings.Map(func(r rune) rune {
		if r >= 32 && r != 127 {
			return r
		}
		return -1
	}, strings.TrimSpace(name))
	if name == "" {
		return "player-" + uid[:min(6, len(uid))]
	}
	if len([]rune(name)) > 24 {
		name = string([]rune(name)[:24])
	}
	return name
}
