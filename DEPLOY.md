# Deploy — online-poker

Three pieces: **Fly** (Go API + WS, `server/`), **Render** (static SPA, `web/`), **Supabase** (Postgres + auth).

## Current state

| Piece | Status |
|---|---|
| Fly `online-poker-server` | **Live** — https://online-poker-server.fly.dev/healthz → `ok`. Secrets are placeholders until Supabase exists. |
| Supabase prod | **Blocked** — org is at its 2-free-projects limit (see below). |
| Render web | **Not created** — needs dashboard clicks (blueprint file ready at `web/render.yaml`). |

## 1. Fly (API server)

- Config: `server/fly.toml` (app `online-poker-server`, region `iad`), image: `server/Dockerfile` (Go multi-stage → distroless, HEALTHCHECK via `server -healthcheck`).
- Deploy: `cd server && fly deploy`
- Machine sleeps when idle (`auto_stop_machines = "stop"`, `min_machines_running = 0`) and wakes on request — fine for a friends game; WS connections keep it up while anyone is seated. First request after idle has a few seconds of cold start.

### Secrets — fill these in

```
fly secrets set --app online-poker-server \
  SUPABASE_URL="https://<project-ref>.supabase.co" \
  SUPABASE_ANON_KEY="<Settings → API → anon public>" \
  DATABASE_URL="postgresql://postgres.<project-ref>:<db-password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres" \
  ALLOWED_ORIGIN="https://<render-site>.onrender.com"
```

- `ALLOWED_ORIGIN` — drives CORS **and** cross-origin WS upgrades. Default `*`; set to the Render URL in prod.
- Current placeholder secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (`PLACEHOLDER_SET_AFTER_SUPABASE_PROJECT`), `DATABASE_URL` (parseable dummy — the server boots, DB calls fail until real value set).

## 2. Supabase prod — blocked, exact steps

**Blocker:** `supabase projects create` failed —
`collinpfeifer (2 project limit)` on the free plan (`llm-gateway` + `madcactus-dashboard` active). Fix: pause/delete one, or upgrade the org to Pro. Then:

```bash
supabase projects create online-poker \
  --org-id vercel_icfg_mYK5INg1vWHOgFMLeqFe55Nv \
  --region us-east-1 --size nano \
  --db-password "$(openssl rand -hex 16)"   # save it — Fly's DATABASE_URL needs it

supabase link --project-ref <project-ref>          # from create output
supabase db push                                   # applies supabase/migrations/0001,0002
```

Then set the Fly secrets above (URL/ref from the project, pooled connection string for `DATABASE_URL`) and `cd server && fly deploy`.

Note: a generated db password from the Aug 31 session sat in `/tmp/sb_db_pw.txt` — gone after reboot; just generate a fresh one at create time.

## 3. Render (web static site)

Dashboard → **New +** → Static Site → connect the repo (branch `main`). Settings:

| Setting | Value |
|---|---|
| Root Directory | `web` |
| Build Command | `bun install --frozen-lockfile && bun run build` |
| Publish Directory | `dist` |
| SPA Rewrite | source `/*` → destination `/index.html` |

(`web/render.yaml` holds the same config as a blueprint; Render only auto-detects `render.yaml` at the repo root, so either copy it up a level or enter the settings by hand.)

### Env vars (set before first deploy — Vite bakes them at build time)

| Var | Value |
|---|---|
| `VITE_API_URL` | `https://online-poker-server.fly.dev` — bare origin, no path (REST paths + `wss://…/ws` URL are appended by the client) |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |

After Render gives you the site URL, set Fly's `ALLOWED_ORIGIN` to it (section 1) and redeploy the server.

## Order of operations for Collin

1. Free a Supabase slot (pause one project or upgrade) → create `online-poker` + `supabase db push`.
2. Set real Fly secrets + deploy (`cd server && fly deploy`) → `curl https://online-poker-server.fly.dev/healthz`.
3. Create the Render static site with the env vars above.
4. Set `ALLOWED_ORIGIN=<render-url>` on Fly + redeploy.
5. Play a hand: lobby → create table → join from two browsers.
