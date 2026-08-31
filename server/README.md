# server

Go backend. Stdlib http; `internal/auth` validates Supabase JWTs.

## Auth (local dev flow)

1. `supabase start` — runs Postgres, GoTrue (auth), Studio.
   Migrations in `../supabase/migrations` apply automatically.
2. Send a magic link:
   ```sh
   curl -s -X POST 'http://localhost:54321/auth/v1/otp' \
     -H 'apikey: <SUPABASE_ANON_KEY>' \
     -H 'Content-Type: application/json' \
     -d '{"email":"you@example.com","create_user":true}'
   ```
   With no SMTP configured, local Supabase doesn't deliver mail — the inbox is in Studio:
   **localhost:54323/auth/inbox** → click the token URL.
3. From the link, grab the `access_token` (it appears in the redirect/URL fragment; local links look like `http://localhost:54321/auth/v1/verify?token=...&type=magiclink&redirect_to=...`). Follow it once to consume it, then use the session's JWT.
4. Call the Go server:
   ```sh
   curl -s 'http://localhost:8080/<route>' \
     -H "Authorization: Bearer <access_token>"
   ```
   For WebSockets: `ws://localhost:8080/ws?token=<access_token>`.

Keys/env (see `../BUILD_NOTES.md`): `SUPABASE_URL` (e.g. `http://localhost:54321`), `SUPABASE_ANON_KEY` — printed by `supabase status`.

## Tests

```sh
cd server && go test ./...
```
