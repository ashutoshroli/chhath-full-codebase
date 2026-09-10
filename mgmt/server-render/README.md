# chhath-server-render — offload service

A small Node/Express service that runs the **long-running AI work** offloaded from
the Cloudflare Worker (`mgmt/backend`) — work that would otherwise hit the Worker's
CPU / request-duration / subrequest limits:

- **`ai_fix_generate`** — fetch the relevant repo files from GitHub and ask Claude
  for a unified-diff fix.
- **`ai_pr_create`** — apply a stored diff and open a GitHub PR.
- **`ai_ci_retry`** — after a PR's CI fails, fetch the failed job log, re-ask Claude
  against the current branch state, apply the corrected diff, and commit it to the
  same branch (re-triggering CI). The Worker still receives the GitHub check_suite
  webhook and does the light D1 orchestration (branch match, attempt cap,
  CI-pass/auto-merge, manual-review escalation); only this heavy retry runs here.

The Worker stays the **single source of truth** for job state (its `render_jobs`
table in D1). This service only **computes** and **calls back** — it never touches
D1 directly.

```
Worker  ──POST /jobs (X-Render-Api-Key)──▶  Render (this service)
Worker  ◀─202 accepted──────────────────   Render
Render  … does the heavy work (Claude / GitHub) …
Worker  ◀─POST /?render-webhook (result, X-Render-Signature)── Render
Worker  saves the result in D1 (render_jobs + ai_fixes)
```

> The Worker (`aiFixCi.js`) still owns the GitHub check_suite webhook (HMAC verify)
> and the light D1 orchestration; it dispatches the heavy retry here as an
> `ai_ci_retry` job. It never touches D1 from this service.

## Endpoints

| Method | Path              | Auth                | Purpose |
|--------|-------------------|---------------------|---------|
| GET    | `/health`         | none                | Liveness + keep-alive target |
| POST   | `/jobs`           | `X-Render-Api-Key`  | Accept a job (`{jobId, kind, payload}`), ack `202`, run async, call back |

A bad/missing `X-Render-Api-Key` on `/jobs` returns **401** (Requirement #1: the
service is never usable without the shared secret).

## Environment variables (set in the Render dashboard → Environment)

| Var | What | Notes |
|-----|------|-------|
| `RENDER_API_KEY` | Worker→Render shared secret | **Must equal** the Worker's `RENDER_API_KEY`. Sent as `X-Render-Api-Key`. |
| `RENDER_WEBHOOK_SECRET` | Render→Worker shared secret | **Must equal** the Worker's `RENDER_WEBHOOK_SECRET`. **Distinct** from `RENDER_API_KEY`. |
| `WORKER_WEBHOOK_URL` | Worker callback URL | e.g. `https://chhath-mgmt-api.shaharpura.workers.dev/?render-webhook=1` |
| `GITHUB_TOKEN` | Fine-grained PAT | Scoped to the repo only: Contents R/W, Pull requests R/W |
| `GITHUB_REPO` | `owner/repo` | `ashutoshroli/chhath-full-codebase` |
| `ANTHROPIC_API_KEY` | Claude API key | Anthropic is the only provider supported here for now |
| `AI_FIX_MODEL` | Model id | Defaults to `claude-sonnet-4-5-20250929` |
| `PORT` | Injected by Render | Only set manually for local runs |

The service **fails fast at boot** (clear log message) if any required var is missing.

## Deploy steps (Render dashboard)

1. **Create the service.** New + → *Blueprint* and select this repo (uses
   `mgmt/server-render/render.yaml`), **or** New + → *Web Service* with:
   - Root directory: `mgmt/server-render`
   - Build command: `npm install --omit=dev --no-audit --no-fund`
     (there's no committed `package-lock.json`, so `npm ci` would fail — use `npm install`)
   - Start command: `npm start`
   - Health check path: `/health`
   - Plan: Free (see keep-alive below)
2. **Set the environment variables** from the table above (Environment tab).
   Generate two different strong random strings for `RENDER_API_KEY` and
   `RENDER_WEBHOOK_SECRET`, and set the **same two values** on the Worker with
   `wrangler secret put RENDER_API_KEY` and `wrangler secret put RENDER_WEBHOOK_SECRET`.
3. **Set the Worker's `RENDER_SERVICE_URL`** (`wrangler.toml [vars]`) to this
   service's public URL (e.g. `https://chhath-server-render.onrender.com`) and
   redeploy the Worker.
4. **Deploy** this service. Confirm `GET /health` returns `{"status":"ok"}`.

## Keep-alive (free tier)

Render's free tier **spins down after ~15 min of inactivity** (~30–60s cold start
on the next request). We do **not** keep it warm from the Worker (that would burn
the Worker's cron/subrequest budget). Instead, point an **external monitor
(UptimeRobot)** at `GET /health` every 5 minutes:

- keeps the service warm,
- and alerts you if it goes down.

The AI jobs are async (callback-based), so an occasional cold start only adds a bit
of latency to the first job — acceptable, since no user is blocked waiting. The
Worker also has a **reconciliation cron** that times out / re-dispatches any job
stuck waiting for a callback, so a missed callback never leaves a job hanging.
If you later need the (time-sensitive) CI-retry loop to be reliably fast, consider
Render's paid Starter tier (no spin-down) at that point.

## Local run

```bash
cd mgmt/server-render
cp .env.example .env   # fill in values
npm install
npm start              # or: node --env-file=.env src/server.js  (Node 20+)
```

## Tests

```bash
npm test               # node:test — diff applier + payload/auth unit tests
```
