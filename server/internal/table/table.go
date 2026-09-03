// Package table: in-memory live tables. One goroutine per table owns all
// state (seats, engine HandRunner, timers); clients send messages through
// the table's inbox channel. Manager creates tables from store rows and
// looks them up by id.
package table

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
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
	// LastHand: newest persisted hand for the table (store.ErrNotFound when
	// none) — used to restore player stacks after a server restart.
	LastHand(ctx context.Context, tableID string) (json.RawMessage, error)
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
	isWinner   bool
	conn       *ws.Client // current connection, nil between reconnects
	// lastHoles: private cards for reconnect snapshot while hand running
	lastHoles []engine.Card
	// rebuy bookkeeping: top-ups queue here and credit at the next hand
	pendingTopUp int64
	rebuys       int
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
	deadline int64       // unix ms of the armed timeout, 0 = none
	nextHand *time.Timer // inter-hand delay
	pending  *protocol.PostHandPrompt
	// lastDealt: previous hand's cards, for the next hand's bomb-pot triggers
	lastDealt []engine.Card
	// forceBombPot: next hand is a bomb pot (manual arm, bomb_pot msg)
	forceBombPot bool
	// bombPot: the CURRENT hand is a bomb pot (for reconnect snapshots)
	bombPot bool
	// forceTexasDrop: next hand is a Texas Drop game (manual arm, texas_drop msg)
	forceTexasDrop bool
	// texasDrop: the CURRENT hand is a Texas Drop game (snapshots)
	texasDrop bool
	// dropTimer: stay/drop decision timeout for the round in dropTimerRound
	dropTimer      *time.Timer
	dropTimerRound int
	// graceHandNo: hand that already used its first-turn +5s deal grace
	graceHandNo int64
	// paceEvs: street-deal events held back ~1s after a street-closing
	// action, so the next board cards don't stomp the final action's render
	paceEvs []protocol.Event
	// revealPending: showdown seats still deciding show-or-muck; hands stay
	// private until each seat chooses (auto-muck on timeout)
	revealPending []int
	revealTimer   *time.Timer
	// devDeals: forced hole cards per seat, consumed by the next startHand
	// (dev builds only)
	devDeals map[int][]engine.Card
	// handEvents: current hand's public events for persistence + late snapshot
	handEvents  []protocol.Event
	lastWinner  int
	timeoutSeat int
	dev         bool
	// handStart: seats dealt into the current hand w/ starting stacks
	// (persistence only; captured in startHand)
	handStart []engine.FinalStack
	// persistedNo: last hand_no written (post-hand prompt flow calls
	// persistHand twice per hand otherwise)
	persistedNo int64
	// restore: userID → last recorded stack from the newest persisted hand,
	// loaded once on first join after a restart (real-money durability)
	restore       map[string]int64
	restoreLoaded bool

	inbox   chan inbox
	persist Persister
	ctx     context.Context
	stop    context.CancelFunc
	once    sync.Once

	// cross-goroutine reads for the REST lobby/reaper; the actor goroutine
	// writes them, atomics keep the reads race-free
	occupied   atomic.Int64 // seats taken
	busy       atomic.Int64 // 1 while a hand is in progress
	emptySince atomic.Int64 // unix sec since the last client detached; 0 = has clients
}

// engineConfig maps a store row to the engine config.
func engineConfig(row store.GameTable) engine.TableConfig {
	sb, bb := int64(100), int64(200)
	if len(row.Config.BlindsSBBB) == 2 {
		sb, bb = row.Config.BlindsSBBB[0], row.Config.BlindsSBBB[1]
	}
	cfg := engine.TableConfig{
		Game:                engine.NLHE,
		SmallBlind:          sb,
		BigBlind:            bb,
		StartingStackBB:     int64(row.Config.StartingStackBB),
		ActionTimeoutSecs:   row.Config.ActionTimeoutS,
		InterHandDelaySecs:  row.Config.InterHandDelayS,
		RunItTwice:          row.Config.RIT,
		RabbitHunt:          row.Config.RabbitHunt,
		BombPotEveryNHands:  0,
		BombPotCardTriggers: triggersToEngine(row.Config.BombPotTriggers),
	}
	// Texas Drop ante: stored value, else the house default 2.5×BB
	// (50¢ at 10/20 — the game this table hosts it for).
	cfg.TexasDropAnte = row.Config.TexasDropAnte
	if cfg.TexasDropAnte == 0 {
		cfg.TexasDropAnte = bb * 5 / 2
	}
	// 7-2 is NLHE-only in the engine; don't arm it on PLO4 tables.
	if row.GameType == "NLHE" {
		cfg.SevenDeuce = engine.SevenDeuceConfig{Enabled: row.Config.SevenDeuce, Amount: row.Config.SevenDeuceBounty}
	}
	if row.GameType == "PLO4" {
		cfg.Game = engine.PLO4
	}
	return cfg
}

