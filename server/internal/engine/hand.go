package engine

import (
	"fmt"
	"sort"
	"time"
)

// Street of betting.
type Street int

const (
	Preflop Street = iota
	Flop
	Turn
	River
	Showdown
)

func (s Street) String() string {
	switch s {
	case Preflop:
		return "preflop"
	case Flop:
		return "flop"
	case Turn:
		return "turn"
	case River:
		return "river"
	case Showdown:
		return "showdown"
	}
	return "?"
}

// player: mutable per-hand state. Index in r.players is rotation order
// (players are seat-sorted, so rotation == seat order).
type player struct {
	seat      int
	name      string
	stack     int64 // chips behind
	committed int64 // total in pot this hand (blinds, antes, bets)
	streetBet int64 // committed this street
	folded    bool
	allIn     bool
	hole      []Card
}

func (p *player) inHand() bool { return !p.folded && len(p.hole) > 0 }

// HandRunner: one hand's lifecycle. Create via StartHand, then drive with
// Advance. Batch events per call; transport converts via protocol pkg.
type HandRunner struct {
	cfg     TableConfig
	players []*player
	btn     int // index into players
	street  Street
	deck    Deck
	board   [][]Card // board[0] main, board[1] second (RIT / bomb pot)
	dealt   []Card   // every card dealt this hand (bomb pot trigger matching)

	toActIdx      int // -1 when no action pending
	lastFullRaise int64
	highBet       int64

	// responded[i]: player acted since last full raise (or street start).
	responded map[int]bool

	done         bool
	handID       int64
	bombPot      bool
	runItTwice   bool // RIT active for this hand (HU + always)
	headsUp      bool
	sbIdx, bbIdx int

	pendingRevealIdx int // -1 none; uncontested winner deciding reveal
	rabbitAvailable  bool
	rabbitTaken      bool
	runoutAnnounced  bool // EvAllInRunout emitted once per hand

	setupEvents []Event // drained by first Advance(nil)
}

// StartHand validates config and seats, deals, posts blinds/antes, and
// returns a runner. The first Advance(nil) drains setup events and emits
// the first TurnChanged (or runs to showdown if action can't open).
func StartHand(cfg TableConfig, seats []SeatState) (*HandRunner, error) {
	d, err := NewDeck()
	if err != nil {
		return nil, err
	}
	return startHand(cfg, seats, d)
}

