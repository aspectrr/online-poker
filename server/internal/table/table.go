// Package table: in-memory live tables. One goroutine per table owns all
// state (seats, engine HandRunner, timers); clients send messages through
// the table's inbox channel. Manager creates tables from store rows and
// looks them up by id.
package table

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/aspectrr/online-poker/server/internal/engine"
	"github.com/aspectrr/online-poker/server/internal/protocol"
	"github.com/aspectrr/online-poker/server/internal/store"
	"github.com/aspectrr/online-poker/server/internal/ws"
)

const (
	maxChat        = 500
	handStartDelay = 3 * time.Second // seat fill -> hand start
)

// Persister is the subset of *store.Store tables need.
type Persister interface {
	InsertHand(ctx context.Context, tableID string, handNo int, data json.RawMessage) (*store.Hand, error)
}

// seat: one chair.
type seat struct {
	seat       int
	userID     string // "" = open
	name       string
	stack      int64
	inHand     bool
	folded     bool
	allIn      bool
	sittingOut bool
	lastAction string
	streetBet  int64
	conn       *ws.Client // current connection, nil between reconnects
	// lastHoles: private cards for reconnect snapshot while hand running
	lastHoles []engine.Card
}

// inbox message (from clients / timers).
type inbox struct {
	client *ws.Client
	msg    protocol.ClientMsg
}

// Table: single-table actor. All fields owned by the run goroutine after
// New returns.
type Table struct {
	row     store.GameTable
	cfg     engine.TableConfig
	seats   []*seat
	button  int
	clients map[*ws.Client]struct{}

	handNo   int64
	runner   *engine.HandRunner
	timer    *time.Timer // action timeout
	nextHand *time.Timer // inter-hand delay
	pending  *protocol.PostHandPrompt
	// handEvents: current hand's public events for persistence + late snapshot
	handEvents  []protocol.Event
	lastWinner  int
	timeoutSeat int

	inbox   chan inbox
	persist Persister
	ctx     context.Context
	stop    context.CancelFunc
	once    sync.Once
}

// engineConfig maps a store row to the engine config.
func engineConfig(row store.GameTable) engine.TableConfig {
	sb, bb := int64(100), int64(200)
	if len(row.Config.BlindsSBBB) == 2 {
		sb, bb = row.Config.BlindsSBBB[0], row.Config.BlindsSBBB[1]
	}
	cfg := engine.TableConfig{
		Game:               engine.NLHE,
		SmallBlind:         sb,
		BigBlind:           bb,
		StartingStackBB:    int64(row.Config.StartingStackBB),
		ActionTimeoutSecs:  row.Config.ActionTimeoutS,
		InterHandDelaySecs: row.Config.InterHandDelayS,
		RunItTwice:         row.Config.RIT,
		RabbitHunt:         row.Config.RabbitHunt,
		BombPotEveryNHands: 0,
	}
	if row.GameType == "PLO4" {
		cfg.Game = engine.PLO4
	}
	return cfg
}

// New builds a Table from a store row and starts its goroutine.
func New(row store.GameTable, persist Persister) *Table {
	cfg := engineConfig(row)
	ctx, cancel := context.WithCancel(context.Background())
	t := &Table{
		row:     row,
		cfg:     cfg,
		seats:   make([]*seat, row.Config.MaxSeats),
		clients: map[*ws.Client]struct{}{},
		inbox:   make(chan inbox, 64),
		persist: persist,
		ctx:     ctx,
		stop:    cancel,
	}
	for i := range t.seats {
		t.seats[i] = &seat{seat: i}
	}
	go t.run()
	return t
}

// Send delivers a client message (non-blocking; dropped conn loses it).
func (t *Table) Send(c *ws.Client, m protocol.ClientMsg) {
	select {
	case t.inbox <- inbox{client: c, msg: m}:
	default:
	}
}

// Close stops the table goroutine.
func (t *Table) Close() { t.once.Do(t.stop) }

// Attach registers a connected client as an observer (receives events;
// takes a seat via join message).
func (t *Table) Attach(c *ws.Client) {
	select {
	case t.inbox <- inbox{client: c, msg: protocol.ClientMsg{Type: "__attach"}}:
	default:
	}
}

// Detach removes a dead client (called from ws onClose).
func (t *Table) Detach(c *ws.Client) {
	select {
	case t.inbox <- inbox{client: c, msg: protocol.ClientMsg{Type: "__detach"}}:
	default:
	}
}

// run: actor loop. Single goroutine owns all mutable state.
func (t *Table) run() {
	for {
		select {
		case <-t.ctx.Done():
			if t.timer != nil {
				t.timer.Stop()
			}
			if t.nextHand != nil {
				t.nextHand.Stop()
			}
			return
		case in := <-t.inbox:
			t.handle(in)
		case <-t.timerC():
			t.onTimeout()
		case <-t.nextHandC():
			t.nextHand = nil
			t.startHand()
		}
	}
}

func (t *Table) timerC() <-chan time.Time {
	if t.timer == nil {
		return nil
	}
	return t.timer.C
}

func (t *Table) nextHandC() <-chan time.Time {
	if t.nextHand == nil {
		return nil
	}
	return t.nextHand.C
}

// ---- message dispatch ----

func (t *Table) handle(in inbox) {
	switch in.msg.Type {
	case "__attach":
		t.clients[in.client] = struct{}{}
		return
	case "__detach":
		delete(t.clients, in.client)
		return
	case "__start_hand":
		t.startHand()
		return
	case "__timeout":
		t.timeoutSeat = in.msg.Seat
		t.onTimeout()
		return
	case "__timeout_post":
		t.timeoutSeat = in.msg.Seat
		t.onPostTimeout()
		return
	}
	if _, ok := t.clients[in.client]; !ok {
		return
	}
	switch in.msg.Type {
	case "join":
		t.join(in.client, in.msg)
	case "leave":
		t.leave(in.client)
	case "action":
		t.action(in.client, in.msg)
	case "chat":
		t.chat(in.client, in.msg)
	case "rabbit":
		rabbitReveal(t, in)
	default:
		in.client.TrySend(protocol.ServerMsg{Type: "error", Error: "unknown message type"})
	}
}

// join: take a seat (or observe when seat taken / hand mid-flight seat invalid).
func (t *Table) join(c *ws.Client, m protocol.ClientMsg) {
	uid := c.UserID()
	// Reconnect: existing seat owned by this user adopts the new conn.
	for _, s := range t.seats {
		if s.userID == uid {
			s.conn = c
			c.TrySend(protocol.ServerMsg{Type: "state", State: t.snapshotFor(s.seat)})
			return
		}
	}
	if m.Seat < 0 || m.Seat >= len(t.seats) {
		c.TrySend(protocol.ServerMsg{Type: "error", Error: "seat out of range"})
		return
	}
	s := t.seats[m.Seat]
	if s.userID != "" {
		c.TrySend(protocol.ServerMsg{Type: "error", Error: "seat taken"})
		return
	}
	s.userID = uid
	s.conn = c
	s.name = fmt.Sprintf("player-%s", uid[:min(6, len(uid))])
	s.stack = t.cfg.StartingStackBB * t.cfg.BigBlind
	s.sittingOut = false
	s.lastAction = ""
	t.broadcastSeats()
	c.TrySend(protocol.ServerMsg{Type: "state", State: t.snapshotFor(m.Seat)})
	t.maybeScheduleHand()
}
