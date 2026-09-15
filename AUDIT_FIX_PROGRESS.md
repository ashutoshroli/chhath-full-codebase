# Audit Fix — Progress Tracker

**Plan:** `AUDIT_FIX_PR_PLAN.md` (48 PRs, 8 waves) · **Findings:** `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md`

> This file is updated **in every audit-fix PR**, in the same commit as the code, so a
> reviewer can see at a glance what is finished, what this PR changes, what is still
> pending, and what was deliberately left for later (and where that is tracked).

**Status: 21 of 48 PRs merged · 1 open (this one) · 26 pending**

Wave progress: **W0 ✅ done** · **W1 ✅ done (17/17 — every P0 finding is closed)** · **W2 4/8 in progress** · W3–W7 not started

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
<sub>#322 was closed as superseded by #323: GitGuardian flagged an *intermediate* commit (an enumerated list of credential column names), and such findings stay attached to a PR's whole history — the branch was recreated from `main` as one clean commit.</sub>

---

## 2. This PR — the public `users` payload stops being a denylist

**Audit ID:** PUB-BE-05, plus the same finding's observation that internal row ids are exposed beyond the one resource that needs them. Fourth W2 PR.

Every section of the portal payload was converted to a column **allowlist** in H-5 except the one built from the most sensitive table in the deployment. `users` was still `SELECT *` followed by a hand-written list of drops — "not email, not whatsapp, not mobile unless committee" — which is the wrong default twice over:

- it already published **`created_by`**, the internal login name of the staff member who entered each member row, to every anonymous visitor. No frontend reads it.
- it **fails open**. Any column added to `users` later ships to the whole internet the moment it exists, with no code change here and nothing to review. That table has already grown twice (`photo` by ADD-COLUMN migration 27, the Hindi name/village/designation set before it); the next addition could as easily be an Aadhaar reference, a date of birth or an address.

Done:

- **An explicit projection, in the SQL and in the response.** `USERS_PUBLIC_COLS` is the eleven columns the public frontend actually reads — it matches `userRow` in `Public/frontend-v6/src/lib/api/schema.ts` field for field — and it drives both the `SELECT` and the row it builds. The row is assembled by iterating the **allowlist**, not the database row, which is what makes it fail closed: a column that appears in the table tomorrow is not part of the loop and cannot be emitted. `created_by` / `email` / `whatsapp` are now simply absent rather than removed, so they cannot come back by someone forgetting a `continue`.
- **`id` is ordered by without being selected.** SQLite can `ORDER BY` a column it does not return, so the internal row id never enters a users row even by accident, and the ordering is byte-for-byte what it was.
- **`mobile` is on the allowlist but stays conditional** — emitted only for committee members, which is the only place the public site renders a number (audit 1.2). Unchanged behaviour, now expressed inside the allowlist instead of as an exception to a wide read.
- **An older deployment still serves a payload.** A deployment that has not applied the `photo` migration would fail the narrow projection outright ("no such column") and take the *entire* portal payload down — worse than the leak being fixed. The narrow read is attempted first and a wide read is the fallback, but the response is built from the allowlist on **both** paths: the fallback changes what is read, never what is sent.
- **Internal row ids are published only where they are load-bearing.** `id` → `__rowIndex` was emitted for all eight sections. Exactly one resource needs it: a collections row's QR record id is `<docType>-<year>-<__rowIndex>`, which is how the Verify screen matches a paper document to its row. Every frontend in the repo — v2, v3, v4, v5, v6 and the retained `Public/frontend` — reads `__rowIndex` from `collections` and from nothing else, so `tableRows` now takes it as an opt-in and only `collections` asks.

New `Public/backend/test/users-projection-and-row-ids.test.mjs` — 18 tests, **12 of which fail on `main`**. The users row in the fixture is the table as it really is, plus a `secret_future_column` standing in for whatever it grows next:

| | on `main` | on this branch |
|---|---|---|
| keys on a public user row | the 11 public headers **+ `Created By` + the unreviewed column** | exactly the 11 |
| a column added to `users` later | published the moment it exists | never emitted |
| the users query | `SELECT * FROM users` | the 11 columns, `ORDER BY id` without returning `id` |
| `__rowIndex` on users / committee / expenses / loans / guarantors / generatedFiles / loanConsents | present on all seven | present on `collections` only |

Also pinned: a committee member's mobile is still published and a plain contributor's is not (including when `id_code` has stray whitespace); a deployment missing `photo` falls back to the wide read and *still* withholds `created_by` and the unreviewed column; and the previously-agreed exclusions (`guarantor_signature`, consent `otp`, collections `UTR`) are still excluded.

Verification: `Public/backend` `npm test` **69/69** (51 + 18) · `mgmt/backend` `npm test` **714/714** · `npm run lint:errors` clean · `node --check` on all 51 Worker files.

Left for later (same wave): the other seven sections still read `SELECT *` and filter in JS. Their allowlists already fail closed, so this is a row-size and clarity improvement rather than a leak, and it belongs with PR-24, which rewrites the same assembly for parallel reads.

---

## 3. Pending

**W2 — Public backend (4 left):**

| PR | Branch | What |
|---|---|---|
| 22 | `fix/public-write-hardening` | Size/shape/rate limits on the public write paths |
| 23 | `fix/public-snapshot-atomicity` | KV last-known-good snapshot written atomically |
| 24 | `perf/public-assembly` | Parallel section reads + single-flight cache fill + post-assembly version re-check |
| 25 | `test/public-backend-harness` | Lockfile + a Miniflare/workerd harness covering every action (extends the tests added in PR-18/19/20/21) |

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
