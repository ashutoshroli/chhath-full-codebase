# Post-audit manual & operational steps

Everything an operator with production access must do **by hand** after the audit-
remainder PRs (#113–#122) are merged. Code changes went out as PRs; the items below
are the ones that cannot be done from a pull request — deployments, live-data
migrations, and production configuration.

Nothing here is urgent-or-broken: the app runs today without any of it. Each item is
sequenced and marked with its risk. Do them in order; **A first** (deploy), then **B**
(config), then **C/D** (optional live-data hardening, on your own schedule).

---

> ## ⚡ UPDATE — after PRs #128–#133 (pre-launch hardening, data is test-only)
>
> Several things below changed from *"recipe to run by hand"* to **already applied
> in code**, because the data is test-only and could be safely finished:
>
> - **Column types (M-33)** and **CHECK constraints (M-35)** are now in
>   `mgmt/db/schema/*.sql` directly. **For a fresh/test deploy you do NOT run the
>   `12/13-*.sql` rebuild recipes** — just (re)apply the schema and re-import your
>   test data. The rebuild recipes in §C5/§C4 are only for an *existing* DB you
>   can't recreate.
> - **Cookie session + CSRF + CORS preflight (H-12/M-10)** is now **IMPLEMENTED**
>   (backward-compatible). §D's "deliberately deferred" note is superseded: just
>   redeploy the mgmt Worker + mgmt frontend with `ALLOWED_ORIGINS` set (§B1). The
>   body-token path still works, so nothing breaks.
> - **FK enforcement (M-34)** stays as the operator triggers in §C3 (D1 can't
>   enforce schema FK) — apply them once if you haven't (you already did, live).
> - **Everything else** (deploys §A, config §B, uptime §B3) is unchanged and still
>   applies.
>
> **So the short version now is: (1) redeploy all three targets §A, (2) confirm
> `ALLOWED_ORIGINS`/`VITE_GTM_ID`/uptime §B, (3) FK triggers §C3 if not already
> applied. §C5/§C4 rebuilds and §D are NOT needed for a fresh test-data deploy.**

> ## ⚡ UPDATE — after Waves 0–2 of the 2026-09-15 audit (#311–#338)
>
> The 2026-09-15 audit's W0/W1/W2 are merged: all eleven P0 findings and PUB-BE-01…08.
> **Those add no migrations at all** — they are deploys, one new variable, and one
> security backlog item. They have their own section: **[§W below](#w-waves-02-311338--what-an-operator-must-do)** (W1–W5 for Waves 0–2, W7 for Wave 3 and the committee-reported items, W8 for Wave 4, W9 is the checklist).
>
> Sections A–D are the *earlier* audit's remainder and are unchanged.

> Legend: 🟢 safe / routine · 🟡 verify before/after · 🔴 destructive on live data (take a backup first)

---

## A. Deploy the merged PRs 🟢

The merges only change the repo. Redeploy so the code goes live.

| Deploy | Needed by | How |
|---|---|---|
| **mgmt Worker** | Q-8 (#114), H-16 (#118), M-10/H-12 health warning (#121), Q-1 (#122) | `cd mgmt/backend && npm run deploy` (wrangler) |
| **mgmt frontend (Vercel)** | H-16 (#118 Backup UI), P-3 (#119 bulk PDF) | Vercel auto-deploys on merge to `main`, or trigger a redeploy in the Vercel dashboard |
| **public Worker** | H-5 (#113 guarantors allowlist, #120 `?action=summary`) | `cd Public/backend && npm run deploy` |

**After deploying, smoke-test:**
- Log in to mgmt, load Home, save one record → still works.
- Public site loads and shows totals.
- `curl https://<mgmt-worker>/?health=1` → `status: ok` (a `featureWarnings` entry for `ALLOWED_ORIGINS` is expected until you do **B4**).

---

## B. Production configuration 🟡

### B1. Verify + set `ALLOWED_ORIGINS` on the mgmt Worker 🟡  *(prerequisite for the future cookie/CORS work)*
`GET /?health=1` now lists `ALLOWED_ORIGINS` under `featureWarnings` when it's unset.
It is **harmless today** (requests are simple/no-preflight), but it MUST be correct
before anyone enables M-10/H-12 later, or the app goes fully offline.
```
# wrangler.toml [vars] on the mgmt Worker — exact frontend origin(s), comma-separated, no trailing path
ALLOWED_ORIGINS = "https://mgmt.shaharpura.com"
```
Redeploy, re-check `/?health=1` until the warning is gone. **This only sets a variable — it changes no behaviour.** Full sequence for actually switching to cookie auth later: `docs/CORS_COOKIE_MIGRATION.md`.

### B2. Set `VITE_GTM_ID` explicitly (Vercel) 🟢
So nobody has to wonder whether the committed container id is real (audit #88). Set it in the Vercel project env vars for the mgmt frontend; redeploy.

### B3. Point an uptime monitor at the health endpoints 🟢
`GET /?health=1` on **both** Workers returns HTTP 503 when the Worker cannot serve. Add both URLs to your uptime monitor (UptimeRobot/BetterStack/etc.).

On the **public** Worker this is now split in two (audit PUB-BE-03), because a probe that hits the database on every poll spends a quota shared with the mgmt API:

| what to call | what it does | poll it? |
|---|---|---|
| `GET /?health=1` | **Liveness.** No database or KV access at all — it only answers "is this Worker up and fully configured?" (503 when a required binding is missing). | **Yes** — this is the monitor URL. |
| `GET /?health=1&deep=1` | **Readiness.** Actually probes every D1 binding and KV. The result is cached for 60s and the per-IP limit applies, so it cannot be used to hammer the databases. | Only when investigating. |

Readiness returns each dependency's **state** to anyone, but the underlying D1 error
messages only to a caller holding the shared secret — they go to `error_log`
otherwise, because a D1 error string can echo table and database names:

```bash
wrangler secret put HEALTH_TOKEN          # in Public/backend
curl -H "X-Health-Token: <secret>" "https://<public-worker>/?health=1&deep=1"
```

Without `HEALTH_TOKEN` set, nobody gets the messages (an unset secret does not mean "open").

---

## C. Live-data hardening — run when you have a backup + a quiet window 🔴

These ship as migration files that **do nothing when applied as-is** (they are all
comments — proven by the test suite). You run the numbered PARTs by hand, in order,
per database. **Take a full backup first** (mgmt → Backup & Restore → Download).

> Apply a file with: `wrangler d1 execute <DB_NAME> --remote --file=./<file>.sql`

### C1. Duplicate-detection + UNIQUE indexes (audit H-9) 🔴  *(from the ORIGINAL audit — highest priority)*
The pre-fix id-allocation race may already have produced two members sharing one `USER####`, or two donors sharing one receipt number.
- Run the detection query in `mgmt/db/migration/2026-09-05/07-core-id-uniqueness.sql` (PART 2 Step 1) and `08-collections-sl-no-uniqueness.sql`.
- If rows come back, **repair per the file's Step 2** before applying the UNIQUE index (Step 3). Do **not** apply the UNIQUE index while duplicates exist — it will fail.

### C2. Orphaned loan-consent rows (audit, from #82) 🔴
Consent rows left behind by pre-#82 loan deletions may still hold **live tokens**. Find them with the query in PR #82's description (or `10-loans-referential-integrity.sql` PART 1a) and revoke/repair — don't blind-delete a row whose token is still valid.

### C3. Referential integrity — FK / guarantor triggers (M-34, #116) 🟡→🔴
`mgmt/db/migration/2026-09-05/10-loans-referential-integrity.sql`:
1. **PART 1** — run the detection queries (read-only). Fix any orphans.
2. **PART 2** — apply the `BEFORE INSERT` triggers (safe, enforce new writes only, no rebuild).
3. **PART 3** — optional full FK via table rebuild, only after PART 1 is clean. 🔴

### C4. Domain CHECK constraints (M-35, #116) 🟡→🔴
`11-domain-check-constraints.sql` — same PART 1 → PART 2 → PART 3 flow (role ∈ loaner/guarantor, amount ≥ 0, contribution_type ∈ 1/2/3).

### C5. Column types `REAL`→`INTEGER`/`TEXT` (M-33, #117) 🔴
`12-column-types-integer.sql` (year/sl_no/tenure/counts) and `13-column-types-text.sql` (phone + UTR identity columns — the one that can lose leading zeros).
1. **PART 1** — run the detection queries; inspect any surprises (esp. a UTR showing `.0` or scientific notation).
2. **PART 2/3** — run each table's rebuild recipe. **Combine C3/C4/C5 for the same table into ONE rebuild** so a table is rebuilt only once (the files note where).

### C6. Confirm migration `2026-09-01/08` is applied 🟡
Without it, `bumpDataVersion` takes a lossy path and the public portal can serve stale data under a matching ETag. #87 makes this **warn** — check the mgmt Error Log; if you see that warning, apply `mgmt/db/migration/2026-09-01/08-public-data-version.sql`.

---

## D. Deliberately deferred — a separate, scheduled change 🔴

**Cookie session + CSRF + CORS preflight (H-12 + M-10).** Not enabled, on purpose: it
is breaking to every request path and turns a wrong `ALLOWED_ORIGINS` into a total
outage. When you have a staging origin and a maintenance window, follow the ordered
runbook in **`docs/CORS_COOKIE_MIGRATION.md`** (Step 0 = B1 above must be green first).

**Full public payload split (H-5).** The additive `?action=summary` endpoint (#120)
is live; removing `portalData` and making the public frontend fetch lazily per tab is
the remaining half. It needs `cf-cache-status: HIT` verified on the deployed
`?action=summary&v=<version>` URL first — do that check, then the frontend swap is safe.

---

## Quick checklist

- [ ] A: deploy mgmt Worker, mgmt frontend, public Worker; smoke-test
- [ ] B1: set + verify `ALLOWED_ORIGINS` (health warning clears)
- [ ] B2: set `VITE_GTM_ID`
- [ ] B3: uptime monitor on both `/?health=1`
- [ ] C1: run duplicate detection (07/08); repair; apply UNIQUE — **do first**
- [ ] C2: find + revoke orphaned consent tokens
- [ ] C3/C4/C5: run PART 1 detection for 10/11/12/13; then triggers; then (optional) combined rebuilds
- [ ] C6: confirm `2026-09-01/08` applied (check Error Log)
- [ ] D: schedule cookie/CORS (CORS_COOKIE_MIGRATION.md) + public payload split when there's a window
- [ ] **W: Waves 0–2 (#311–#338) — see §W. No migrations; deploy order matters; set the PUBLIC `ALLOWED_ORIGINS`**

---

# W. Waves 0–2 (#311–#338) — what an operator must do

Everything from the 2026-09-15 audit's **W0, W1 and W2** (PRs #311–#338: all eleven P0
findings, plus PUB-BE-01…08 on the public Worker). Sections A–D above are the *earlier*
audit's remainder and still stand on their own.

> ## 🟢 The short version
>
> **There are no new migrations.** Every PR in #311–#338 was code-only — verified with
> `git diff --stat 3166e23..HEAD -- mgmt/db/` (nothing but a cleanup runbook comment).
>
> So the work is: **(1) deploy, in the order in W2 · (2) set ONE new variable, W3 ·
> (3) smoke-test, W4.** One security backlog item (W5, consent ACLs) is not a deploy and
> can be scheduled.

## W1. Migrations — none new, but check these prerequisites 🟡

No W0–W2 PR adds a migration. Several *do* assume migrations that already exist. None of
them break if the migration is missing — each takes a documented fallback — but the
fallback is always the worse path, so it is worth confirming once:

| Existing migration | What in W0–W2 depends on it | If it is missing |
|---|---|---|
| `2026-09-05/27-users-photo.sql` | #334's explicit `users` projection | falls back to `SELECT *` (still allowlisted on the way out — the leak stays closed, the read is just wider) |
| `2026-09-05/09-error-log-client-ip.sql` | the public `logError` per-IP limiter | falls back to a leading-wildcard `LIKE` scan of `error_log` — on an anonymous endpoint |
| `2026-09-01/08-public-data-version.sql` | the whole W2 cache identity (key + ETag) | `bumpDataVersion` takes a lossy path; already §C6 above |
| `2026-09-05/31-push-subscriptions.sql` | `savePushSubscription` (#335) | the write fails; opt-in silently does nothing |
| `2026-09-01/05-popups-active.sql`, `2026-09-05/19-popup-slide-duration.sql` | the popup payload (#331) | popups do not appear / slide timing defaults |
| `2026-09-05/28`, `29`, `30` | `journeyEntries` / `journeyPageText` / `donation` sections | those sections degrade to empty |

**Check them in one go** (read-only):

```bash
# does users.photo exist?
wrangler d1 execute chhath-core --remote --command \
  "SELECT COUNT(*) AS has_photo FROM pragma_table_info('users') WHERE name='photo';"

# does error_log.client_ip exist?
wrangler d1 execute chhath-logs --remote --command \
  "SELECT COUNT(*) AS has_client_ip FROM pragma_table_info('error_log') WHERE name='client_ip';"

# is the version counter row there?
wrangler d1 execute chhath-core --remote --command \
  "SELECT value FROM portal_settings WHERE \"key\"='public_data_version';"
```

Each should return `1` / `1` / a number. Anything returning `0` → apply that file per §C.

## W2. Deploy, in this order 🟢

**The order matters for one reason.** #335 makes the public Worker require
`Content-Type: application/json` on its two write endpoints. The frontends now send it;
the *old* frontends did not (`fetch` sent `text/plain`). An old frontend against the new
Worker gets `415` on error reporting — so **deploy the frontend first**. The old Worker
accepts the new frontend's header happily (it simply did not check), so frontend-first is
safe in both directions.

| # | Target | Why | How |
|---|---|---|---|
| 1 | **public frontend v6** (Vercel) | #335 `Content-Type`, #327 verify verdicts, #328 live-vs-saved | Vercel auto-deploys on merge to `main`; confirm the deployment finished |
| 2 | **public Worker** | all eight W2 PRs | `cd Public/backend && npm run deploy` |
| 3 | **mgmt Worker** | W1 (P0-01…P0-11) and #339's batch dispatch | `cd mgmt/backend && npm run deploy` |
| 4 | **mgmt frontend (SvelteKit)** (Vercel) | #320 cache scoping, #321 session expiry, #324 money validation | Vercel auto-deploy; confirm |
| 5 | **mgmt frontend (retained React)** (Vercel) | #320 `purgeCache()` on sign-out | Vercel auto-deploy; confirm |
| 6 | **Render service** | #339 body limits + batch contract | auto-deploys from `main`; confirm in the Render dashboard that the new commit is live |

`Public/frontend`, `frontend-v3`, `frontend-v4` and `frontend-v5` also received the
`Content-Type` fix. **Deploy only the ones actually serving traffic** — if v6 is the only
live public frontend, the others need nothing.

## W3. The one new setting: `ALLOWED_ORIGINS` on the PUBLIC Worker 🟡

Until #335 this variable only controlled which origins got a CORS reflection on **reads**,
and leaving it unset was reasonable for a public read-only portal. **It is now also the
authenticity check on the two anonymous writes** (`logError`, `savePushSubscription`).

With it unset, a write must still carry *some* `Origin` and declare JSON — which stops the
trivial scripted flood, but does **not** stop a real browser on any other site. Set it:

```toml
# Public/backend/wrangler.toml — [vars]. Exact origin(s), comma-separated, no trailing path.
ALLOWED_ORIGINS = "https://chhath.shaharpura.com"
```

Then `cd Public/backend && npm run deploy`.

> ⚠️ Include **every** origin the public site is served from — the custom domain *and* any
> Vercel preview domain you actually use. An origin missing from this list can no longer
> report a JS error or register for notifications.

The mgmt Worker's `ALLOWED_ORIGINS` is already set (§B1 is done); this is the public one,
which was commented out.

**Optional, recommended:** `HEALTH_TOKEN` on the public Worker — see §B3. Without it the
readiness probe still reports every dependency's *state*; only the D1 error text is
withheld (it goes to `error_log`).

## W4. Smoke-test what W2 actually changed 🟢

```bash
PUB="https://<public-worker>"
ORIGIN="https://chhath.shaharpura.com"   # an origin on your ALLOWED_ORIGINS list

# 1. Liveness — must be instant and do no database work (PUB-BE-03)
curl -s "$PUB/?health=1" | jq '{check, healthy, missingRequired}'
#    -> {"check":"liveness","healthy":true,"missingRequired":[]}

# 2. Readiness — every dependency, edge-cached 60s. Add -H "X-Health-Token: ..." for detail.
curl -s "$PUB/?health=1&deep=1" | jq '{check, ready, degraded}'

# 3. A read action is GET-only; the Cache API cannot key a POST (PUB-BE-02)
curl -s -o /dev/null -w '%{http_code} %header{Allow}\n' -X POST "$PUB/?action=portalData"
#    -> 405 GET, OPTIONS

# 4. Popups must NOT be immutable — they expire by the clock (PUB-BE-04)
curl -s -D- -o /dev/null "$PUB/?action=activePopups" | grep -i cache-control
#    -> cache-control: public, max-age=<1..60>     (no "immutable")

# 5. The users payload must not carry internal fields (PUB-BE-05)
curl -s "$PUB/?action=portalData" | jq '.users[0] | keys'
#    -> no "Created By", no "Email", no "WhatsApp", no "__rowIndex"

# 6. Writes: wrong media type, no origin, then a correct one (PUB-BE-06)
curl -s -o /dev/null -w '415? %{http_code}\n' -X POST "$PUB/?action=logError" \
  -H "Content-Type: text/plain" -H "Origin: $ORIGIN" -d '{"message":"x"}'
curl -s -o /dev/null -w '403? %{http_code}\n' -X POST "$PUB/?action=logError" \
  -H "Content-Type: application/json" -d '{"message":"x"}'
curl -s -o /dev/null -w '200? %{http_code}\n' -X POST "$PUB/?action=logError" \
  -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
  -d '{"page":"/smoke","message":"post-deploy smoke test"}'
```

Then, in the app: open the public site (data loads, a popup shows if one is scheduled),
open **Verify** on a real document, and in mgmt save one record and sign out (the next
account must not see the previous one's cached views).

Finally, confirm the outage fallback exists **before** it is needed:

```bash
wrangler kv key get --binding KV_PUBLIC "pub:snapshot:portalData:v2" | head -c 200
```

That should print `{"version":"…","savedAt":"…","data":{…`. If it is empty, load
`?action=portalData` once and check again (#336 writes it on a version change).

## W5. Security backlog from W0–W2 — not a deploy 🔴

| | What | Why it needs a human |
|---|---|---|
| **C11** | Consent photos and signatures **already archived to Google Drive** by earlier runs are still anonymously readable. #325 stopped the code publishing them; the existing files were not touched. | Needs a one-off ACL pass over the archived objects: **dry-run report first**, then apply, before the next archive run. Deleting or re-permissioning consent evidence is not something to script blind. |
| **C12** | Public visitor IPs are stored raw in `error_log.client_ip`. | Hashing needs a **salt secret** (`wrangler secret put`) to be worth anything — an unsalted IPv4 hash is 2³² to reverse. Deployment step + code, so it is its own PR. |
| **C13** | `portalData` still materialises whole tables. | Bounding it means **paginating the public contract**, which changes every frontend — a product decision, not a fix. #337 logs any section over 20,000 rows so the trigger is visible rather than silent. |

## W7. Wave 3 and the committee-reported items 🟡

Wave 3 is now complete except PR-32's Neon schema half. **One migration must be applied** — the
first in this whole effort — and one feature does nothing until it is.

### W7a. THE MIGRATION 🟡 — apply this, or #349 silently does nothing

```bash
wrangler d1 execute chhath-loans-expenses --remote \
  --file=./mgmt/db/migration/2026-09-05/32-consent-decline-templates.sql
```

It seeds six notification templates (4 WhatsApp + 2 email) for a **declined or rejected loan
consent**. Until #349, neither told anybody: a loaner was never informed that his loan had
stopped, and the remarks the decliner is *forced* to write were discarded.

Safe by construction — every `INSERT` is guarded by `NOT EXISTS` on its `type`, so re-running
changes nothing and **cannot revert wording you have since edited**. It drops nothing, deletes
nothing, and modifies no existing row.

**Then reword the text.** What ships is a starting point in Hindi. Open **mgmt → WhatsApp
Templates** and **Email Templates**, find the four `consent_declined_*` / `consent_rejected_*`
entries, and put them in the committee's own voice before the next loan cycle.

One deliberate choice to be aware of: the **group** message carries the decline reason, the
**loaner's** does not. A decline remark can be blunt about the person it concerns. `{DeclineRemarks}`
*is* available in both templates, so adding it to the loaner's is a one-line edit if you want it.

### W7b. Secrets and variables 🟡

**Worth setting** (on the Render service, in the dashboard → Environment):

```
CHAT_IP_HASH_SECRET = <any strong random string>
```

Chat logs store a pseudonym of the visitor's IP. Until #351 that was an unsalted `sha256`, which
for IPv4 is 2³² candidates — minutes of a laptop's time to reverse. It is now a keyed HMAC that
rotates monthly. **With this unset, no pseudonym is stored at all** — deliberately, because
storing something that looks protected and is not is worse than storing nothing.

**Leave unset** (both are escape hatches named for what they are):

```
NEON_ALLOW_UNVERIFIED_TLS      # #351 turned Neon TLS VERIFICATION on; this turns it back off
AI_PROVIDER_HOST_ALLOWLIST     # optional; unset already refuses http://, localhost, 10.x, 169.254.x
```

**Defaults are already the intended posture** — set them only to tune:

```
CHAT_TRUSTED_PROXY_HOPS = 1        CHAT_MAX_CONCURRENT     = 4
CHAT_DAILY_TOKEN_BUDGET = 200000   JOBS_MAX_CONCURRENT     = 3
JOB_DEADLINE_MS         = 570000   # 9.5 min — must stay UNDER the Worker's 10-minute reconcile
```

Also worth doing, and free: make the Render service's **`GITHUB_TOKEN` fine-grained without
`workflows: write`**. #342 makes the code refuse to write a workflow file; a token that *cannot*
is a second, independent boundary. Scopes actually needed are in `mgmt/backend/wrangler.toml`.

### W7c. Deploys 🟢

| Target | Needed by |
|---|---|
| **Render service** | #339, #341, #342, #347, #350, #351 — auto-deploys from `main`; confirm the commit is live |
| **mgmt Worker** | #339, #341, #342, #344, #349 — `cd mgmt/backend && npm run deploy` |
| **mgmt frontend (SvelteKit)** | #348 (father's name in the contributor picker) — Vercel auto-deploy |
| **public frontend v6** | #348 (the public father's-name fix) — Vercel auto-deploy |

### W7d. One live-data check 🟡 — existing AI providers were never validated

Rows saved before #341 went through only `/^https?:\/\//`, so a provider may hold a plain-HTTP
or internal base URL. Such a row is now **refused at use time** — correctly, since it was sending
your provider API key unencrypted — but it will present as *"AI stopped working"* unless you find
it first:

```bash
wrangler d1 execute chhath-logs --remote --command \
  "SELECT provider_id, name, base_url FROM ai_providers WHERE base_url NOT LIKE 'https://%';"
```

Any row returned must be re-saved in **AI Management** with an `https` URL — **and rotate that
provider's API key**, because it has been travelling in clear.

### W7e. Smoke-test 🟢

- **AI Management** → try to save a provider with `http://localhost/v1` → refused, with a message about `https`.
- **Bulk PDF** for a year with more than a handful of documents → completes via Render (#339) instead of falling back to in-Worker conversion. The mgmt Error Log should show no `pdf_convert_batch` dispatch failures.
- **Add Collection** → the contributor dropdown shows `Name (Father's Name)`, and typing a father's name finds his sons (#348).
- **Public site** → open any contributor: the *Father's Name* row now appears (#348). It never did before, for anyone.
- **Decline a consent** on a test loan → the group and the loaner both get a message; the group's carries the reason (#349). Requires W7a.

## W8. Wave 4: run the integrity report — before anything is repaired 🟡

**Nothing to install and nothing to deploy beyond the mgmt Worker.** #354 adds a read-only
report; this section is how to use it, and why you should use it *before* the next PR lands.

### W8a. Run it

Superadmin only. Every statement it issues is a `SELECT` — it repairs nothing, deletes
nothing and adds no constraint.

The mgmt Worker takes every action as a **POST with a JSON body** — a plain `GET` is only
the liveness/health path, so there is no `?action=` form here. `token` is your Superadmin
session token (the body-token path, which needs no CSRF header):

```bash
MGMT=https://<mgmt-worker>
TOKEN=<your Superadmin session token>

curl -sS "$MGMT/" -X POST -H 'Content-Type: application/json' \
  --data "{\"action\":\"getIntegrityReport\",\"token\":\"$TOKEN\"}" \
  | jq '.summary, (.checks[] | select(.status != "clean"))'
```

To re-run a single check while you are fixing it:

```bash
curl -sS "$MGMT/" -X POST -H 'Content-Type: application/json' \
  --data "{\"action\":\"getIntegrityReport\",\"token\":\"$TOKEN\",\"only\":[\"dup_login_name\"]}" | jq .
```

The check ids are `dup_login_name`, `dup_user_id_code`, `dup_person`,
`dup_collection_sl_no`, `dup_loan_id`, `dup_consent_id`, `dup_consent_token`,
`orphan_consent_loan`, `orphan_guarantor_loan`, `orphan_person_ref`,
`orphan_generated_file`. An unknown id is rejected rather than silently ignored.

Each finding echoes back the `sql` that produced it. Findings are capped at 50 per check
(`truncated: true` tells you there are more) because a single Worker invocation on the D1
free plan may make only 50 subrequests and every query counts as one — so for exact
counts, run the echoed SQL against that one database by hand.

### W8b. How to read it

`ok: true` means **no invariant is violated and every check ran.** Two things it does
*not* mean:

- `summary.needsReview` can be non-empty while `ok` is true. That is only `dup_person`
  — possible duplicate people. Two members genuinely can share a name, a father's name
  and a village, so this is a list for a human, never a defect, and it must never be
  enforced with a unique index.
- `summary.notRun` must be **empty**. A check that could not run reports `unavailable`
  or `error`, never `clean` — but if you are reading only the `ok` flag you would miss
  which one. A missing binding in `wrangler.toml` is the usual cause.

### W8c. Deal with these in this order 🔴

If the report finds anything, some findings are more urgent than the migration they block:

1. **`dup_consent_token` — treat as a live credential.** The token *is* the whole
   authorization on the public consent page. Two rows sharing one means the link opens
   an arbitrary one of the two, so somebody can be shown, and can sign, another
   person's consent. Revoke **both** rows' tokens and re-send; do not just delete one row.
2. **`dup_login_name` — treat as a privilege question.** Sign-in and the per-request
   role re-check both use `WHERE name = ? LIMIT 1`, so with two rows of one name the
   password that works *and the role the request runs with* are whichever row D1
   returns. Check the reported `roles`: a pair spanning Superadmin and Subadmin means
   somebody may be operating at the wrong level right now.
3. **`orphan_consent_loan` — audit H-8.** The loan is gone; the consent row, and its
   token, are not. Revoke any still-live token **first**, then delete or re-point.
   Do not blind-delete by status.
4. Everything else — `dup_user_id_code`, `dup_collection_sl_no` (which is the same
   thing as a duplicate receipt number `NCS-<year>-<Sl. No.>`), `dup_loan_id`,
   `dup_consent_id`, `orphan_guarantor_loan`, `orphan_person_ref`,
   `orphan_generated_file`. Each finding's `hint` names the migration it blocks.

### W8d. Why this must happen before PR-34

PR-34 adds the partial UNIQUE indexes and the loan-relation triggers. Both fail on the
data as it stands:

- `CREATE UNIQUE INDEX` on a populated table **fails outright** while the duplicates are
  still there — migrations 07, 08 and 10 PART 3 cannot be applied until the
  corresponding check returns zero.
- Migration 10's PART 2 triggers would start **aborting legitimate writes** to a
  `loan_id` that already has orphan rows attached.

So the sequence is fixed: run this report → repair by hand, deciding row by row → then
enforce. PR-34 also needs a **fresh backup and a quiet window**, because unlike
everything merged so far it modifies live data.

## W9. Checklist — everything in §W, in order

- [ ] W1: confirm `users.photo`, `error_log.client_ip`, `public_data_version` (3 queries above)
- [ ] W2: deploy in order — **public frontend first**, then public Worker, then mgmt Worker, then the mgmt frontends, then confirm Render
- [ ] W3: set `ALLOWED_ORIGINS` on the **public** Worker + redeploy · (optional) `HEALTH_TOKEN`
- [ ] W4: run the six smoke checks; confirm the KV snapshot exists
- [ ] W5: schedule the consent-ACL dry run (**C11**) — the only security item still open from W0–W2
- [ ] **W7a: apply migration `32-consent-decline-templates.sql`** — the first migration of this effort; #349 does nothing without it. Then reword the six templates in mgmt → Templates
- [ ] W7b: set `CHAT_IP_HASH_SECRET` on Render · leave `NEON_ALLOW_UNVERIFIED_TLS` unset · (optional) a `workflows:write`-less `GITHUB_TOKEN`
- [ ] W7c: deploy the Render service, the mgmt Worker, and both Vercel frontends
- [ ] W7d: **run the `ai_providers` non-https query and rotate any key it finds**
- [ ] W7e: the five smoke checks (provider refusal · bulk PDF via Render · picker shows the father's name · public contributor shows it too · decline reaches the group and the loaner)
- [ ] **W8a: run `getIntegrityReport`** — read-only, repairs nothing
- [ ] W8b: confirm `summary.notRun` is **empty** (a check that could not run is not a pass)
- [ ] **W8c: if there are findings, work the three urgent ones first** — duplicate consent token (live credential) → duplicate login name (privilege) → orphan consents with live tokens (H-8)
- [ ] W8d: only once the report is clean, schedule PR-34 with a **fresh backup and a quiet window** — it is the first change of this effort that modifies live data
