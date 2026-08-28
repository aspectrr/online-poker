package engine

import "fmt"

// Game type.
type GameType int

const (
	NLHE GameType = iota
	PLO4
)

func (g GameType) String() string {
	if g == PLO4 {
		return "PLO4"
	}
	return "NLHE"
}

// HoleCardCount: 2 for NLHE, 4 for PLO4 (bomb pots deal PLO).
func (g GameType) HoleCardCount() int {
	if g == PLO4 {
		return 4
	}
	return 2
}

// TableConfig per table.
type TableConfig struct {
	Game GameType

	// Money: int64 cents ALWAYS.
	SmallBlind int64
	BigBlind   int64
	Ante       int64 // regular-hand ante (bomb pots use BigBlind)

	// StartingStackBB: informational for lobby/topup; seats carry stacks.
	StartingStackBB int64

	ActionTimeoutSecs  int // 0 = no timeout; engine emits deadline in events
	InterHandDelaySecs int // transport sleeps this long between hands

	// RunItTwice: RITNever (default) or RITAlways. When always and exactly
	// 2 players remain all-in, two boards run, pot split per board.
	RunItTwice string

	RabbitHunt bool // allow revealing rest of board after uncontested win

	// BombPotEveryNHands: dealt every N completed hands (0 = never),
	// unless card triggers are set (they replace the cadence).
	BombPotEveryNHands int

	// BombPotCardTriggers: next hand is a bomb pot if any trigger matches
	// a card dealt during the previous hand (burn+board+hole).
	BombPotCardTriggers []CardTrigger

	// BombPot: this hand IS a bomb pot. The table layer sets this via
	// cadence (BombPotEveryNHands) or AnyTriggerMatch on the previous
	// hand's DealtCards() — the engine itself is per-hand stateless.
	BombPot bool

	// ButtonSeat: seat index of the button for this hand.
	ButtonSeat int

	// HandID: caller-assigned id echoed in events.
	HandID int64

	// SevenDeuce bounty config.
	SevenDeuce SevenDeuceConfig
}

// CardTrigger matches a dealt card.
type CardTrigger struct {
	// Exactly one set:
	ExactCard *Card // rank + suit
	RankOnly  *int  // rank, any suit
	RankColor *struct {
		Rank  int
		Color int // 0 black, 1 red
	}
}

func (t CardTrigger) Matches(c Card) bool {
	switch {
	case t.ExactCard != nil:
		return c == *t.ExactCard
	case t.RankOnly != nil:
		return c.Rank() == *t.RankOnly
	case t.RankColor != nil:
		return c.Rank() == t.RankColor.Rank && c.Color() == t.RankColor.Color
	default:
		return false
	}
}

// Validate: exactly one pattern set and in range.
func (t CardTrigger) Validate() error {
	n := 0
	if t.ExactCard != nil {
		n++
	}
	if t.RankOnly != nil {
		n++
	}
	if t.RankColor != nil {
		n++
	}
	if n != 1 {
		return fmt.Errorf("card trigger must set exactly one pattern, got %d", n)
	}
	if t.RankOnly != nil && (*t.RankOnly < 0 || *t.RankOnly > 12) {
		return fmt.Errorf("rank out of range: %d", *t.RankOnly)
	}
	if t.RankColor != nil {
		rc := t.RankColor
		if rc.Rank < 0 || rc.Rank > 12 || (rc.Color != 0 && rc.Color != 1) {
			return fmt.Errorf("rank/color out of range: rank=%d color=%d", rc.Rank, rc.Color)
		}
	}
	return nil
}

const (
	RITNever  = "never"
	RITAlways = "always"
)

func (t *TableConfig) Validate() error {
	if t.SmallBlind <= 0 || t.BigBlind <= 0 {
		return fmt.Errorf("blinds must be positive, got sb=%d bb=%d", t.SmallBlind, t.BigBlind)
	}
	if t.SmallBlind > t.BigBlind {
		return fmt.Errorf("sb %d > bb %d", t.SmallBlind, t.BigBlind)
	}
	if t.Ante < 0 {
		return fmt.Errorf("ante must be >= 0, got %d", t.Ante)
	}
	switch t.RunItTwice {
	case "", RITNever, RITAlways:
	default:
		return fmt.Errorf("run_it_twice must be %q or %q, got %q", RITNever, RITAlways, t.RunItTwice)
	}
	if t.BombPotEveryNHands < 0 {
		return fmt.Errorf("bomb pot every N hands must be >= 0, got %d", t.BombPotEveryNHands)
	}
	for i, tr := range t.BombPotCardTriggers {
		if err := tr.Validate(); err != nil {
			return fmt.Errorf("trigger[%d]: %w", i, err)
		}
	}
	return nil
}

// SevenDeuceConfig: every dealt-in player (except winner) pays bounty to a
// player who wins holding a 7 AND a 2 among hole cards at showdown, or wins
// uncontested with reveal (transport asks; engine applies on WinUncontested
// action with Reveal=true).
type SevenDeuceConfig struct {
	Enabled bool
	Amount  int64 // per-player payout, cents
}

// SeatState: seat identity + chips at hand start.
type SeatState struct {
	Seat       int
	Player     string
	Stack      int64 // cents
	SittingOut bool
}

// Action a player takes on their turn.
type Action struct {
	Seat   int
	Kind   ActionKind
	Amount int64 // raise-TO total for Raise, cents
}

type ActionKind int

const (
	Fold ActionKind = iota
	Check
	Call
	Raise // raise-TO semantics
	Reveal
	Muck
	RabbitHunt
)

func (a ActionKind) String() string {
	switch a {
	case Fold:
		return "fold"
	case Check:
		return "check"
	case Call:
		return "call"
	case Raise:
		return "raise"
	case Reveal:
		return "reveal"
	case Muck:
		return "muck"
	}
	return "?"
}
