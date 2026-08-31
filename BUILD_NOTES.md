# BUILD NOTES — ASPTR-189: Cards + animations (frontend)

All in `web/`. Reuses ASPTR-182 tokens (felt green/gold) + `cn`/cva conventions. No new deps.

## Components (`src/components/cards/`)

- **`Card.tsx`** — playing card, `role="img"` + aria-label (`"K of diamonds"`). 4-color suits: s `#1a1a1a`, h `#d33`, d `#3377dd`, c `#2a8a3a` (exact spec colors). Suits are SVG paths in a 100×100 viewBox (spade, heart, diamond, club w/ stem). Ranks 2–10: corner index (top-left + rotated bottom-right, font-display bold) + pip grid — side columns at x=0.32/0.68, center pips per-rank (`CENTER_PIPS`), lower-half pips rotated 180° (`FLIP_ROWS`); 2/3 are single-center-column layouts. JQKA: letter (2.5em) over big suit glyph centered. Card body: white, `rounded-lg`, subtle black border + two-layer shadow. Sizes sm 56×80 / md 88×124 / lg 112×157 with fontSize 22/30/38 driving pip scale. `CardBack` = felt lattice SVG pattern (green grid + gold dots, gold border frame) — `pattern id` is shared per document, fine since identical.
- **`CardRow.tsx`** — row of `{rank, suit, win?}` specs, gap variants tight/default/loose. 3D flip: outer wrapper has `[perspective:900px]`, inner `preserve-3d` div toggles `rotateY(180deg)` (500ms); face + back are siblings with `backface-visibility:hidden`, back pre-rotated 180°. `faceDownCount` / `revealed=false` control state. `dealDelay(i, ms)` helper returns `{animation-delay}` style for stagger.
- No card-in-card abstraction for court art — letter+suit reads clean at poker sizes; real court illustrations can slot into the same `isCourt()` branch later.

## Animations (`src/styles/animations.css`, appended)

- `deal-in` — slide from top-left deck origin (`translate(-60vw,-18vh) rotate(-24deg) scale(.85)`) + fade, 480ms spring-out curve. `.animate-deal` + per-card `animation-delay`.
- `win-pulse` — gold box-shadow pulse (1px→2px ring + 18px→30px glow), 1.1s infinite. Applied via `.card-win` on flip wrapper (ring wraps whole card incl. radius).
- `chip-fly` — translate by `--chip-x`/`--chip-y` CSS vars + fade + scale down, 900ms forwards. Demo sets vars inline per chip.
- `.chip` — 34px poker chip: `repeating-conic-gradient` edge stripes, white border, dashed inner ring. Red (danger token) base.
- flip itself = transition on the wrapper (no keyframe needed).

## Demo route `/cards` (`src/pages/Cards.tsx`)

Playground (felt-table panel): hero hole cards (As Ks) w/ flip button, 5-card board deal w/ 110ms stagger + empty dashed slots + pot label, win-pulse toggle (board cards glow), ship-pot (6 chips fly up w/ 70ms stagger). Full 52-deck grid (13 cols, deal-in stagger 40ms). Sizes & back section (sm/md/lg face + faceDown). Header links back to `/`.

## Verification

- `tsc -b` + `vite build` green (210kB js / 33.6kB css gz ~68kB+7kB).
- Interactive pass via chrome-devtools on dev server: deck grid 52 cards rendered; pip counts verified per rank (2→4 svgs incl. 2 corner suits, …, 10→12; found + fixed 9 missing center pip and 10 needing two center pips during this check); flip toggles `matrix3d` rotateY 180°; `animationName` `win-pulse`/`chip-fly` active on toggles; console clean.
- Geometry: pip centers land on spec fractions (measured bounding rects), court letter+suit fits card (122px content in 124px card).

## Not touched / next

`server/`, lobby pages. Next consumer: table view — compose CardRow + deal/flip/win/chip animations there; chip-fly origin/target should be measured element-to-element (demo uses fixed vars).

---

# BUILD NOTES — ASPTR-179: Supabase schema + store layer

## What shipped

- `supabase/migrations/0002_tables.sql` — `game_tables` (uuid pk, name, game_type, config jsonb, created_by → public.users, created_at) and `hands` (bigserial pk, table_id → game_tables on delete cascade, hand_no, data jsonb, created_at). Index `(table_id, hand_no)` for ListHands.
- `server/internal/store/store.go` — `TableConfig` struct (jsonb wire format, see below), `GameTable`/`Hand` rows, `Store` with `CreateTable`, `ListTables`, `GetTable`, `InsertHand`, `ListHands(tableID, limit)`, plus `ErrNotFound`.
- `server/internal/store/store_test.go` — 39 tests: validation table-driven OK/error cases, defaults, JSON round-trip. Plain unit tests, no DB required.

## pgx over GORM — why

Five methods, all single-table CRUD with jsonb payloads. pgx/v5 + pgxpool: no ORM reflection on the hot hand-insert path, jsonb scans straight into `[]byte`, SQL is visible and reviewable. GORM would add a dependency tree to map 2 tables. Revisit only if query surface grows joins/aggregations.

## RLS

Same pattern as 0001: authenticated SELECT policy, no write policies → writes only via service role (RLS-exempt, from Go). Migration also includes explicit GRANTs — hosted Supabase does this via default privileges but local `supabase db start` does not, so without them local RLS tests fail at permission, not policy. Sequence grant needed for hands_id_seq usage.

Verified locally: `supabase db start` + lint clean + authenticated role can read but not insert; service role path exercised via direct inserts. Stopped db after.

## Config validation

In Go (`TableConfig.Validate`), not SQL — engine consumes it, error messages surface to API callers.

- `blinds_sb_bb`: `[sb, bb]` cents, both > 0, sb ≤ bb. (Spec said single int64 but sb≤bb check needs both — went with 2-elem array matching the JSON shape.)
- `action_timeout_s`, `inter_hand_delay_s`: 5–300
- `rit`: never | always (default never)
- `bomb_pot_mode`: off | manual | trigger (default off); trigger mode requires ≥1 trigger
- triggers: rank 2–14 required, suit 0–3 or null, color red|black or null
- `seven_deuce_bounty`, `bomb_pot_antes`: ≥ 0
- `max_seats`: 1–22, default 9 (default applied in `ApplyDefaults`, so 0 is valid input)
- `ApplyDefaults` fills rit/bomb_pot_mode/max_seats so callers can send partial config; call before `Validate`.