// triggersToEngine converts store jsonb triggers (rank 2-14) to engine
// CardTriggers (rank 0-12); nil for "any" fields.
func triggersToEngine(in []store.BombPotTrigger) []engine.CardTrigger {
	if len(in) == 0 {
		return nil
	}
	out := make([]engine.CardTrigger, 0, len(in))
	for _, t := range in {
		if t.Rank == nil {
			continue
		}
		rank := *t.Rank - 2
		switch {
		case t.Suit != nil:
			c := engine.NewCard(rank, *t.Suit)
			out = append(out, engine.CardTrigger{ExactCard: &c})
		case t.Color != nil && (*t.Color == "red" || *t.Color == "black"):
			color := 0
			if *t.Color == "red" {
				color = 1
			}
			out = append(out, engine.CardTrigger{RankColor: &struct {
				Rank  int
				Color int // 0 black, 1 red
			}{rank, color}})
		default:
			out = append(out, engine.CardTrigger{RankOnly: &rank})
		}
	}
	return out
}

// New builds a Table from a store row and starts its goroutine. dev
// enables dev-only client commands (forced deals) for DEV_AUTH servers.
func New(row store.GameTable, persist Persister, dev bool) *Table {
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
		dev:     dev,
		restore: map[string]int64{},
	}
	for i := range t.seats {
		t.seats[i] = &seat{seat: i}
	}
	// born empty: the reaper may close a table nobody ever joined
	t.emptySince.Store(time.Now().Unix())
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

// rebuy rules: a top-up adds 100bb, max 3 per seat per session, credited
// only at the next hand start (never mid-hand).
const (
	rebuysMax = 3
	rebuyBB   = int64(100)
)

// topUp: queue a 100bb top-up for the caller, credited at the next hand.
func (t *Table) topUp(c *ws.Client) {
	s := t.seatOfClient(c)
	if s == nil {
		c.TrySend(protocol.ServerMsg{Type: "error", Error: "take a seat first"})
		return
	}
	if s.stack >= rebuyBB*t.cfg.BigBlind {
		c.TrySend(protocol.ServerMsg{Type: "error", Error: "top-up available below 100bb"})
		return
	}
	if s.rebuys >= rebuysMax {
		c.TrySend(protocol.ServerMsg{Type: "error", Error: "rebuy limit reached (3)"})
		return
	}
	if s.pendingTopUp > 0 {
		return // already queued
	}
	s.pendingTopUp = rebuyBB * t.cfg.BigBlind
	t.broadcastSeats()
	t.broadcastState()
}

// SeatedCount: occupied seats for the REST lobby (atomic read).
func (t *Table) SeatedCount() int { return int(t.occupied.Load()) }

// Busy: a hand is in progress (reaper guard).
func (t *Table) Busy() bool { return t.busy.Load() == 1 }

// EmptyFor: how long no client has been attached (0 when clients exist).
func (t *Table) EmptyFor() time.Duration {
	since := t.emptySince.Load()
	if since == 0 {
		return 0
	}
	return time.Since(time.Unix(since, 0))
}

