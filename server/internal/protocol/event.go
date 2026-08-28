// Package protocol exposes the engine's JSON-friendly types for transport
// layers. Engine events are already JSON-serialized directly; this package
// exists so ws/http code imports protocol, not engine internals, and gives
// a place for wire-only helpers (e.g. per-seat redaction) later.
package protocol

import "github.com/aspectrr/online-poker/server/internal/engine"

// Event mirrors engine.Event (JSON-compatible).
type Event = engine.Event

type EventType = engine.EventType

const (
	EvHandStarted      = engine.EvHandStarted
	EvHolesDealt       = engine.EvHolesDealt
	EvBlindsPosted     = engine.EvBlindsPosted
	EvAntesPosted      = engine.EvAntesPosted
	EvStreetDealt      = engine.EvStreetDealt
	EvActionAccepted   = engine.EvActionAccepted
	EvActionRejected   = engine.EvActionRejected
	EvTurnChanged      = engine.EvTurnChanged
	EvAllInRunout      = engine.EvAllInRunout
	EvShowdown         = engine.EvShowdown
	EvPotAwarded       = engine.EvPotAwarded
	EvSevenDeuceBounty = engine.EvSevenDeuceBounty
	EvRabbitHunt       = engine.EvRabbitHunt
	EvHandEnded        = engine.EvHandEnded
)

type (
	Card         = engine.Card
	Action       = engine.Action
	ActionKind   = engine.ActionKind
	Winner       = engine.Winner
	HoleReveal   = engine.HoleReveal
	FinalStack   = engine.FinalStack
	LegalActions = engine.LegalActions
	TableConfig  = engine.TableConfig
	SeatState    = engine.SeatState
	HandRunner   = engine.HandRunner
)

// StartHand mirrors engine.StartHand.
func StartHand(cfg TableConfig, seats []SeatState) (*HandRunner, error) {
	return engine.StartHand(cfg, seats)
}

// Hole-card privacy: engine events only ever contain publicly revealed
// cards (showdown / chosen reveals). Private hole-card delivery at deal
// time is the transport layer's job (per-seat private channel).
