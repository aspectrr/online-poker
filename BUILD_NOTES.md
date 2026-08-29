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
