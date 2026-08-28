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