// broadcastState: fresh per-viewer snapshot to every attached client.
func (t *Table) broadcastState() {
	for cl := range t.clients {
		seat := -1
		if s := t.seatOfClient(cl); s != nil {
			seat = s.seat
		}
		cl.TrySend(protocol.ServerMsg{Type: "state", State: t.snapshotFor(seat)})
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
			if t.dropTimer != nil {
				t.dropTimer.Stop()
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
		t.emptySince.Store(0)
		// Snapshot immediately: spectators render the table; a reconnecting
		// player re-adopts their seat without waiting for a join message.
		viewer := -1
		uid := in.client.UserID()
		for _, s := range t.seats {
			if s.userID != "" && s.userID == uid {
				s.conn = in.client
				viewer = s.seat
				break
			}
		}
		in.client.TrySend(protocol.ServerMsg{Type: "state", State: t.snapshotFor(viewer)})
		return
	case "__detach":
		delete(t.clients, in.client)
		if len(t.clients) == 0 {
			t.emptySince.Store(time.Now().Unix())
		}
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
	case "__drop_timeout":
		t.onDropTimeout()
		return
	case "__reveal_timeout":
		if len(t.revealPending) > 0 {
			t.revealPending = nil
			t.revealTimer = nil
			t.handEnded()
		}
		return
	case "__street_pace":
		if len(t.paceEvs) > 0 {
			evs := t.paceEvs
			t.paceEvs = nil
			t.publishEvents(evs)
			t.afterAdvance()
		}
		return
	}
	if _, ok := t.clients[in.client]; !ok {
		return
	}
	switch in.msg.Type {
	case "join":
		t.join(in.client, in.msg)
	case "top_up":
		t.topUp(in.client)
	case "leave":
		t.leave(in.client)
	case "action":
		t.action(in.client, in.msg)
	case "chat":
		t.chat(in.client, in.msg)
	case "rabbit":
		rabbitReveal(t, in)
	case "bomb_pot":
		t.armBombPot()
	case "texas_drop":
		t.armTexasDrop()
	case "dev_deal":
		t.devDeal(in)
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
	s.name = sanitizeName(m.Name, uid)
	t.loadRestore()
	if recorded, ok := t.restore[uid]; ok {
		// real chips: a returning player gets their last recorded stack back,
		// not a fresh buy-in
		s.stack = recorded
		c.TrySend(protocol.ServerMsg{Type: "error", Error: fmt.Sprintf("stack restored from your last session: $%.2f", float64(recorded)/100)})
	} else {
		s.stack = t.joinStack(m.Stack)
	}
	s.sittingOut = false
	s.lastAction = ""
	s.pendingTopUp = 0
	s.rebuys = 0
	t.broadcastSeats()
	c.TrySend(protocol.ServerMsg{Type: "state", State: t.snapshotFor(m.Seat)})
	t.maybeScheduleHand()
}

// joinStack: requested buy-in in cents, clamped to [1bb, 1000bb]; 0/negative = table default.
func (t *Table) joinStack(requested int64) int64 {
	def := t.cfg.StartingStackBB * t.cfg.BigBlind
	if requested <= 0 {
		return def
	}
	if requested < t.cfg.BigBlind {
		return t.cfg.BigBlind
	}
	if max := 1000 * t.cfg.BigBlind; requested > max {
		return max
	}
	return requested
}

// ---- bomb-pot arming / dev forced deals ----

// broadcastEvent: fan an event out to every connected client.
func (t *Table) broadcastEvent(ev protocol.Event) {
	for c := range t.clients {
		out := ev
		c.TrySend(protocol.ServerMsg{Type: "event", Event: &out})
	}
}

// armBombPot: manual arm (bomb_pot msg) — next hand is a double-board bomb pot.
func (t *Table) armBombPot() {
	if t.forceBombPot || t.forceTexasDrop || (t.runner != nil && t.texasDrop) {
		return
	}
	t.forceBombPot = true
	log.Printf("table %s: bomb pot armed manually", t.row.ID)
	t.broadcastEvent(protocol.Event{Type: protocol.EvBombPotArmed})
}

// armTexasDrop: manual arm (texas_drop msg) — next hand is a Texas Drop game.
// Supersedes an armed bomb pot; ignored while a drop game is running.
func (t *Table) armTexasDrop() {
	if t.forceTexasDrop || (t.runner != nil && t.texasDrop) {
		return
	}
	t.forceTexasDrop = true
	t.forceBombPot = false
	log.Printf("table %s: texas drop armed manually", t.row.ID)
	t.broadcastEvent(protocol.Event{Type: protocol.EvTexasDropArmed})
}

// devDeal: force this seat's hole cards next hand (DEV_AUTH tables only).
func (t *Table) devDeal(in inbox) {
	if !t.dev {
		in.client.TrySend(protocol.ServerMsg{Type: "error", Error: "dev_deal requires DEV_AUTH"})
		return
	}
	s := t.seatOfClient(in.client)
	if s == nil || len(in.msg.Cards) == 0 || len(in.msg.Cards) > 4 {
		return
	}
	if t.devDeals == nil {
		t.devDeals = map[int][]engine.Card{}
	}
	cards := make([]engine.Card, len(in.msg.Cards))
	copy(cards, in.msg.Cards)
	t.devDeals[s.seat] = cards
}

// loadedDeck: deck serving the next hand's holes so forced seats get their
// dev-requested cards. Dealing is round-major over seat-sorted players.
func (t *Table) loadedDeck(seats []engine.SeatState, rounds int) (engine.Deck, bool) {
	forced := t.devDeals
	t.devDeals = nil
	used := map[engine.Card]bool{}
	for _, cs := range forced {
		for _, c := range cs {
			used[c] = true
		}
	}
	var fill []engine.Card
	for c := engine.Card(0); c <= 51; c++ {
		if !used[c] {
			fill = append(fill, c)
		}
	}
	order := make([]engine.Card, 0, len(seats)*rounds)
	next := 0
	for r := 0; r < rounds; r++ {
		for _, s := range seats {
			if r < len(forced[s.Seat]) {
				order = append(order, forced[s.Seat][r])
			} else {
				order = append(order, fill[next])
				next++
			}
		}
	}
	deck, err := engine.LoadedDeck(order)
	if err != nil {
		log.Printf("table %s: loaded deck: %v", t.row.ID, err)
		return engine.Deck{}, false
	}
	return deck, true
}
