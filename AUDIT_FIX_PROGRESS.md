# Audit Fix — Progress Tracker

**Plan:** `AUDIT_FIX_PR_PLAN.md` (48 PRs, 8 waves) · **Findings:** `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md`

> This file is updated **in every audit-fix PR**, in the same commit as the code, so a
> reviewer can see at a glance what is finished, what this PR changes, what is still
> pending, and what was deliberately left for later (and where that is tracked).

**Status: 20 of 48 PRs merged · 1 open (this one) · 27 pending**

Wave progress: **W0 ✅ done** · **W1 ✅ done (17/17 — every P0 finding is closed)** · **W2 3/8 in progress** · W3–W7 not started

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

<sub>#322 was closed as superseded by #323: GitGuardian flagged an *intermediate* commit (an enumerated list of credential column names), and such findings stay attached to a PR's whole history — the branch was recreated from `main` as one clean commit.</sub>

---

## 2. This PR — a scheduled popup is no longer cached past its own schedule

**Audit ID:** PUB-BE-04 (plus the report's related observations on popup dates and popup row reads). Third W2 PR.

Every other payload this Worker serves is a pure function of the data version: nothing but an admin edit can change the right answer, an edit bumps the version, and a new version is a new URL — which is exactly what makes `immutable` correct for them.

`activePopups` is not like that. Its answer depends on `start_at` / `end_at` versus **now**, so it changes on a schedule with no write anywhere to bump anything. It was nevertheless served `public, max-age=31536000, immutable` to any caller passing the current `?v=`, under an ETag of `activePopups-v<version>` that does not change with time either. So a popup scheduled to open tomorrow was answered *"no popups"* today and that answer was cached **in the visitor's browser for a year** — the popup simply never appeared for anyone who visited before it opened. In the other direction a popup that ended last night stayed cached as visible, and revalidating could not dislodge it, because the unchanged ETag returned `304`. Scheduling a popup is the entire point of the feature, so this was the feature being broken by its own cache.

Done:

- **The cache identity is now (data version, time bucket).** The edge key, the ETag and the client `max-age` are all derived from `floor(now / 60s)`, so one bucket is built once per version per colo and everything inside it is a cache hit; when the bucket rolls over the key *and* the validator both change, so the edge misses and a revalidation cannot answer `304` with yesterday's popup set. The key is still derived from nothing the caller controls, so PUB-BE-01 holds: `?v=` is still accepted and still cannot influence it — it just no longer buys a year.
- **`immutable` and `stale-while-revalidate` are both gone from this action.** Both mean "you may keep showing this after it expires", which is the defect. `max-age` is the time remaining in the current bucket, so every client converges on the same boundary instead of each holding its own offset window.
- **Why a bucket and not a TTL computed to the next `start_at`/`end_at`:** the next boundary is only known *after* building the payload, so a cache **hit** — the case that has to stay cheap — would have no idea when its own answer expires. The bucket comes from the clock alone, so hit and miss agree without reading anything. The trade is stated plainly in the code: a popup can be up to 60 s late to appear or disappear. Against a payload that could previously be a *year* wrong, that is a rounding error, and it costs one rebuild per minute per colo (two small queries) instead of one per year.
- **A schedule that cannot be read now fails CLOSED.** A stored stamp is one of three things — empty (that end is unbounded), parseable, or non-empty junk — and `parseStoredDate` returned `null` for the first *and* the third alike. So `if (start && start > now)` skipped the check entirely for a typo'd value: a popup with `start_at = '22/08/2026'` went live immediately and, having no readable end either, never stopped. Unreadable now means not served. The legacy space-separated format (`'2026-08-22 14:31:00'`, read as UTC) is *not* malformed and keeps working. The same rule is applied to `popupIsLiveNow` in `mgmt/backend/src/popups.js`, whose comment already promised the two could never drift — otherwise the admin's "Active" badge and the public portal would now disagree.
- **Only eligible popups are read.** The `popups` scan is pre-filtered in SQL (deliberately *more* permissive than the JS predicate, which stays the real decision, so a wrong clause can only let too many rows through — never hide a popup), and slides are fetched with `popup_id IN (...)` instead of an unconditional `SELECT … FROM popup_slides`. Previously every slide of every popup was read on every rebuild, including popups that had just been filtered out — D1 bills rows read, against the quota shared with the management API.
- `getActivePublicPopups` reads the clock as `new Date(Date.now())`, so eligibility and the cache bucket cannot disagree about what "now" is.

New `Public/backend/test/popup-schedule-and-ttl.test.mjs` — 17 tests, **10 of which fail on `main`**:

| | on `main` | on this branch |
|---|---|---|
| a popup opening in 10 minutes, requested with `?v=` | `max-age=31536000, immutable` | `max-age` = rest of the bucket, no `immutable` |
| revalidating with a live popup's ETag after it expired | `304` — the expired popup stays on screen | `200` + an empty list, new ETag |
| `start_at = '22/08/2026'` (and three more malformed forms) | live immediately, never expires | not served |
| one live popup out of four rows | every slide of all four read | one query bound to `['LIVE']` |

Also pinned: eleven requests inside one bucket issue exactly one popup query and the next bucket rebuilds exactly once; `max-age` is `60 - offset` across a bucket; a version bump still invalidates instantly; an empty stamp still means unbounded; slide order and `duration_ms` normalisation are unchanged.

The PUB-BE-01 key test in `cache-key-and-methods.test.mjs` is updated in the same commit: it asserted the exact key `activePopups?v=<version>`, which now carries the bucket. It still asserts one key per action and that the version is in every key.

Verification: `Public/backend` `npm test` **51/51** (34 + 17) · `mgmt/backend` `npm test` **714/714** · `npm run lint:errors` clean · `node --check` on all 51 Worker files.

Left for later (same wave): single-flight for a concurrent cache miss is PR-24 — two simultaneous misses in a fresh bucket can still both build. The public `users` projection is PR-21.

---

## 3. Pending

**W2 — Public backend (5 left):**

| PR | Branch | What |
|---|---|---|
| 21 | `fix/public-users-allowlist` | Explicit column allowlist on the public users payload |
| 22 | `fix/public-write-hardening` | Size/shape/rate limits on the public write paths |
| 23 | `fix/public-snapshot-atomicity` | KV last-known-good snapshot written atomically |
| 24 | `perf/public-assembly` | Parallel section reads + single-flight cache fill + post-assembly version re-check |
| 25 | `test/public-backend-harness` | Lockfile + a Miniflare/workerd harness covering every action (extends the tests added in PR-18/19/20) |

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
| C8 | Public backend has no lockfile; tests started in PR-18 cover the cache/method contract only | Full action coverage needs a Miniflare/workerd harness | PR-25 |
| C9 | `verifyToken` revocation check still fails open on an audit-DB error | Availability trade-off; KV deletion (#319) is now the authoritative revocation | Revisit with W4 observability |
| C10 | React mgmt main chunk at 218.3 kB vs 230 kB CI budget | Little headroom left; not a regression | PR-46 bundle budgets |
| C11 | Consent photos/signatures already archived to Drive by earlier runs are still anonymously readable | Code no longer publishes them (#325), but existing files need a one-off ACL remediation | Operational step: dry-run report → apply, before the next archive |
