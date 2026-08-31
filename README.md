# online-poker

Friends-only play-money poker. Replaces PokerNow for the home game.

- `web/` — SolidJS + TS + Tailwind + vite (`bun dev`)
- `server/` — Go, stdlib http + coder/websocket (`go run ./cmd/server`)
- `supabase/` — migrations + config. Local: `supabase start` (studio at localhost:54323)

Money is int64 cents everywhere. Server is authoritative; clients send intents.
Linear: project 🃏 Online Poker, team ASPTR. PM = pi agent.

## Checks

CI (`.github/workflows/ci.yml`) runs on every PR; `main` requires both `server`
and `web` checks green before merge:

- **server** — gofmt, `go vet`, build, `go test`, `docker build` (the image fly deploys)
- **web** — oxfmt format check, oxlint, `tsc` typecheck, `bun run check` (betting self-check), production build

Pre-commit runs the same checks locally:

```sh
git config core.hooksPath .githooks
```

Web lint = `oxlint` (`.oxlintrc.json`; correctness + suspicious + jsx-a11y; the react
plugin is off — its rules assume React semantics and misfire on Solid). Web format =
`oxfmt` (`bun run fmt` to write, `bun run fmt:check` to verify).
