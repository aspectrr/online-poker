# online-poker

Friends-only play-money poker. Replaces PokerNow for the home game.

- `web/` — SolidJS + TS + Tailwind + vite (`bun dev`)
- `server/` — Go, stdlib http + coder/websocket (`go run ./cmd/server`)
- `supabase/` — migrations + config. Local: `supabase start` (studio at localhost:54323)

Money is int64 cents everywhere. Server is authoritative; clients send intents.
Linear: project 🃏 Online Poker, team ASPTR. PM = pi agent.
