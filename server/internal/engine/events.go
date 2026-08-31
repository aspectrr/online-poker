package engine

// Event: engine-side, JSON-friendly. protocol.FromEngine converts to wire
// types; transport redacts private fields (hole cards) per seat.
type EventType string

const (
	EvHandStarted      EventType = "hand_started"
	EvHolesDealt       EventType = "holes_dealt"
	EvBlindsPosted     EventType = "blinds_posted"
	EvAntesPosted      EventType = "antes_posted"
	EvStreetDealt      EventType = "street_dealt"
	EvActionAccepted   EventType = "action_accepted"
	EvActionRejected   EventType = "action_rejected"
	EvTurnChanged      EventType = "turn_changed"
	EvAllInRunout      EventType = "all_in_runout"
	EvShowdown         EventType = "showdown"
	EvPotAwarded       EventType = "pot_awarded"
	EvSevenDeuceBounty EventType = "seven_deuce_bounty"
	EvRabbitHunt       EventType = "rabbit_hunt"
	EvHandEnded        EventType = "hand_ended"

	// EvBombPotArmed is emitted by the table layer (not the engine) when the
	// next hand will be a bomb pot — via card trigger match or manual arm.
	// Cards carries the matching trigger card when trigger-driven.
	EvBombPotArmed EventType = "bomb_pot_armed"
)

type Winner struct {
	Seat       int    `json:"seat"`
	Amount     int64  `json:"amount"`
	PotIndex   int    `json:"pot_index,omitempty"`
	BoardIndex int    `json:"board_index,omitempty"`
	BoardCards []Card `json:"board_cards,omitempty"`
	HighCard   int    `json:"high_card,omitempty"` // high rank of best 5
	HandName   string `json:"hand_name,omitempty"`
}
type HoleReveal struct {
	Seat  int    `json:"seat"`
	Cards []Card `json:"cards"`
}

type FinalStack struct {
	Seat   int    `json:"seat"`
	Player string `json:"player"`
	Stack  int64  `json:"stack"`
}

type Event struct {
	Type           EventType    `json:"type"`
	HandID         int64        `json:"hand_id"`
	Street         string       `json:"street,omitempty"`
	BombPot        bool         `json:"bomb_pot,omitempty"`
	Seat           int          `json:"seat,omitempty"` // actor / recipient
	Player         string       `json:"player,omitempty"`
	Amount         int64        `json:"amount,omitempty"` // chips moved / bet
	To             int64        `json:"to,omitempty"`     // raise-TO total
	Cards          []Card       `json:"cards,omitempty"`  // cards revealed by this event
	BoardIndex     int          `json:"board_index,omitempty"`
	Pot            int64        `json:"pot,omitempty"`
	PotIndex       int          `json:"pot_index,omitempty"`
	ToAct          int          `json:"to_act,omitempty"` // seat now to act
	DeadlineUnixMs int64        `json:"deadline_unix_ms,omitempty"`
	Action         *Action      `json:"action,omitempty"`
	Winners        []Winner     `json:"winners,omitempty"`
	HoleCards      []HoleReveal `json:"hole_cards,omitempty"`
	Rabbit         []Card       `json:"rabbit,omitempty"`
	Stacks         []FinalStack `json:"stacks,omitempty"`
	Reason         string       `json:"reason,omitempty"`
	Uncontested    bool         `json:"uncontested,omitempty"`
	// ButtonSeat: hand_started only — where the dealer button sits this hand.
	// Pointer so seat 0 survives omitempty (clients animate the button move).
	ButtonSeat *int `json:"button_seat,omitempty"`
}

// LegalActions: what the current actor may do.
type LegalActions struct {
	Seat       int   `json:"seat"`
	CanFold    bool  `json:"can_fold"`
	CanCheck   bool  `json:"can_check"`
	CanCall    bool  `json:"can_call"`
	CallAmount int64 `json:"call_amount"`
	CanRaise   bool  `json:"can_raise"`
	MinRaiseTo int64 `json:"min_raise_to"`
	MaxRaiseTo int64 `json:"max_raise_to"` // committed + stack
}
