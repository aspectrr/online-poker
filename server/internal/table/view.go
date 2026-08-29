package table

import (
	"strings"

	"github.com/aspectrr/online-poker/server/internal/engine"
	"github.com/aspectrr/online-poker/server/internal/protocol"
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
	s.inHand = false
	s.sittingOut = false
	s.lastAction = ""
	t.broadcastSeats()
}

// action: betting action from the seat owning this connection.
func (t *Table) action(c *ws.Client, m protocol.ClientMsg) {
	s := t.seatOfClient(c)
	if s == nil || t.runner == nil || t.pending != nil {
		return
	}
	la := t.runner.LegalActionsFor()
	if la == nil || la.Seat != s.seat {
		if s.conn != nil {
			s.conn.TrySend(protocol.ServerMsg{Type: "error", Error: "not your turn"})
		}
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
	default:
		s.conn.TrySend(protocol.ServerMsg{Type: "error", Error: "unknown action kind"})
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
			GameType:       t.row.GameType,
			SmallBlind:     t.cfg.SmallBlind,
			BigBlind:       t.cfg.BigBlind,
			MaxSeats:       len(t.seats),
			ActionTimeoutS: t.cfg.ActionTimeoutSecs,
		},
		Seats:    t.seatsWire(),
		YourSeat: viewer,
		HandNo:   t.handNo,
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
		if viewer >= 0 {
			if s := t.seatByNo(viewer); s != nil {
				st.YourCards = s.lastHoles // private: viewer's own seat only
			}
		}
	}
	return st
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
