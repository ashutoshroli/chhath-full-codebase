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
