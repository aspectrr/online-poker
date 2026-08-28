# BUILD_NOTES — Poker Engine (ASPTR-183)

Server-authoritative engine for friends-only play-money poker.
Location: `server/internal/engine` (+ `server/internal/protocol`).
Go 1.26, zero dependencies.

## Quick start

```go
import (
    "github.com/aspectrr/online-poker/server/internal/engine"
)

cfg := engine.TableConfig{
    Game: engine.NLHE,
    SmallBlind: 50, BigBlind: 100,          // int64 cents ALWAYS
    ActionTimeoutSecs: 30,
    InterHandDelaySecs: 5,                  // transport sleeps between hands
    RunItTwice: engine.RITNever,            // or RITAlways
    RabbitHunt: true,
    BombPotEveryNHands: 6,                  // table layer decides, sets BombPot
    BombPotCardTriggers: []engine.CardTrigger{...},
    SevenDeuce: engine.SevenDeuceConfig{Enabled: true, Amount: 500},
    ButtonSeat: 0,
    HandID: 42,
    BombPot: false,                          // this hand IS a bomb pot
}
seats := []engine.SeatState{
    {Seat: 0, Player: "alice", Stack: 10000},
    {Seat: 3, Player: "bob", Stack: 5000},
}

r, err := engine.StartHand(cfg, seats)
for !r.Done() {
    la := r.LegalActionsFor()               // nil when waiting on runout/post-hand
    if la != nil {
        evs, err := r.Advance(&engine.Action{Seat: la.Seat, Kind: engine.Call})
        // broadcast evs (JSON-friendly), handle err = illegal action
    } else {
        evs, _ := r.Advance(nil)            // tick: deal streets, runouts, finish
    }
}
```

## API surface

- `StartHand(cfg TableConfig, seats []SeatState) (*HandRunner, error)`
- `(*HandRunner).Advance(a *Action) ([]Event, error)` — one action or nil-tick; returns events since last call
- `(*HandRunner).LegalActionsFor() *LegalActions` — current actor's options: fold/check/call, `MinRaiseTo`/`MaxRaiseTo` (**raise-TO semantics**: `Action.Amount` is the target street total, not the raise size)
- `(*HandRunner).Done() bool`, `Stacks() []FinalStack`
- `(*HandRunner).DealtCards() []Card` — every card dealt this hand (for bomb-pot card triggers between hands)
- `engine.AnyTriggerMatch(triggers, dealtCards) bool` — table layer calls this after each hand to decide if next hand is a bomb pot

## Semantics

**Betting**: raise-TO; min-raise = last *full* raise size (street starts at BB). Incomplete all-in does NOT reopen betting for players who already acted. Heads-up: button is SB, acts first preflop; BB first postflop. Sole non-all-in player is never prompted once all bets matched (hand runs out).

**Side pots**: built from commitment levels of non-folded players. Folded chips are dead money in the layer where they stopped. Odd chip on split → first winner left of button.

**All-in runout**: `EvAllInRunout` emitted once; streets deal without prompting.

**Run it twice** (`RunItTwice: RITAlways`): heads-up only. Two independent boards (shared history dealt so far), each pot half. Odd chip → board 0.

**Bomb pot** (`cfg.BombPot: true`): double-board PLO4 — everyone antes 1BB (capped at stack), 4 hole cards, **no preflop betting**, two flops, subsequent streets bet on both boards (bets apply to the whole hand; pot splits half per board at showdown). Cadence (`BombPotEveryNHands`) and card triggers are the table layer's job: it tracks hand count, calls `AnyTriggerMatch(cfg.BombPotCardTriggers, prevRunner.DealtCards())`, sets `BombPot: true` on the next hand's config.

**Card triggers** (`CardTrigger`): exactly one of `ExactCard` (rank+suit), `RankOnly` (rank, any suit), `RankColor` (rank + red/black). `Validate()` rejects malformed ones at StartHand.

**7-2 bounty** (NLHE only): winner holding a 7 AND a 2 among hole cards collects `Amount` from every dealt-in player. At showdown (sole pot winner, no split). Uncontested: winner chooses `Reveal` (bounty pays) or `Muck` (no bounty) — the engine pauses between `EvPotAwarded` and `EvHandEnded` while `pendingReveal` is offered; check `LegalActionsFor() == nil && !Done()` and send Reveal/Muck from the winner.

**Rabbit hunt** (`RabbitHunt: true`, non-bomb-pot): after uncontested win (after reveal/muck decision if applicable), winner may send `Action{Kind: RabbitHunt}`; engine deals remaining board (burn convention) and emits `EvRabbitHunt`. Send `Muck` (or anything non-RabbitHunt) to skip. Rabbit is offered even after a preflop fold (full board runs).

**Ante** (`cfg.Ante`): every dealt-in player antes (capped at stack) before blinds.

## Events

`Event` (JSON tags, tagged union on `type`): `hand_started`, `blinds_posted`, `antes_posted`, `street_dealt` (`board_index` 0/1 for double boards), `action_accepted`, `turn_changed` (carries `deadline_unix_ms` when `ActionTimeoutSecs > 0`, and `pot`), `all_in_runout`, `showdown` (`hole_cards` reveals), `pot_awarded` (`pot_index` per side pot, `board_index` per board, `winners[].hand_name`), `seven_deuce_bounty`, `rabbit_hunt`, `hand_ended` (`stacks` final).

`server/internal/protocol` re-exports all engine types (`protocol.Event == engine.Event` etc.) so transport code imports one package. Private hole-card delivery at deal time is the transport's job (per-seat channel); engine events only ever carry public info.

## Evaluation

`Evaluate7([7]Card) uint32` — NLHE. `EvaluatePLO(hole[4], board[5])` — exactly 2 hole + 3 board. Values: category<<26 | tiebreak ranks 4-bit packed; comparable across calls, `HandCategoryName(v)` for display. 21/60 subset loop, no lookup tables — fine for friends-only volume; swap in a 7462-table if ever profiled hot.

## Money

int64 cents everywhere. No floats, ever.

## Known simplifications (deliberate)

- RIT only when heads-up from the start of the hand; multiway all-in RIT not offered.
- 7-2 showdown bounty only on single-pot sole winners; split pots don't pay.
- Straddle: not supported (per spec).
- Action timeout: engine emits deadlines; enforcing (auto check/fold) is the transport's job.
- Inter-hand delay: config is informational; transport sleeps.

## Tests

`go test ./...` in `server/`. Table-driven: min-raise legality, reopen rules, side pot construction, odd chip, RIT halves (+side pots), bomb pot flow, 7-2 (showdown/reveal/muck), trigger matching, evaluator categories/comparisons/PLO 2-from-hand, plus 300 random hands × 6 configs asserting chip conservation and termination.