## Not touched

- No seed data, no Supabase client in web/ — table listing UI comes with the API ticket.
- Hand `data` jsonb schema unvalidated — engine team owns that shape; store passes raw JSON through.

---

# BUILD NOTES — ASPTR-182: Web lobby + create-table (frontend)


Supersedes the ASPTR-180 note below (kept for server-auth context). All work in `web/` (Vite + solid-ts + bun).

## Stack additions

Tailwind v4 (CSS-first — `@import 'tailwindcss'` + `@tailwindcss/vite` plugin, **no tailwind.config**), `@kobalte/core` (headless a11y primitives), `@solidjs/router`, `@supabase/supabase-js`, `class-variance-authority` + `tailwind-merge` + `clsx`.

## Design system

Tokens as CSS vars in `web/src/index.css` (`--bg #0e1512` felt-green, `--surface`, `--accent #d4af37` gold, `--danger`, `--success`, …), mapped into Tailwind theme via `@theme inline` → utilities like `bg-surface`, `text-accent`. Dialog/select/switch micro-animations in `src/styles/animations.css`.

UI kit in `src/components/ui/` — shadcn-solid style: `Button` (cva variants: default/outline/ghost/danger × sizes), `Dialog` (portal + overlay + animated content), `Input`, `Select` (+ `Field` label wrapper), `Slider`, `Switch` (+ `SwitchRow`).

### Kobalte gotchas (cost real debugging time)

- **Select with object options**: `optionValue="value"` + controlled `value` must be the **option object**, not the string — `onChange` emits the object. Passing a raw string silently selects nothing (`String("100")["value"]` → `"undefined"`). See `ui/Select.tsx`.
- **Switch**: `Switch.Root` is only `role="group"` — the toggle `onClick` lives on `Switch.Control`. Render `HiddenInput`→`Input` + `Control` + `Thumb` or clicking does nothing. Label-wrapped clicks work because the hidden input receives them.

## Pages

- `/` (`pages/Lobby.tsx`): sticky header w/ sign-in, table card grid (name, NLHE/PLO4 badge, blinds `$.XX/$.XX`, avg pot, seat pip bar 0/9, Join; Full state at capacity). Skeleton while loading, empty state, hover lift on cards.
- `/auth` (`pages/Auth.tsx`): email → `signInWithOtp({ email, options: { shouldCreateUser: true } })`, sent-state confirmation, graceful "Sign-in unavailable" card when Supabase env unset. Per ASPTR-180 note: attach access_token to WS as `?token=` later.
- Create-table dialog (`components/CreateTableDialog.tsx`): all config — name, game type, sb/bb (cents), starting stack (updates `$$` hint), action timeout + inter-hand delay sliders w/ live value, RIT select, rabbit hunt switch, bomb pot mode + card-trigger builder (rank picker incl. Any, suit picker incl. any, red/black suits colored), 7-2 switch + per-player bounty. Defaults: 0.10/0.20 NLHE, 100bb, 30s.

## Data layer (`src/lib/`)

- `api.ts`: typed `listTables`/`createTable`/`joinTable` fetch wrappers against `VITE_API_URL`. **Mock mode**: env unset → in-memory fake tables so lobby renders backendless (header shows "mock data" chip).
- `types.ts`: `TableConfig`/`TableSummary` + `DEFAULT_TABLE_CONFIG`.
- `money.ts`: `money(cents)` → `$1.25`, `blinds(sb,bb)`.
- `supabase.ts`: lazy client from `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, null when unset.

## Env vars (web)

| Var | Effect |
|---|---|
| `VITE_API_URL` | unset → mock mode |
| `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | unset → /auth shows config hint |

## Not touched / next

`server/`, `supabase/`, engine. Join is a stub ack — wire to `/table/:id` + WS when table view lands. No tests (pure presentational + mock layer); verified via `tsc -b && vite build` green + browser pass (lobby render, dialog open, select/switch/slider interaction, bomb-pot trigger builder, create → grid update, /auth fallback).

---

# BUILD NOTES — ASPTR-180: Magic-link auth + JWT validation

---

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
## ASPTR-196 — Notion warm-light retheme (web/)

