# Audit Fix — Progress Tracker

**Plan:** `AUDIT_FIX_PR_PLAN.md` (48 PRs, 8 waves) · **Findings:** `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md`

> This file is updated **in every audit-fix PR**, in the same commit as the code, so a
> reviewer can see at a glance what is finished, what this PR changes, what is still
> pending, and what was deliberately left for later (and where that is tracked).

**Status: 25 of 48 PRs merged · 1 open (this one) · 22 pending**

Wave progress: **W0 ✅ done** · **W1 ✅ done (17/17 — every P0 finding is closed)** · **W2 ✅ done (8/8 — every PUB-BE finding is closed)** · W3–W7 not started

---

## 1. Merged

| PR | Title | Audit ID | What it fixed | Deliberately left (tracked in §4) |
|---|---|---|---|---|
| [#311](https://github.com/ashutoshroli/chhath-full-codebase/pull/311) | docs: audit report, fix approach and multi-PR plan | — | Three documents: full audit, batch approach, 48-PR delivery plan | — |
| [#312](https://github.com/ashutoshroli/chhath-full-codebase/pull/312) | warn that Full Backup does not cover every table | P0-07 (partial) | Both Backup screens + runbook now name the 12 uncovered tables and point to the CLI export | Real fix = generated manifest (PR-15) |
| [#313](https://github.com/ashutoshroli/chhath-full-codebase/pull/313) | commit loan, guarantors and all four consents in one batch | **P0-01 (Critical)** | All 8 rows in one `batch()`; consent rows minted before any write; delivery moved after commit; config checked pre-transaction | — |
| [#314](https://github.com/ashutoshroli/chhath-full-codebase/pull/314) | enforce the yearly loan budget atomically | P0-02 | Guarded `INSERT … WHERE (SELECT SUM(amount) …) + ? <= surplus`; dependent rows guarded on the loan existing; race loser gets a real error | Cross-DB `surplus` half still non-transactional (documented; not the race found) |
| [#315](https://github.com/ashutoshroli/chhath-full-codebase/pull/315) | validate before rotating consents; conditional loan updates | MGMT-BE-01 | Resend validates template/number **before** burning a token/send; guarantor swap is one batch; disburse is conditional on `Approved` | — |
| [#316](https://github.com/ashutoshroli/chhath-full-codebase/pull/316) | claim collection jobs with a verifiable exact-state claim | P0-04 | Claim repeats exact eligibility + `attempts < MAX`; unique `<iso>#<uuid>` token in `claimed_at`, re-read before running | — |
| [#317](https://github.com/ashutoshroli/chhath-full-codebase/pull/317) | derive collection jobs from the stored row | P0-03 | `rowIndex` mandatory; year/record-id/payload derived from the committed row; one live job per (row, document) | DOCX bytes are still client-filled — server-side generation is a separate change |
| [#318](https://github.com/ashutoshroli/chhath-full-codebase/pull/318) | revoke the effective session token on cookie-only logout | P0-05 | `effectiveSessionToken()`; logout revokes what the request authenticated with; `doLogout('')` no longer fakes success | — |
| [#319](https://github.com/ashutoshroli/chhath-full-codebase/pull/319) | end revoked sessions in KV, not just the audit row | P0-09 / C2 | All three revoke paths delete `session:<hash>`; 2FA disable / backup-code regeneration / recovery revoke sessions | Fail-open audit check kept as a *secondary* line (availability) — KV delete is now authoritative |
| [#320](https://github.com/ashutoshroli/chhath-full-codebase/pull/320) | scope and purge the view cache per account | P0-08 | Deferred hydration behind `setCacheIdentity(name\|role)`; `purgeCache()` on sign-out; sensitive views never written to disk (both frontends) | Bearer token still in Web Storage → cookie-only auth (§4) |
| [#321](https://github.com/ashutoshroli/chhath-full-codebase/pull/321) | return to Login when the session expires | P0-11 | `onAuthExpired` channel (server *and* local expiry, once per expiry); session store clears itself; `resolveAllowedTab()` for initial hash | React rollback app not covered (§4) |
| [#323](https://github.com/ashutoshroli/chhath-full-codebase/pull/323) | validate money, year and server-owned columns on every write | P0-09 (backend half) | `assertMoney` / `assertYear` / `assertNoServerOwnedFields`; year mandatory on financial rows; edits can no longer rewrite `Sl. No.` / `created_by` | UI half = #324 |
| [#324](https://github.com/ashutoshroli/chhath-full-codebase/pull/324) | validate money and payment details before saving | P0-09 (UI half) | `lib/money.ts` mirrors the backend limits, applied in Home/Expenses/Loans (add + edit); loan year switch no longer keeps the previous year's contributors; donation details validated before any write | Field-level inline errors (still `alert()`) → PR-40; donation publish still setting-by-setting (C3) |
| [#325](https://github.com/ashutoshroli/chhath-full-codebase/pull/325) | keep consent evidence private and update the DB before deleting R2 | P0-06 | Archive order is upload → conditional update → verify → delete; consent photos/signatures archived private while PDFs stay public; stale archive cannot overwrite a re-generated file | Consent copies already published by earlier archive runs need a one-off ACL pass (C11) |
| [#326](https://github.com/ashutoshroli/chhath-full-codebase/pull/326) | back up every table and restore an empty table faithfully | P0-07 | All 9 bindings + every schema table (12 were missing, incl. all of `DB_AUDIT`); a schema-vs-map test fails on drift either way; manifest v2 records `{rows, present}`; a present-and-empty table is now cleared on restore while v1 files keep the lenient skip | R2/Drive object backup stays an operational step (the file stores links); `collection_jobs.filled_base64` excluded on purpose |
| [#327](https://github.com/ashutoshroli/chhath-full-codebase/pull/327) | never report a genuine record as not found | P0-10 | Verify screen's two-way verdict → seven explicit states in a pure `verifyVerdict.ts`; the red "not found" is asserted only against **live** data (otherwise "Verification Unavailable" / "Could Not Confirm" + Retry); `idle` counts as checking | Freshness provenance behind the stale flag = #328 |
| [#328](https://github.com/ashutoshroli/chhath-full-codebase/pull/328) | distinguish live data from a saved copy, and bound every request | PUB-FE-01 | `source: network\|snapshot\|empty`; `savedAt` only from a real network response; SW API rule `NetworkFirst` → `NetworkOnly`; 12 s request / 30 s chat deadlines; concurrent loads share one request | Showing the age prominently in the UI is a design change → W5/W6 |
| [#329](https://github.com/ashutoshroli/chhath-full-codebase/pull/329) | one canonical cache key and one method per action | PUB-BE-01, PUB-BE-02 | Cache key = (action, live version) only, so junk params can no longer force a rebuild; body-only caching (CORS never shared); `ACTION_METHODS` → `405` + `Allow`, enforced before any I/O. **First tests for this Worker** (19) + a CI step | Popup time-awareness → PR-20; single-flight → PR-24; lockfile/Miniflare → PR-25 |
| [#330](https://github.com/ashutoshroli/chhath-full-codebase/pull/330) | cheap liveness, throttled readiness, no D1 errors in public replies | PUB-BE-03 | `?health=1` is liveness with **zero I/O** (was 6 D1 round-trips + a KV read per call, before the rate limiter); `?health=1&deep=1` is readiness, probed in parallel and edge-cached 60 s; dependency *states* are public, D1 error text goes to `error_log` and is released only to a `HEALTH_TOKEN` holder; 15 tests + the mgmt-side M-36/M-37 assertions moved onto the split contract | — |

| [#331](https://github.com/ashutoshroli/chhath-full-codebase/pull/331) | let a scheduled popup expire on time | PUB-BE-04 | Cache identity for `activePopups` is (data version, 60 s time bucket) instead of `immutable` per version, so a scheduled popup is no longer cached for a year outside its window and a stale ETag cannot answer `304`; a malformed schedule stamp fails closed; the `popups` scan is pre-filtered in SQL and slides are read only for eligible popups | Single-flight for a concurrent miss → PR-24 |
| [#334](https://github.com/ashutoshroli/chhath-full-codebase/pull/334) | make the public users projection an allowlist | PUB-BE-05 | `USERS_PUBLIC_COLS` drives both the `SELECT` and the emitted row, iterating the allowlist rather than the DB row, so `created_by` stops leaking and a future column fails closed; `id` is ordered by without being returned; `__rowIndex` is opt-in and only `collections` (whose QR record id is built from it) asks | Explicit SQL for the other seven sections → PR-24 |
| [#335](https://github.com/ashutoshroli/chhath-full-codebase/pull/335) | require an approved origin, JSON and a shape on the two writes | PUB-BE-06 | The two anonymous writes now need an approved `Origin`, `application/json` (which forces the preflight CORS alone never triggered), a hard body cap measured on the bytes read, and a per-action shape check — all before any D1 work; the push endpoint is parsed with `new URL` instead of a `^https://` regex; `415`/`403`/`413`/`400`/`429`/`503` replace a blanket `200`/`400`; five frontends now declare JSON | Challenge/nonce judged not worth a round-trip + KV write; IP hashing → C12 |
| [#336](https://github.com/ashutoshroli/chhath-full-codebase/pull/336) | make the snapshot atomic and stop inventing a data version | PUB-BE-07 (observations) | The last-known-good copy is ONE KV value `{version, savedAt, data}` instead of a two-key pair that could be half-written and never corrected; the size guard measures UTF-8 bytes rather than UTF-16 code units (3x under-count on Devanagari); a failed write is logged; an unreadable version is `null` and answers `503 {unavailable}` instead of a cacheable `v=0` | Paginating the payload itself → PR-24 |
| [#337](https://github.com/ashutoshroli/chhath-full-codebase/pull/337) | read the sections together, build once, verify the version after | PUB-BE-07 | Twelve sequential section reads become concurrent (same queries, same D1 cost); concurrent misses share one build per isolate per version instead of each running nine table scans; the version is re-checked after assembly so a payload is never cached under a version it no longer matches; a section past 20k rows is logged before the 25 MB snapshot cap silently removes the outage fallback | Paginating the contract = C13 |
<sub>#332 and #333 were closed as superseded by #334, and #322 by #323: GitGuardian flagged an *intermediate* commit (an enumerated list of credential column names), and such findings stay attached to a PR's whole history — the branch was recreated from `main` as one clean commit.</sub>

---

## 2. This PR — the public Worker gets a lockfile and runs for real in CI

**Audit ID:** PUB-BE-08 ("backend has no local tests, lockfile, lint or integration harness; only syntax is checked by CI"). **Last W2 PR** — this closes Wave 2 and carry-over **C8**.

Wave 2 gave this Worker its first tests, and they are good tests: 145 of them, pinning every finding W2 fixed. But they all import `src/index.js` and stub D1, KV and the Cache API with plain objects — and **a stub only ever behaves the way the person who wrote it expected**. That leaves a whole class of defect invisible:

- The Cache API **refuses to store a response with no freshness information**. A `Map` keeps everything, so a stub cannot tell you that a cache write silently did nothing. (This is not hypothetical: it is how the smoke test for this harness failed first time.)
- The Cache API **refuses a non-GET key** — the reason every `POST ?action=portalData` used to be an uncached full build (PUB-BE-01). The unit suite asserts this by hand, because someone remembered to.
- D1 errors have real shapes, and the SQL is checked against the **committed schema** rather than against a fixture that agrees with the code by construction.
- `caches.default`, `ctx.waitUntil`, `Content-Length`, preflight handling and status-code semantics are the platform's behaviour, not ours.

Done:

- **A lockfile** (`Public/backend/package-lock.json`), which closes the first half of C8. Installs are deterministic, and `npm ci` is what CI runs.
- **`miniflare` pinned exactly**, not caret-ranged: it ships the workerd binary, and workerd's behaviour is the thing under test — a floating range would let the platform change underneath a passing suite with no commit. It must also stay on the 4.x line to match `wrangler ^4.20.0`; miniflare 5.x is a different constructor API.
- **`test/integration/harness.mjs`** boots the real Worker under workerd with all six D1 bindings created from `mgmt/db/schema/*.sql` — the same committed DDL the mgmt suite runs against, so drift between this Worker's SQL and the schema now fails here — plus real KV and the real Cache API. D1's `exec()` splits on newlines and chokes on comments, and those schema files are as much documentation as DDL, so statements are split and run one at a time; a failure names the statement that failed.
- **`test/integration/every-action.integration.test.mjs`** — 25 tests covering every action end to end: `dataVersion`, `portalData`, `summary`, `activePopups`, `publicGetSeo`, `logError`, `savePushSubscription`, liveness, readiness, the unknown-action `400`, method rejection with the right `Allow`, and the preflight.
- **A separate CI job**, `public-harness`. Deliberately not folded into the existing `backend` job: it needs an `npm ci` that downloads workerd, and the fast checks everyone waits on for every push must not wait for that. `npm test` stays dependency-free and stays the suite that runs everywhere in a second.

**Two `overrides`, documented in `package.json`.** `miniflare 4.20260730.0` pins `undici 7.28.0` exactly (four HIGH advisories, fixed in 7.29.1) and `sharp 0.35.2` (fixed in 0.35.4). npm's own remedy is `miniflare@5.x-alpha` — a breaking prerelease in CI, which is a worse trade than two overrides. Neither is a production concern: miniflare is a devDependency that only ever talks to a local workerd, and none of it is bundled into the deployed Worker. With the overrides, `npm audit` reports **0 vulnerabilities**. Same pattern and same reasoning as the `xmldom` override already documented in `mgmt/frontend/package.json`.

## What the harness proves that the stubs could not

| | why a stub cannot show it |
|---|---|
| a built payload is really stored, and a second request is served without reading D1 — verified by changing a row *without* bumping the version and getting the old payload back | a `Map` accepts any response; workerd applies the real storability rules |
| `POST ?action=portalData` → `405` + `Allow: GET, OPTIONS` | the real Cache API is what refuses a non-GET key |
| `logError` lands a row that is then read back out of `error_log` | a stub records a call, not a row |
| `savePushSubscription` **upserts** — two posts for one endpoint leave one row, with the second's key | `ON CONFLICT` is SQLite's behaviour |
| every section of `portalData` is built from the committed schema | a fixture agrees with the code by construction |
| `ETag` revalidation returns a real `304` with an empty body | the platform decides what a 304 carries |
| the users projection withholds `created_by` / `email` / `whatsapp` **that really are in the row** | the seed writes all three, so absence proves the allowlist |
| the snapshot is one KV value `{version, savedAt, data}`, and the old `:version` key is not written | KV is real, and the key list is real |

## Verification

```
Public/backend:  npm test               -> 145 passed   (no install required)
                 npm run test:integration -> 25 passed  (workerd, real bindings)
                 npm ci && npm audit    -> 0 vulnerabilities
mgmt/backend:    npm test               -> 714 passed
all Workers:     node --check           -> OK (51 files)
```

Wave 2 is complete: **PUB-BE-01 … PUB-BE-08 are all closed.**

Left deliberately: the harness covers every action's contract, not every branch of every action — the unit suites do that, faster, and are where a new finding should be pinned first. What the harness is for is the platform.

---

## 3. Pending

**W3 — Render / AI / chat (7):** payload size contract · durable idempotent jobs · callback outbox + version bump · provider SSRF policy · AI write allowlist · chat abuse controls · chat privacy + Neon
**W4 — Database (3):** duplicate/orphan detection · enforce keys & relations · migration ledger
**W5 — Accessibility (6):** dialog primitives (public + mgmt) · combobox/buttons · contrast/focus/zoom · live regions + labels · structure/motion
**W6 — SEO / PWA / privacy / perf (4):** route metadata · manifest + update UX · privacy + same-origin push · lazy skins
**W7 — Platform (3):** CI gates · dependency upgrades · observability + retention

---

## 4. Carry-overs (deliberate, not forgotten)

| # | Item | Why deferred | Where it lands |
|---|---|---|---|
| C1 | Session token still in Web Storage (both frontends) | Cookie-only auth is a rollout with a back-compat window, not a one-file change | Own PR after W1; groundwork already in #318/#319 |
| C2 | Retained React app: no auth-expiry handling, no tests | No test harness there; it is the rollback target, so changes need their own verification | PR-47 (retained-app hardening) |
| C3 | Donation settings not truly atomic | Needs a single backend settings action | Folded into W2 backend work |
| C4 | Collection DOCX still rendered client-side | Server-side rendering is a feature change, not a fix | Post-W3 |
| C5 | `H-6 … WITHOUT decoding` test flake (asserts `ms < 250`) | Pre-existing; timing-based, passes in isolation, fails under full-suite load | PR-46 (CI gates) |
| C6 | Migration CI only scans `mgmt/db/migration/2026-09-05/` | Older folders have uncovered files; widening it fails today | PR-46 |
| C7 | 160 `svelte-check` warnings in the mgmt SPA | Mostly label association — belongs with the a11y work, then fail-on-warning | PR-40 / PR-46 |
| C9 | `verifyToken` revocation check still fails open on an audit-DB error | Availability trade-off; KV deletion (#319) is now the authoritative revocation | Revisit with W4 observability |
| C10 | React mgmt main chunk at 218.3 kB vs 230 kB CI budget | Little headroom left; not a regression | PR-46 bundle budgets |
| C11 | Consent photos/signatures already archived to Drive by earlier runs are still anonymously readable | Code no longer publishes them (#325), but existing files need a one-off ACL remediation | Operational step: dry-run report → apply, before the next archive |
| C12 | Public visitor IPs are stored raw in `error_log.client_ip` (and in `context.edgeIp`) | Hashing them needs a salt SECRET to be worth anything — an unsalted hash of an IPv4 is 2^32 to reverse — so it is a deployment step (`wrangler secret put`) plus a fallback path, not a code-only change. Split out of PR-22 to keep the authenticity fix reviewable | Own PR, with the retention window, before W3 |
| C13 | `portalData` still materialises whole tables; the other seven sections still read `SELECT *` and filter in JS | Bounding the payload for real means PAGINATING the public contract, which changes all six frontends — a contract decision, not a fix. PR-24 makes the size visible (a section past 20k rows is logged) instead of pretending it is bounded. Truncating a transparency payload was rejected: hiding contributions is worse than a slow page | Contract decision, then its own PR; the row-count log is the trigger |