// startHand: core constructor with injectable deck (deterministic tests).
func startHand(cfg TableConfig, seats []SeatState, d Deck) (*HandRunner, error) {
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	var inPlay []SeatState
	for _, s := range seats {
		if !s.SittingOut && s.Stack > 0 {
			inPlay = append(inPlay, s)
		}
	}
	if len(inPlay) < 2 {
		return nil, fmt.Errorf("need >= 2 dealt-in players, got %d", len(inPlay))
	}
	if len(inPlay) > 9 {
		return nil, fmt.Errorf("max 9 seats, got %d", len(inPlay))
	}
	if cfg.BombPot && cfg.Game != NLHE && cfg.Game != PLO4 {
		return nil, fmt.Errorf("bomb pot requires NLHE or PLO4 table")
	}
	if cfg.SevenDeuce.Enabled && cfg.Game != NLHE && !cfg.BombPot {
		return nil, fmt.Errorf("7-2 bounty is NLHE-only")
	}

	r := &HandRunner{
		cfg:              cfg,
		handID:           cfg.HandID,
		bombPot:          cfg.BombPot,
		pendingRevealIdx: -1,
		responded:        map[int]bool{},
	}
	for _, s := range inPlay {
		r.players = append(r.players, &player{seat: s.Seat, name: s.Player, stack: s.Stack})
	}
	sort.Slice(r.players, func(i, j int) bool { return r.players[i].seat < r.players[j].seat })

	r.deck = d

	btn := -1
	for i, p := range r.players {
		if p.seat == cfg.ButtonSeat {
			btn = i
			break
		}
	}
	if btn == -1 {
		return nil, fmt.Errorf("ButtonSeat %d not among dealt-in seats", cfg.ButtonSeat)
	}
	r.btn = btn
	r.headsUp = len(r.players) == 2
	// RIT: "always" config + heads-up (standard; multiway RIT omitted).
	r.runItTwice = cfg.RunItTwice == RITAlways && r.headsUp && !r.bombPot

	holeN := cfg.Game.HoleCardCount()
	if r.bombPot {
		holeN = 4 // bomb pots are PLO4 regardless of table game
	}
	for round := 0; round < holeN; round++ {
		for _, p := range r.players {
			c, err := r.deck.Draw(1)
			if err != nil {
				return nil, err
			}
			p.hole = append(p.hole, c[0])
			r.dealt = append(r.dealt, c[0])
		}
	}

	r.setupEvents = []Event{{
		Type:    EvHandStarted,
		HandID:  r.handID,
		BombPot: r.bombPot,
	}}

	if r.bombPot {
		// all ante 1BB, no preflop betting: first street is the double flop
		var antes []Event
		for _, p := range r.players {
			a := min64(cfg.BigBlind, p.stack)
			p.stack -= a
			p.committed += a
			p.streetBet = a
			if p.stack == 0 {
				p.allIn = true
			}
			antes = append(antes, Event{Type: EvAntesPosted, HandID: r.handID, Seat: p.seat, Player: p.name, Amount: a})
		}
		r.setupEvents = append(r.setupEvents, antes...)
		r.board = [][]Card{nil, nil}
		r.toActIdx = -1
		// no preflop betting: mark everyone as having acted
		for i := range r.players {
			r.responded[i] = true
		}
		r.highBet = 0
	} else {
		sb := r.btn // heads-up: button IS the small blind
		bb := r.nextIdx(sb)
		if !r.headsUp {
			sb = r.nextIdx(r.btn)
			bb = r.nextIdx(sb)
		}
		r.sbIdx, r.bbIdx = sb, bb
		if cfg.Ante > 0 {
			for _, p := range r.players {
				a := min64(cfg.Ante, p.stack)
				p.stack -= a
				p.committed += a
				if p.stack == 0 {
					p.allIn = true
				}
				r.setupEvents = append(r.setupEvents, Event{Type: EvAntesPosted, HandID: r.handID, Seat: p.seat, Player: p.name, Amount: a})
			}
		}
		r.postBlind(sb, cfg.SmallBlind)
		r.postBlind(bb, cfg.BigBlind)
		r.setupEvents = append(r.setupEvents,
			Event{Type: EvBlindsPosted, HandID: r.handID, Seat: r.players[sb].seat, Player: r.players[sb].name, Amount: cfg.SmallBlind},
			Event{Type: EvBlindsPosted, HandID: r.handID, Seat: r.players[bb].seat, Player: r.players[bb].name, Amount: cfg.BigBlind},
		)
		r.highBet = cfg.BigBlind
		r.lastFullRaise = cfg.BigBlind
		if r.headsUp {
			r.toActIdx = r.btn // button is SB heads-up, acts first preflop
		} else {
			r.toActIdx = r.nextIdx(bb)
		}
	}
	return r, nil
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func (r *HandRunner) nextIdx(i int) int { return (i + 1) % len(r.players) }

func (r *HandRunner) postBlind(idx int, amount int64) {
	p := r.players[idx]
	a := min64(amount, p.stack)
	p.stack -= a
	p.committed += a
	p.streetBet = a
	if p.stack == 0 {
		p.allIn = true
	}
}

// DealtCards: every card dealt this hand (holes + burns + board).
// Table layer matches BombPotCardTriggers against this between hands.
func (r *HandRunner) DealtCards() []Card { return r.dealt }

// AnyTriggerMatch reports whether any trigger matches any dealt card.
func AnyTriggerMatch(triggers []CardTrigger, cards []Card) bool {
	for _, c := range cards {
		for _, t := range triggers {
			if t.Matches(c) {
				return true
			}
		}
	}
	return false
}

// potTotal: chips in play.
func (r *HandRunner) potTotal() int64 {
	var t int64
	for _, p := range r.players {
		t += p.committed
	}
	return t
}

// activeCount: non-folded with cards.
func (r *HandRunner) activeCount() int {
	n := 0
	for _, p := range r.players {
		if p.inHand() {
			n++
		}
	}
	return n
}

// deadline for the current actor, 0 if no timeout configured.
func (r *HandRunner) deadline() int64 {
	if r.cfg.ActionTimeoutSecs <= 0 {
		return 0
	}
	return time.Now().Add(time.Duration(r.cfg.ActionTimeoutSecs) * time.Second).UnixMilli()
}

// Done reports hand completion (rabbit hunt may still be offered).
func (r *HandRunner) Done() bool { return r.done }

// Stacks: end-of-hand stacks (valid once Done).
func (r *HandRunner) Stacks() []FinalStack {
	out := make([]FinalStack, len(r.players))
	for i, p := range r.players {
		out[i] = FinalStack{Seat: p.seat, Player: p.name, Stack: p.stack}
	}
	return out
}
