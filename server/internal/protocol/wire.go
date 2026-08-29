package protocol

// Wire envelope for the WS connection. Client->server messages carry a
// command; server->client carry either a snapshot or an event.
type ClientMsg struct {
	Type   string `json:"type"` // join | leave | action | chat | rabbit
	Seat   int    `json:"seat,omitempty"`
	Name   string `json:"name,omitempty"`
	Kind   string `json:"kind,omitempty"` // fold | check | call | bet (raise-TO)
	Amount int64  `json:"amount,omitempty"`
	Text   string `json:"text,omitempty"`
	Reveal *bool  `json:"reveal,omitempty"` // 7-2 uncontested decision
}

// ServerMsg is everything the server sends. Exactly one payload is set.
type ServerMsg struct {
	Type  string          `json:"type"` // state | event | error | chat | seats | action_required | post_hand
	State *TableState     `json:"state,omitempty"`
	Event *Event          `json:"event,omitempty"`
	Chat  *ChatMsg        `json:"chat,omitempty"`
	Seats []SeatWire      `json:"seats,omitempty"`
	Legal *LegalActions   `json:"legal,omitempty"` // type=action_required, to the actor
	Post  *PostHandPrompt `json:"post,omitempty"`  // type=post_hand, to the winner
	Error string          `json:"error,omitempty"`
}

// TableState: full snapshot on join / reconnect.
type TableState struct {
	TableID        string        `json:"table_id"`
	Name           string        `json:"name"`
	GameType       string        `json:"game_type"`
	Config         ConfigWire    `json:"config"`
	Seats          []SeatWire    `json:"seats"`
	YourSeat       int           `json:"your_seat"` // -1 = observing
	HandNo         int64         `json:"hand_no"`
	Street         string        `json:"street,omitempty"`
	Board          [][]Card      `json:"board,omitempty"`
	Pot            int64         `json:"pot,omitempty"`
	YourCards      []Card        `json:"your_cards,omitempty"`  // private, this seat only
	ToActSeat      *int          `json:"to_act_seat,omitempty"` // nil = nobody
	DeadlineUnixMs int64         `json:"deadline_unix_ms,omitempty"`
	LegalActions   *LegalActions `json:"legal_actions,omitempty"`
	HandInProgress bool          `json:"hand_in_progress"`
}

// ConfigWire: subset of table config the client renders.
type ConfigWire struct {
	GameType       string `json:"game_type"` // NLHE | PLO4
	SmallBlind     int64  `json:"small_blind"`
	BigBlind       int64  `json:"big_blind"`
	MaxSeats       int    `json:"max_seats"`
	ActionTimeoutS int    `json:"action_timeout_s"`
}

// SeatWire: one seat's public state.
type SeatWire struct {
	Seat       int    `json:"seat"`
	Player     string `json:"player,omitempty"` // empty = open
	UserID     string `json:"user_id,omitempty"`
	Stack      int64  `json:"stack,omitempty"`
	InHand     bool   `json:"in_hand,omitempty"`
	Folded     bool   `json:"folded,omitempty"`
	AllIn      bool   `json:"all_in,omitempty"`
	SittingOut bool   `json:"sitting_out,omitempty"`
	IsButton   bool   `json:"is_button,omitempty"`
	LastAction string `json:"last_action,omitempty"`
	StreetBet  int64  `json:"street_bet,omitempty"`
}

type ChatMsg struct {
	Seat   int    `json:"seat"`
	Player string `json:"player"`
	Text   string `json:"text"`
}

// PostHandPrompt: uncontested-winner decision (7-2 reveal and/or rabbit).
type PostHandPrompt struct {
	Seat   int  `json:"seat"`
	Bounty bool `json:"bounty"` // reveal-or-muck offered
	Rabbit bool `json:"rabbit"` // rabbit hunt offered
}