Design source of truth: `DESIGN.md` at repo root. Verified via headless Chrome computed-style probes (canvas #f6f5f4, Inter, card white/rgba(0,0,0,0.08)/12px, primary #0075de, ghost #e6f3fe/#0075de, nav shadow 0.016/0.03 layers, zero shadows on cards/dialog).

### index.css

- `:root` tokens swapped felt-dark → Notion warm-light: `--bg #f6f5f4`, `--surface #fff`, `--surface-raised #f1f0ef` (hover fill), `--border rgba(0,0,0,0.08)` hairline, ink alphas `--text 95% / --text-muted 60% / --text-faint 40%`, `--accent #0075de` (hover `#0a84ec`), `--accent-tint #e6f3fe`, accent cast `--marigold #ffb110 / --coral #f64932 / --sky-wash #62aef0 / --midnight #02093a`, `--danger #e32d14` (vermillion).
- `--success #12805c`: only green in the system, added for form success state (magic-link "Check your inbox"); everything else palette-pure per DESIGN.md.
- Semantic Tailwind color names unchanged (`bg`, `surface`, `line`, `fg`, `fg-muted`, `accent`, `danger`, `success`) + new utilities: `accent-tint`, `fg-faint`, `marigold`, `coral`, `sky-wash`, `midnight`.
- `@theme` adds DESIGN.md type scale as `text-caption … text-display-lg` utilities (with baked line-height + negative letter-spacing at display sizes), radii `rounded-card 12px / rounded-btn 8px / rounded-small 4px / rounded-pill 9999px`.
- `font-sans`/`font-display` both Inter (Sora dropped); Inter loaded via Google Fonts in `web/index.html` (400/500/600/700, display=swap); `font-feature-settings: 'lnum' 1` on body per DESIGN.md.
- `.felt-bg` class deleted (flat canvas from `body` now); `::selection` blue tint; focus ring `#0075de66`.
- `styles/animations.css` card/chip/win-pulse sections untouched (ASPTR-189's ticket); they recolor automatically via `--danger`.

### ui/ kit (APIs unchanged — same props, same variants)

- **Button**: `default` = filled #0075de/white; `ghost` = sky-tint bg + blue text (was transparent-muted; only call site is dialog Cancel — correct per DESIGN.md ghost CTA); **new `text` variant** = transparent/ink-95; `outline` = 1px ink border, 4px radius per DESIGN.md outlined-text spec; `danger` = vermillion. All 200ms ease, no shadows.
- **Dialog**: overlay `bg-black/30`, backdrop-blur removed; content white, hairline, 12px, **no shadow** (elevation purely from overlay).
- **Input/Select**: hairline borders, white bg, `placeholder ink-40%`, hover `border-black/20`, focus blue ring; select menu white/hairline (heavy shadow removed); Field hint text 40%.
- **Slider**: track ink-tint, blue fill, white thumb + blue border.
- **Switch**: unchecked `black/15`, checked solid blue, white thumb.

### Pages

- **Lobby**: canvas bg; sticky nav = white/90 blur + DESIGN.md nav elevation shadow (the one allowed shadow); table cards white/hairline/12px, hover = border darken only (no lift/shadow); gameType badge: PLO4 = marigold pill, NLHE = neutral; **seat pip bar rotates accent cast** (sky-wash → marigold → coral → blue → midnight, empty = black/10). Sign in = outline.
- **Auth**: white hairline panel (no shadow), success icon on sky-tint/blue, code chips on surface-raised.
- **Cards** (/cards, ASPTR-189 demo): chrome only — nav + canvas + section cards light; playground stage felt gradient → sky-tint panel (cards themselves untouched for the other ticket).
- **Table page**: no `/table` route exists in this worktree's `App.tsx` — nothing to do, nothing errors.
- Mock data flows, `CreateTableDialog` logic, all component props untouched.

### Env note

`web/node_modules` was absent in this worktree — `bun install --frozen-lockfile` restored; build (`tsc -b && vite build`) green after. Disk hit 100% mid-session and killed dev servers twice; keep an eye on it.

---

## Cards (ASPTR-195)

`web/src/components/cards/` — rebuilt card visuals, same component API (`Card` rank/suit/size/faceDown, `CardFace`, `CardBack`, `CardRow`, `RANKS`/`SUITS`/`SUIT_COLOR`), so table-ui consumes unchanged.

- **Faces**: cream `#fdf9f0`, 12px radius, hairline `rgba(0,0,0,0.10)`. All art is one SVG per face (`viewBox 0 0 100 140`) in `art.tsx` — scales crisply to any size.
- **Corner indices**: bold rank (font 28, `10` compressed to 17) + suit glyph, ink = suit color darkened to AA-on-cream (`SUIT_INK`: 13.9/5.4/5.9/5.6 :1) + 0.9u stroke/paint-order fattening. Legibility verified at sm (56×80) and 40px-height strips on /cards.
- **Pips**: `PIP_TABLE` in `art.tsx` — explicit per-rank station table, traditional French layouts, bottom-half pips rotated 180°. Geometry verified overlap-free (script-checked across the full 52).
- **Courts**: animal bust portraits in arched panels — K bear w/ crown, Q turtle w/ tiara, J hawk w/ cap. Main fills use `SUIT_INK` (rich), gold (`#d9a441`) + cream accents.
- **Aces**: single large glyph (68% of width) — negative space is the design.
- **Back**: crimson `#a8103f`, gold lattice, cream double frame, center medallion.
- **`RabbitMark`** (`RabbitMark.tsx`): flat rabbit-face mascot for rabbit-hunt toasts.
- **Demo** `/cards`: playground (deal/flip/win/chip), corner-legibility strip (sm + 40px), pip showcase, courts+aces, full deck, sizes/back/rabbit.

Known simplifications: system font stack renders corner ranks (Sora not loaded); Vision-OCR can't grade isolated single glyphs, so corner legibility was verified by pixel inspection + geometry, not OCR.

---

---

# BUILD NOTES — ASPTR-188: Table UI (felt, seats, action bar)

All in `web/`. Reuses ASPTR-189 cards (CardRow/Card) + ASPTR-182 tokens/ui-kit. No new deps.

## Store contract (`src/lib/tableTypes.ts`)

ASPTR-181 builds `stores/table.ts` (ws) in parallel; UI codes against `TableStore`:

- `state: TableState` — seats (stack/bet/fold/lastAction/isWinner), board rows, pot, toAct, deadlineUnixMs, `legal: LegalActions | null` (non-null iff hero to act, mirrors engine's raise-TO fields in cents), hero holeCards rows, street/handNo/message, bombPot/isDoubleBoard.
- `send(PlayerAction)` — fold/check/call/`raise{toCents}` (raise-TO)/reveal/muck/rabbit. Errors surface via `lastError`, never thrown.
- `WireCard` = engine uint8 (rank=c>>2, suit=c&3) + `toUICard()`. UI card types re-exported from `Card` (`UICard = {rank,suit}`), so wire types and CardRow share one Rank/Suit union.

Swap point is one line in `pages/Table.tsx`: `createMockTable(id)` → real store. Interface owns no mock-isms (no `message`-only errors etc.).

## Mock store (`stores/mockTable.ts`)

Scripted 6-max hand as a flat timeline array (`Step[]`: post/holes/street/villain/hero/award/end) walked by a cursor with per-step delays. Hero steps park until `send()` or a 20s timeout (auto check/fold — exercises the timeout path in UI testing). Button rotates per hand; fixed deck (hero AsKs, board Qs Js 4d Ts 2c) so every street + award replays deterministically. Villain turns get `deadlineUnixMs = now + think + 6s` so arcs render on villains too. ponytail: theater, not a betting model — replaced wholesale by ASPTR-181.

## Components (`src/components/table/`)

- **`Seat.tsx`** — nameplate (name, stack `$.XX`, lastAction tag, dealer `D` chip), face-down backs for villains / real `CardRow` for hero, street-bet chip + amount under plate, fold dim, winner border. Active turn: accent border + glow ring (`glow` keyframe) + timer arc = SVG `rect` stroke-dasharray `frac*280` that drains with a single 250ms clock tick shared page-side; stroke flips to `--danger` under 5s.
- **`TableCenter.tsx`** — pot chip stack + `$.XX`, board rows (5 slots each, undelt = dashed placeholder, dealt cards get `animate-deal` stagger 110ms), status line. Double board renders N rows labeled A/B (labels from state).
- **`ActionBar.tsx`** — Fold(F)/Check-Call(C)/Raise-to(R) + presets + slider + typed input. Presets from pure `lib/betting.ts`: preflop unopened 2.5/3.5bb + All-in; vs raise 3x their raise-to + All-in; postflop 33/50/75/100% of pot-after-call + All-in (out-of-range dropped, min/max shown). Arrow keys step bb (preflop) / 10% pot (postflop), shift = 2×. Enter commits raise (or primary action), Esc cancels raise mode. Typed amounts parsed by `parseBetToCents` ("2.5"/"$2.50"→cents, >2 decimals rejected). Slider = Kobalte (note: `minValue`/`maxValue`, not `min`/`max`).

## Page (`pages/Table.tsx`, route `/table/:id`)

Rail: padded wood-gradient ellipse (`rounded-[50%]`) + radial-gradient felt (#1f6f4a→#0b3625) + repeating-linear-gradient texture at 5% opacity + inner white/10 ring. Seats positioned by fraction lookup `SEAT_POS[2..9]` (absolute % on the felt box, `-translate-x-1/2`). Header: lobby link, name, game badge, blinds, hand #/street (+BOMB POT). Footer: ActionBar. `ChipFly` — 6 chips from center to winner seat on `isWinner` (measures felt box at mount, sets `--chip-x/y`). No viewport overflow at 1190×713 or 390×844.

## Verification

- `bun src/lib/betting.check.ts` — assert-based checks: preset math (2.5bb→$0.50, 3x vs $0.60→$1.80, pot-% incl. facing-bet base), step sizes, typed parsing (all green). Excluded from tsc (node `process` in exit path).
- `tsc -b && vite build` green (236kB js / 76kB gz).
- chrome-devtools on dev server: full scripted hand observed — blinds post, hole cards render face-up for hero, villains act with labels + thinking arcs, flop/turn/river deal with stagger + dashed slots, presets switch preflop→postflop correctly, `C` calls (hero label updates), arrow+Enter raises, 20s timeout auto-folded hero and hand ran out, award fires 6 `chip-fly` chips + winner glow (in-page 250ms poller caught the 2s window), timer arc drained 280→2 dash with `--danger` at <5s, zero console errors (fixed form-field warning via `name` attr on raise input).

## Not touched / next

- Real ws store (ASPTR-181) — swap-in point above; store contract frozen unless that ticket needs a field.
- Side-pot display, reveal/muck/rabbit UI hooks exist in types but no controls (engine pauses only when those features are on).
- `win` glow on winning 5 cards at showdown — state lacks per-card win flags; add when engine events land.

---

# BUILD NOTES — ASPTR-181: WebSocket gateway + client store

Server `server/` + frontend `web/`. New dep: `github.com/coder/websocket` (Go). Zero frontend deps added.

## Server layout

- **`internal/ws/ws.go`** — connection pumps only. `Upgrade(w,r,userID,onMsg,onClose)`: read pump JSON-decodes `ClientMsg` → injected handler; write pump drains a 64-msg buffered chan. `TrySend` never blocks: full buffer = message dropped (slow client degrades, not killed). `shutdown` guarded by mutex + closed flag — **send chan is never closed**; closing it raced in-flight broadcasts (found in e2e: `panic: send on closed channel`). `NewTestClient`/`RecvMsgs` test hooks.
- **`internal/protocol/wire.go`** — wire types: `ClientMsg` (join{seat,name} | leave | action{kind fold/check/call/bet, amount raise-TO} | chat | rabbit{reveal?}), `ServerMsg` (state | event | seats | action_required | post_hand | chat | error), `TableState` snapshot, `SeatWire`, `ConfigWire`, `PostHandPrompt`. Mirrors engine types via `protocol/event.go` aliases.
- **`internal/table/`** — actor-per-table: ONE goroutine owns all mutable state (seats, runner, timers); everything else talks through the buffered inbox chan. `table.go` dispatch, `hands.go` hand lifecycle + events + redaction + timeouts, `view.go` snapshots/seat wire, `manager.go` lazy table registry from store rows.
  - Hand start: ≥2 seated → 3s delay (fills) → engine `StartHand`. Next hand after `InterHandDelaySecs`. Button rotates to next occupied seat.
  - Events: `hand_started` broadcast to ALL; private `holes_dealt` per seat via `HolesFor` (engine accessor added — transport owns private delivery, engine events are public-only). `showdown` hole reveals are public by design.
  - Timeout: timer per turn → auto check when free, else fold. Post-hand prompt (7-2 reveal / rabbit) also times out → muck/skip.
  - Reconnect: same userID on upgrade re-adopts the seat + gets full snapshot (own holes via `lastHoles`, board, pot, legal actions if on turn).
  - Persist: `hand_ended` → `{hand_no, events[], stacks}` jsonb → `store.InsertHand` (nil store = dev no-op).
  - Illegal actions: error to actor, state unchanged. Chat ≤500 chars, broadcast with seat/name.
- **`cmd/server/main.go`** — `POST /api/tables` (auth, store.CreateTable), `GET /api/tables`, `GET /api/tables/{id}`, `GET /api/tables/{id}/ws` (auth via `?token=` — auth.Middleware already reads query param; upgrade → table Attach). Env: PORT, SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL.

## Engine additions

`HolesFor(seat)`, `Board()`, `Pot()` read accessors — transport snapshot/private-delivery needs. No semantic changes.

## Frontend

- **`src/lib/protocol.ts`** — mirrored wire types (tagged unions), `Card = number` + `cardRank/cardSuit` helpers.
- **`src/lib/ws.ts`** — `TableSocket`: typed send/receive, auto-reconnect exp backoff (500ms·2^n cap 30s + jitter), token rides `?token=`.
- **`src/stores/table.ts`** — solid signals store: `state/seats/board/pot/myCards/toAct/deadline/postHand/chat/events/status/error`. Reducer folds server msgs: state snapshot resets view; events increment (`street_dealt` appends board, `hand_ended` syncs stacks, `holes_dealt` only honors own-seat delivery).
- **`src/pages/Table.tsx`** — `/table/:id`: pot + board, seat grid w/ dealer button + last action, your-cards + action bar (fold/check/call X/raise-to min), seat picker, post-hand reveal/muck/rabbit, rolling event log, connection status chip. Mock mode → hint card (no backend). Lobby Join → `navigate(/table/:id)`; dead `joinTable` REST stub left for seatsFilled later.
- `erasableSyntaxOnly` tsconfig: no constructor parameter-properties — explicit field assignment in `TableSocket`.

## Tests

- `internal/table/table_test.go` — broadcast (chat + seat join reach all), redaction (B gets only seat-1 holes_dealt, A only seat-0; snapshot YourCards per viewer), timeout auto-action (fold HU ends hand uncontested; free-check times out to check not fold).
- `internal/ws/e2e_test.go` — real websocket dial ×2 over httptest, fake auth middleware: both join, hand auto-starts, holes arrive, B receiving wrong seat's holes fails the test. Dedicated reader goroutine per conn (sequential interleaved polling starved one side — false negative).
- `go test ./...` green; `tsc -b` + `vite build` green (212.6K js / 34.0K css).

## Known gaps (next)

- `joinTable` REST stub unused; lobby `seatsFilled` not live (needs REST read of table actor state or lobby WS).
- Timeout auto-action legality edge: timeout fires for stale seat if action changed exactly at deadline — guarded by `la.Seat != timeoutSeat` check, benign.
- Post-hand prompt approximates bounty/rabbit offer from config (engine doesn't expose which is pending); worst case client sees an offer the engine won't act on → illegal-action error. Acceptable for friends-table v1.
- Reconnect mid-hand gets snapshot but not the hand's event history (board/pot only). Fine for v1.
- Dead conn detection is write-failure based; no app-level ping. coder/websocket pings from client side suffice.


---

# BUILD_NOTES — ASPTR-199: Wire WS store into table UI (mock → live)

Server `server/` + frontend `web/`. New dep: none. Goal met: a real hand played end-to-end in two Orca browser tabs (blinds → flop → showdown → pot awarded), recorded below.

## Run it (no Supabase, no Postgres)

```bash
cd server && DEV_AUTH=1 go run ./cmd/server        # :8080, in-memory dev table
cd web && VITE_API_URL=http://localhost:8080 bun run dev   # :5173
# tab 1: http://localhost:5173/table/dev-table?dev=alice@dev.local
# tab 2: http://localhost:5173/table/dev-table?dev=bob@dev.local
```
Both tabs auto-join the first open seat; hand starts 3s after 2 seated. Dev table: NLHE 10/20, 200bb, 120s action clock, RIT always, rabbit hunt on, 7-2 bounty $1, bomb-pot trigger = queens.

## Server

- **DEV_AUTH=1** (`auth/dev.go` + test): `?token=dev:<email>` bypasses JWT, mints deterministic uuid-shaped uid (sha256). Off by default (`EnableDevAuth` only when env set); non-`dev:` tokens unaffected.
- **No-DB dev mode** (`cmd/server/main.go`): with DEV_AUTH=1 and no DATABASE_URL, one fixed in-memory table `dev-table` serves list/get/ws; POST /tables → 503. Permissive CORS for the vite dev origin (auth stays token-gated).
- **`ws.Upgrade`**: allow `localhost:*`/`127.0.0.1:*` origins (vite dev is cross-origin; token still gates).
- **Card wire format fix** (`engine/card.go`): `Card` had custom `MarshalJSON`/`UnmarshalJSON` added — `[]Card` was base64-encoding as `[]byte` (`"CSs="`), breaking every JS card renderer. Now plain numbers. Go-side tests unaffected.
- **Engine bug — premature RIT clone** (`betting.go`): `beginRunoutIfNeeded` announced all-in runouts + cloned boards on every street close even when postflop betting was still possible → HU RIT tables played every hand on two boards. Now gated on `canActCount() < 2`. Regression test `TestRITNotClonedWhileBettingPossible`.
- **Engine accessor** `PendingPostHand() (reveal, rabbit)` — `Done()` is true during the 7-2 reveal/rabbit pause, which made `postHandOffered` always bail (prompts never sent). Transport now keys prompts off this; prompt no longer guesses which decision is pending.
- **Table actor**:
  - `__attach` sends a snapshot immediately (spectators render; reconnect re-adopts seat without a join msg).
  - Seat view derived from events in `publishEvents` (street bets from blinds/antes/call/raise-TO, folds, winner flags) + one `seats` frame per batch; `syncSeats` moved before broadcast so award stacks ship in the same frame (was clobbering `hand_ended` stacks client-side).
  - `join` uses client-provided `name` (sanitized, ≤24 runes) instead of `player-<uid6>`.
  - Deadline tracked when the timeout timer arms (`deadlineMs()` used to always return 0).
  - `NewManager(*store.Store)` takes the concrete type — nil store no longer becomes a typed-nil `Persister` (panicked on first `InsertHand`).
  - Removed double `afterAdvance` after reveal/muck/rabbit (double persist + double next-hand timer).
- **Bomb-pot trigger fix**: `handEnded` nils the runner before `startHand` could match triggers against it → triggers could never fire. Now `lastDealt` snapshot kept on the table, consumed by the next startHand only.
- `engineConfig` now wires `SevenDeuce{Enabled,Amount}` (NLHE tables only) and `BombPotTriggers` → `engine.CardTrigger` (store ranks 2-14 → engine 0-12).
- Ops logs: `pot_awarded`/`hand_ended` (stacks + conservation sum) per hand.

## Frontend

- **Types unified** (`lib/protocol.ts` = single source): wire types (`TableSnapshot`, `LegalActionsWire` renamed to free the UI names) + UI facade types (`TableState`, `SeatState`, `LegalActions`, `PlayerAction`, `TableStore`, `toUICard`/`uiSeat`/`uiLegal`/`cardText`). `lib/tableTypes.ts` = one-line re-export so component imports stay put.
- **`stores/table.ts` rewritten** as the TableStore facade over ws: snapshot/seats frames rebuild state; events fold into seats/board/pot/turn (street text, last-action labels, showdown reveals, winner flags, bomb-pot flag, post-hand prompt). Server `seats` frames are authoritative for stacks/bets/folds — no client-side chip arithmetic (that raced and desynced).
- Identity (`lib/identity.ts`): supabase session first, else per-tab `?dev=<email>` → `dev:` token (server DEV_AUTH gates). api.ts attaches the token to REST too (lobby works against the live server).
- Join-on-mount with identity; spectator (`heroSeat -1`) otherwise; empty seats render clickable "sit here". `seat taken` error resets the join latch → next open seat retried.
- `send`: raise→`{kind:'bet',amount}` (raise-TO), reveal/muck/rabbit→`{type:'rabbit',reveal?}`.
- Turn clock: `turnTimeoutMs` from snapshot config (arc math no longer hardcodes 20s); deadline from `turn_changed`.
- Toasts (7-2 bounty, etc.) surfaced via `store.toasts`, rendered top-center on the table page.
- Post-hand prompt bar in ActionBar idle state: Show 7-2 / Muck / Rabbit hunt / Skip (verified live — rabbit hunt clicked, engine advanced).
- Seat.tsx: villains' showdown reveals render face-up (`SeatState.revealedCards`); empty-seat join button.
- ActionBar: `potTotal` = `potCents` (facade contract: pot includes street bets — server pot already does).
- ws.ts: malformed/handler-throwing frames now `console.error` (was silent — hid the base64 bug).
- Mock mode: `mockTable.ts` → `demoTable.ts`, `createMockTable` → `createDemoTable`; chosen in Table.tsx by `VITE_API_URL` unset.

## The recorded hand (two Orca tabs, dev table)

alice (seat 0) vs bob (seat 1), blinds 0.10/0.20, stacks 40.00 each:

- Preflop: alice (SB/button) calls $0.10; bob (BB) checks.
- Flop 10♥ 10♠ 3♦: check, check. Turn A♥: check, check. River 2♠: check, check.
- Showdown: alice 2♣8♣ (tens and twos) beats bob Q♥9♥ (pair of tens); villain cards revealed face-up on both tabs.
- Pot $0.40 awarded to alice; stacks 40.20/39.80 in both tabs; chip conservation asserted server-side (`hand_ended sum=8000`).

Also observed live: uncontested timeout-fold wins, post-hand rabbit prompt honored, turn-clock arcs + timeout auto-actions, per-street status lines.

## Verification

`go test ./...` 105 passed (incl. new: dev-token bypass ×2, trigger wiring, RIT no-clone regression). `tsc -b && vite build` green (247.8kB js / 8.5kB css gz). `bun src/lib/betting.check.ts` green. Live two-tab hand as above; award/hand_ended logs reconcile to the cent.

## Known gaps / TODO (deliberate, not regressions)

- **TODO: bomb-pot trigger live demo.** Trigger path fixed (lastDealt) + unit-tested, but a live bomb-pot hand (banner + double board + antes) wasn't captured before landing — earlier double-board observation predates the fix. Verify on next session: queens appear in ~most hands, so a bomb pot should fire within a few deals.
- **TODO: 7-2 bounty toast not yet observed live** (needs a winner holding exact 7+2). Store wiring + engine emission are covered by engine tests; watch for the toast on a lucky hand.
- Reconnect mid-hand: snapshot lacks current street bets (wire carries them but server can't know pre-join); stacks/pot/board correct.
- Lobby `TableSummary` mapping from store rows is shallow (`seatsFilled` always 0 against the live API).
- Inter-hand delay + 120s action clock make idle hands slow; dev table config is intentionally forgiving.
- Straddle, multiway RIT, side-pot display: unchanged known gaps from earlier tickets.

---

# BUILD_NOTES — ASPTR-185/186/187: Bomb pots, 7-2 bounty, RIT + rabbit UI, deal animations

All in `web/` + transport-layer `server/` (engine untouched except two additive helpers). New dep: none.

## Deal animations (user-reported bugs)

- **Board re-deal fixed.** Root cause: `TableCenter` looped a fixed 5-slot `Array.from({length:5})` through Solid `<For>` — undefined slots can't be keyed, so every street remounted all wrappers and `animate-deal` replayed. Rework: `<For each={cards}>` (keyed by card object identity; store appends, never rebuilds) + placeholder divs appended after, and outer board rows via `<Index>` (position-keyed) because `<For>` remounts rows on every new row-array identity. Proven in-browser: `data-probe` tags set on the 3 flop wrappers survive turn+river (3/3), only new cards mount.
- **Opening deal sequence.** On `hand_started` the store choreographs client-side theater: one card per dealt-in seat, clockwise from left of the button (engine's deal order), `dealTotal` rounds (2 NLHE / 4 bomb pot), 170ms per card + 260ms per round gap ≈ 2.5s at 6-max. Cards fly from the felt-center deck via new `deal-seat` keyframe (`--deal-dx/--deal-dy` = seat offset from center, measured once in `Table.tsx`). Villains accumulate face-down `Card` backs; hero's real hole cards mount face-down and flip face-up as the following beat lands (final flip on a `dealDone` tick). Reconnect snapshots pre-fill `dealt` and set `dealDone` (no theater). Seat selection reads occupancy (occupied + stacked + not sitting out), not `inHand` flags — the seats frame trails the event batch.

## Chip stacks

- `ChipStack.tsx` — flat accent-hue chips (`#0075de`, marigold, coral, sky-wash, midnight — DESIGN.md accent cast), count = `1+floor(log2(stack/unit))` capped 8 (seats, 12 pot). Seats: tower left of the nameplate; pot pill: horizontal stack that grows as bets come in (was a static 3-chip image).

## Bomb pot (ASPTR-185)

- New event `bomb_pot_armed` (engine const added, emitted by the table layer): trigger match in `handEnded` (first matching dealt card rides in `cards`) or manual arm. Client stores `bombPotArmed: UICard | true | null` — persistent gold banner "NEXT HAND: DOUBLE BOARD PLO BOMB POT" with the trigger card rendered when trigger-driven; cleared on `hand_started`; red live banner "DOUBLE BOARD PLO BOMB POT" while the bomb-pot hand runs.
- Manual arm: `ClientMsg{type:"bomb_pot"}` → `forceBombPot`, consumed by next `startHand`. Exposed as "Arm bomb pot next hand" in the settings drawer when `bomb_pot_mode=manual`.
- Double-board UI: labels `board A/B` (bomb pot) vs `Run 1/Run 2` (RIT) — from `bombPot`, not board count; ½-pot indicator per row; per-board win ring (`boardWins` from `pot_awarded[].board_index` + `animate-board-win`).
- Reconnect gap fixed: snapshot now carries `bomb_pot` (live) — `t.bombPot` tracked on the table; without it a mid-bomb-pot joiner mislabeled boards "Run 1/2" and lost the banner.
- Server: `LoadedDeck(order)` + exported `StartHandWithDeck` (engine, additive; order served first, shuffled remainder) power dev-only forced deals.

## 7-2 bounty (ASPTR-186)

- `seven_deuce_bounty` → gold toast (marigold border/glow, `toast-gold` pop, 6s): "NAME wins $1.00 bounty w/ 7-2!". Stacks arrive via the existing seats frame. Showdown reveal unchanged (winner's 7-2 shows on all tabs). Observed live both ways: a natural bounty for bob and the forced-deal path for alice.

## RIT + rabbit (ASPTR-187)

- RIT: runout boards auto-label Run 1/Run 2 with ½-pot each; per-board win rings; per-board award messages ("bob wins $0.20 — flush run 2"). Staggered reveal falls out of per-board `street_dealt` ordering + card-identity animation.
- Rabbit: `rabbit_hunt` cards appended flagged `rabbit:true`, rendered dimmed (opacity .55), tilted (-6deg), desaturated; mascot toast (RabbitMark) "Rabbit hunt: 10♦ 8♣ 9♦ 6♥ K♦".

## Timeout default 15s

- `store.TableConfig.ApplyDefaults`: 0 → 15 (validation still 5-300). `DEFAULT_TABLE_CONFIG.actionTimeoutSec` 30 → 15; dialog slider widened to 5-300 step 5; dialog copy "30s action clock" → "15s".

## Settings drawer

- `SettingsDrawer.tsx` — read-only slide-over from a header gear: game, blinds, action timeout, inter-hand delay, RIT, rabbit, 7-2 (+bounty), bomb-pot mode + trigger chips. `ConfigWire` extended (`rit`, `rabbit_hunt`, `seven_deuce`, `seven_deuce_bounty`, `bomb_pot_mode`, `bomb_pot_triggers`, `inter_hand_delay_s`).

## Dev tooling (DEV_AUTH-gated)

- `ClientMsg{type:"dev_deal", seat, cards}` → `t.devDeals` consumed next `startHand` via `loadedDeck` (round-major over seat-sorted players, random unused fill). Rejected on non-dev tables. URL hook: `?deal=7d2d` (parseDealParam) resends every hand start. Verified: seat shows 7♦2♦ every hand.
- No-DB dev mode now supports the full create flow: `POST /api/tables` writes an in-memory registry (`dev-<hex>` ids), GET list/get/WS all serve it (shared `devRowByID`). CreateTableDialog → live server works end-to-end (its JSON body needed a mapper: UI camelCase → store snake_case, ranks 2-14; `bomb_pot_mode` every_hand → manual).

## Other fixes found on the way

- **ActionBar slider echo** (Kobalte): slider `onChange` re-emitted the current value on re-render, instantly reverting preset clicks to the old amount — every "All-in" preset silently degraded to min-raise. Guarded: ignore echoes equal to `raiseTo()`.
- Lobby `joinTable` REST stub 404'd and blocked `navigate()` — removed; `?dev=` is now preserved into `/table/:id`.
- `handEnded` leaves `streetBet` stale on the server seat view (showed a ghost $0.10 bet between hands) — cosmetic, noted, not fixed (seats frame overwrites on next hand start).
- api.ts REST paths were missing the `/api` prefix (ws had it) — lobby list/create 404'd against the live server.

## E2E (mandatory pass)

`DEV_AUTH=1 go run ./cmd/server` + `VITE_API_URL=http://localhost:8080 bun run dev`. Two browser tabs (`?dev=alice@dev.local&deal=7d2d`, `?dev=bob@dev.local`), table created via the dialog path: NLHE 10/20, 100bb, RIT always, rabbit on, 7-2 $1, bomb pot manual, 15s default verified in the dialog. Second controlled table at 300s/60s for scripted play. Notes: mid-run the Orca embedded browser dropped (runtime stuck "starting") — finished in Chrome via chrome-devtools; same URLs/flows.

- **Deal sequence:** on `hand_started`, backs fly center→seat one per beat (caught cards mid-flight at the deck origin in DOM probes), hero's pair lands face-down then flips; villain board accumulating correct.
- **Board:** flop 3 animate, turn/river append — flop DOM nodes survive (identity check), no re-animation.
- **Normal hand:** call/check/check/check/check → showdown; winner glow, pot chips fly.
- **7-2:** alice (`?deal=7d2d`) wins uncontested (bob folds SB) → prompt "Show 7-2 (take bounty)" → gold marigold toast "…wins $1.00 bounty w/ 7-2!", stacks +$1.00; then rabbit prompt → board completes face-up dimmed/tilted + rabbit toast. A natural bob 7-2 bounty also observed.
- **RIT:** alice jams (All-in preset → commit), bob calls → all-in runout on two boards labeled RUN 1 / RUN 2, ½ $20.00 each, both rings lit, split: "alice wins $1.90 — pair run 2" (server log: 4 pot_awarded = 2 pots × 2 boards, chips conserved).
- **Bomb pot (manual arm):** drawer → "Arm bomb pot next hand" → persistent NEXT HAND banner on both tabs (trigger-card slot verified separately) → next hand: both ante (pot $0.40, "Ante" labels), 4 hole cards each dealt in 4 beats, flop immediately on BOARD A + BOARD B with ½ $0.20 labels, no preflop betting, check-check to showdown → both rows ring, "bob wins $0.20 — two_pair board B", live red banner during the hand.
- **Settings drawer:** shows the exact live config (blinds, 120s/300s clocks, RIT always, rabbit on, 7-2 $1.00, bomb pot manual) + arm button in manual mode.
- **Cards:** merged modern-minimal design (giant corner rank + center motif) renders on table seats, boards, and /cards demo — no page builds its own card SVGs.
- Console: 0 errors on both tabs. `tsc -b && vite build` green (249kB js / 9kB css gz), `go test ./...` green (incl. new LoadedDeck/forced-deal/arm-broadcast/dev-gate tests), `betting.check.ts` green.

## Known gaps (deliberate)

- Deal sequence is client theater: a spectator joining between `hand_started` and their snapshot sees pre-filled backs (no animation) — correct, just not animated.
- Chip tower scale is bb-relative log; absolute-blind changes between tables with tiny stacks can show equal towers (capped at 8).
- Bomb-pot trigger banner needs a trigger match (server-side); manual arm covers deterministic demos. `bomb_pot_next` in a snapshot carries no card (banner without card) until the armed event arrives.
- Trigger-mode live demo still not captured (dev-table queens are chance-based); manual path fully verified. Trigger wiring is unit-tested.
- Post-hand prompt approximations from ASPTR-199 (winner-seat inference) unchanged.

---

# BUILD_NOTES — ASPTR-190: Hand history + viewer

Server `server/` + frontend `web/`. New deps: none. Goal met: played two hands (one bomb pot) live, opened the drawer, expanded both, verified every line against the persisted jsonb.

## Server

- **`GET /api/tables/{id}/hands?limit=50`** (`cmd/server/main.go`): store.ListHands (newest first) behind the usual auth middleware; `limit` clamped 1–200, default 50. No-DB dev mode serves from a new in-memory `memHands` (same package, satisfies `table.Persister` + `ListHands`) so hand history works backendless; unknown table → 404, non-dev no-DB → 503. Empty result serializes as `[]` not null.
- **`NewManager(persist Persister)`** signature change (was `*store.Store`): main.go now wires store / memHands / nil explicitly. Existing `NewManager(nil)` test call sites unchanged.
- **Persistence shape fixed + enriched** (`internal/table/hands.go` persistHand) — the web viewer documents/consumes this: `hand_no, bomb_pot, button, start_stacks [{seat,player,stack}], holes [{seat,cards}] (all revealed — history), events [engine events], stacks (final)`. `handStart` captured in startHand; holes built from `runner.HolesFor` at persist time (public events never carry private cards).
- **Bug: handEvents never reset.** Every hand's jsonb contained all prior hands' events (engine hand_ids 1..N mixed in one row). Fixed: `t.handEvents = nil` in startHand.
- **Bug: double persist on post-hand prompt.** persistHand ran again after the 7-2/rabbit prompt resolved → duplicate rows. Fixed: `persistedNo` guard.
- **Bug: engine `Action` marshaled as `{"Seat":0,"Kind":2}`** (no json tags, bare int kind) — broke any consumer reading `action.kind`. Now `{"seat":0,"kind":"call"}` via tags + `ActionKind.MarshalJSON`/`UnmarshalJSON` (string name, full round-trip). This also fixes the live table UI's per-action street labels, which silently never matched (`e.action?.kind === 'raise'`). Found because `TestTimeoutAutoCheck` went 10/10-fail: the test's drain helper ignores json errors, so string kind + missing Unmarshal decoded partial Action with Kind=0 (fold). Symmetric marshal/unmarshal is the fix, not test leniency.

## Web (`web/src`)

- **`lib/history.ts`** — types over the persisted jsonb (`HandRow` = store.Hand with Go field names) + all review derivation client-side: per-street action log (blinds w/ SB/BB, antes, folds/checks/calls/raise-to, all-in runout marker), board rows keyed by `board_index` (labeled BOARD A/B for bomb pot, Run 1/2 for RIT), pot awards (winner, amount, hand name prettified `full_house`→"full house", board label), 7-2 bounty lines, rabbit cards, list-row totals (pot = Σ award amounts, winners aggregated by seat).
- **`components/table/HistoryDrawer.tsx`** — slide-over like SettingsDrawer from a new header clock icon (`?` title="Hand history"). Fetch on open via `api.fetchHands` (token attached by req()). Four states: loading / error ("History unavailable" + 503 no-database hint) / empty ("No hands yet") / list. Rows: `#no · $pot · winners · time`, click to expand full review; expanded content per ticket: seats w/ starting stacks, hole cards all revealed (existing `Card size="sm"`), boards, per-street action, result. Two-line hole-card layout so 4 bomb-pot cards fit the drawer.
- **`lib/api.ts`**: `fetchHands(tableId, limit=50)`; MOCK_MODE returns `[]` (empty-state demo).

## E2E (mandatory pass)

`DEV_AUTH=1 go run ./cmd/server` + `VITE_API_URL=http://localhost:8080 bun run dev`. Table via curl: NLHE 10/20, 100bb, 60s clock, rabbit on, 7-2 $1, bomb pot manual. Players: two headless bun WS clients (same join/action/post-hand protocol as the UI — see note below) + one Chrome tab as spectator for the drawer.

- **Hand 1 (normal):** SB call, BB check, check-check ×3 streets → showdown; carol2 wins $0.40 — flush (A♣ high, board 3♣6♣10♥10♣4♣). Drawer row: `#1 $0.40 carol2 10:38 PM` ✓. Expanded: starting stacks $20.00 both, holes A♣2♦ / Q♥4♦, PREFLOP posts SB $0.10/posts BB $0.20/calls $0.10/checks, FLOP/TURN/RIVER check pairs, RESULT "carol2 wins $0.40 — flush" — all matching REST jsonb.
- **Hand 2 (bomb pot, manual arm):** both ante $0.20, 4 hole cards each, double flop immediately, check-down → dave2 trips nines (board A) + full house QQQ77 (board B), $0.20 each. Row: `#2 $0.40 dave2` (pot = Σ both awards). Expanded: "HOLE CARDS (BOMB POT — 4 EACH)", BOARD A / BOARD B rows with full runouts, antes line, per-street checks, "dave2 wins $0.20 — trips (board A)" + "full house (board B)". Hand names/board labels verified against `pot_awarded` winners (board_cards + hand_name) — engine legit (9♠ was dave2's clipped 4th card before the layout fix).
- **Empty state:** dev-table (no hands) → "No hands yet" card against a live backend.
- **Error state:** server stopped → "History unavailable — Failed to fetch"; the 503 no-database path renders the dedicated hint.
- Console: 0 errors/warnings. `go vet` + `go test ./...` green (111). `tsc -b && vite build` green (258.6kB js / 9.1kB css gz).

## Deviation note

Two Orca-browser tabs throttled hard when backgrounded (ws reconnect loop every ~15s, missed action windows, hands timeout-folded — same failure ASPTR-187 hit). Action-driving moved to the headless WS bot; the history UI itself was verified visually in Chrome via chrome-devtools (screenshots + DOM probes). Ghost seats from closed tabs stay seated until the server restarts (in-memory dev mode) — cosmetic, dev-only.

## Known gaps / TODO

- Post-hand prompt actions (show 7-2/muck/rabbit) are persisted as events, but the drawer doesn't render a dedicated "mucked" marker — showdown section relies on pot_awarded/showdown events only.
- `memHands` is per-process: server restart wipes dev hand history (by design; real history needs DATABASE_URL).
- List rows cap at limit=50 with no pagination/load-more.
