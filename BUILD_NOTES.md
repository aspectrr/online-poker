# BUILD NOTES — ASPTR-180: Magic-link auth + JWT validation

## How auth works

1. Web client calls Supabase `signInWithOtp` (magic link). User clicks the link, Supabase issues a signed RS256 JWT (access token) with `sub` = user id.
2. Go server validates the JWT against Supabase's JWKS (`SUPABASE_URL/auth/v1/.well-known/jwks.json`), checking signature, issuer (`SUPABASE_URL/auth/v1`), audience (`SUPABASE_ANON_KEY`), and expiry. Keys are cached in memory (refreshed at most once/min, re-fetched on unknown `kid`).
3. `auth.Validator.Middleware(h)` guards HTTP routes. Token comes from `Authorization: Bearer <jwt>` or `?token=` (WebSocket handshake — browsers can't set WS headers). Handlers read the user id via `auth.UserID(ctx)`.
4. Profile rows live in `public.users` (migration `supabase/migrations/0001_init.sql`), keyed to `auth.users`. RLS: authenticated can read; only the service role (server, via PostgREST/service connection) writes.

Package: `server/internal/auth` — `auth.New(supabaseURL, anonKey)` → `*Validator` with `.Middleware(h http.Handler)` and `.Validate(token) (uid, err)`.

## Env vars

| Var | Local dev value | Use |
|---|---|---|
| `SUPABASE_URL` | `http://localhost:54321` | JWKS fetch, issuer check |
| `SUPABASE_ANON_KEY` | from `supabase status` | audience check |

Server reads them at startup (`auth.New`); missing/invalid URL fails fast.

## Local flow

See `server/README.md`. Short version: `supabase start`, POST `/auth/v1/otp`, pick up the magic link from Studio's auth inbox (localhost:54323/auth/inbox), extract access_token, call server with Bearer header.

## Tests

`server/internal/auth/auth_test.go` — mock JWKS via `httptest` + locally generated RSA key. Covers: valid token, forged signature, wrong audience/issuer, expired, missing, header vs query param, context helper.

## Not touched

`engine/` (owned by another agent), `web/` beyond this note: web should use `supabase-js signInWithOtp({ email, options: { shouldCreateUser: true } })` and attach the session access_token to WS connects as `?token=`.
