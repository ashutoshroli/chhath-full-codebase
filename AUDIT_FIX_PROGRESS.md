# Audit Fix — Progress Tracker

**Plan:** `AUDIT_FIX_PR_PLAN.md` (48 PRs, 8 waves) · **Findings:** `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md`

> This file is updated **in every audit-fix PR**, in the same commit as the code, so a
> reviewer can see at a glance what is finished, what this PR changes, what is still
> pending, and what was deliberately left for later (and where that is tracked).

**Status: 23 of 48 PRs merged · 1 open (this one) · 24 pending**

Wave progress: **W0 ✅ done** · **W1 ✅ done (17/17 — every P0 finding is closed)** · **W2 6/8 in progress** · W3–W7 not started

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
<sub>#332 and #333 were closed as superseded by #334, and #322 by #323: GitGuardian flagged an *intermediate* commit (an enumerated list of credential column names), and such findings stay attached to a PR's whole history — the branch was recreated from `main` as one clean commit.</sub>

---

## 2. This PR — the safety net and the version it is keyed on

**Audit ID:** PUB-BE-07's additional observations — the snapshot write and *"version failures collapse to a valid-looking version `0`"*. Sixth W2 PR.

Two defects in the same area, both of which stay invisible until the moment they matter.

### The snapshot could be half-written

The last-known-good copy lived in **two** KV keys — the body, and "which version the body is for" — written together with `Promise.all` inside `ctx.waitUntil`, so nothing ever observed the result. KV has no transactions. If the *version* write landed and the *body* write did not, the pair is left asserting that the previous version's body is current; and because the writer skips whenever the recorded version already matches, **it would never be corrected**. The safety net would hold the wrong data permanently, and this would be discovered during the D1 outage it exists for — serving stale data labelled as the current version.

It is now **one key** holding `{ version, savedAt, data }`. A single KV put either lands or it does not, so there is no partial state to land in, and the extra read the meta key needed is gone. The v1 pair is still *read* (never written), so a deployment carrying an older snapshot keeps its safety net until the next data change replaces it.

`savedAt` now comes from the snapshot itself, which is the value #328 shows as the age of a saved copy — previously it could only be inferred.

### Its size guard counted the wrong unit

The guard compared `body.length` — UTF-16 **code units** — against a limit expressed in **bytes**. This payload is full of Devanagari (`name_hindi`, `village_hindi`, `designation_hindi`, `discription_hindi`), which is three UTF-8 bytes per single code unit, so the check under-counted by up to **3x on exactly the data it was written to protect**: a string measuring a "safe" 20 MB can be over 50 MB of UTF-8, past KV's 25 MB hard cap. The put would then fail — silently, inside `waitUntil`, under a bare `catch`. It now measures with `TextEncoder`, and **a failed write is logged** rather than vanishing, because the whole point of this value is to exist before it is needed.

### A version that could not be read is not a version

`getDataVersion` answered `'0'` for three different situations: the counter row genuinely does not exist yet, the binding is missing, and *the read failed*. Only the first is a version — `'0'` is a perfectly usable version string, and this Worker builds its entire caching identity out of it. So a D1 hiccup meant the payload built during the failure (possibly empty, since the section reads were failing too) was cached under the key `v=0` with an ETag of `…-v0`, and **every later failure produced that same identity**, serving the one bad build back as a cache hit, indefinitely, to everyone.

An unreadable version is now `null`, and every caller that needs one to answer safely says so instead: `portalData` serves the saved copy if there is one, otherwise an explicit `503 { unavailable: true }` with `no-store` and no ETag. Nothing cacheable is ever keyed on a version we do not have. An absent counter row is still `'0'` — a fresh deployment the mgmt Worker has never bumped really is at version zero, and that case must not be confused with a failure.

## Verification

New `Public/backend/test/snapshot-and-version.test.mjs` — 16 tests, **12 of which fail on `main`**:

| | on `main` | on this branch |
|---|---|---|
| a snapshot write | two KV puts, no transaction, result unobserved | one put carrying its own version |
| a failed snapshot put | silent — the safety net just stops existing | logged with the KV error |
| 8M Devanagari characters (24 MB of UTF-8) | inside the 20 MB guard, put fails at KV's 25 MB cap | refused before the put |
| `portalData` while D1 is down, with a saved copy | payload built and cached under `v=0` | the saved copy, `stale: true`, `savedAt` |
| the same with no saved copy | a `v=0` payload, cached at the edge | `503 { unavailable: true }`, nothing cached |
| `dataVersion` / `summary` / `activePopups` while D1 is down | `v=0` | `503`, unavailable |

Also pinned: a second request at the same version does not write again (the ~1,000/day KV write budget is shared); a genuinely absent counter row is still version `0` and still works; a v1 pair is still read when there is no v2 value; a v2 value wins over a v1 pair; and a corrupt snapshot value is ignored rather than served.

Two existing mgmt assertions are updated in the same commit. `h4-kv-isolation-and-session-keys.test.mjs` pinned the snapshot key constants **by name**, so it now matches them by shape — the namespace rule has to hold for whatever they are called next — and its H-5 guard test additionally asserts the guard measures bytes.

Verification: `Public/backend` `npm test` **132/132** (116 + 16) · `mgmt/backend` **714/714** · `npm run lint:errors` clean · `node --check` on all 51 Worker files.

---

## 3. Pending

**W2 — Public backend (2 left):**

| PR | Branch | What |
|---|---|---|
| 24 | `perf/public-assembly` | Parallel section reads + single-flight cache fill + post-assembly version re-check |
| 25 | `test/public-backend-harness` | Lockfile + a Miniflare/workerd harness covering every action (extends the tests added in PR-18/19/20/21/22/23) |

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
| C12 | Public visitor IPs are stored raw in `error_log.client_ip` (and in `context.edgeIp`) | Hashing them needs a salt SECRET to be worth anything — an unsalted hash of an IPv4 is 2^32 to reverse — so it is a deployment step (`wrangler secret put`) plus a fallback path, not a code-only change. Split out of PR-22 to keep the authenticity fix reviewable | Own PR, with the retention window, before W3 |
