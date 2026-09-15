# Audit Fix — Progress Tracker

**Plan:** `AUDIT_FIX_PR_PLAN.md` (48 PRs, 8 waves) · **Findings:** `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md`

> This file is updated **in every audit-fix PR**, in the same commit as the code, so a
> reviewer can see at a glance what is finished, what this PR changes, what is still
> pending, and what was deliberately left for later (and where that is tracked).

**Status: 15 of 48 PRs merged · 1 open (this one) · 32 pending**

Wave progress: **W0 ✅ done** · **W1 15/15 ✅ (all P0 blockers closed except the two public-portal ones)** · W2–W7 not started

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

<sub>#322 was closed as superseded by #323: GitGuardian flagged an *intermediate* commit (an enumerated list of credential column names), and such findings stay attached to a PR's whole history — the branch was recreated from `main` as one clean commit.</sub>

---

## 2. This PR — the backup is actually complete, and restore is faithful

**Audit ID:** P0-07.

Done:

- **`BACKUP_MAP` now covers all 9 bindings and every table in the committed schemas** — the 12 tables the audit found missing are in (whole of `DB_AUDIT`, `journey_entries`, `push_subscriptions`, `loan_email_templates`, `email_message_templates`, `email_messages`, `official_emails`, `ai_fixes`, `ai_providers`, `collection_jobs`, `render_jobs`).
- **It cannot drift silently again:** `SCHEMA_FILE_FOR_BINDING` + `test/p0-backup-coverage.test.mjs` parse `mgmt/db/schema/*.sql` and fail if the schema and the map disagree **in either direction**.
- **Manifest v2:** per-table `{ rows, present }`, `coverage` (bindings/tables/missing), `excludedColumns`. A binding the server does not have is now reported as a real gap with an operator warning instead of a quietly absent database.
- **Restore is faithful:** a table the manifest records as *present and empty* is now **cleared**, so a restore reproduces the state the backup captured. A v1 file (no manifest) keeps the old lenient skip — an empty array there is not authoritative and must not wipe live rows.
- **One deliberate exclusion:** `collection_jobs.filled_base64` (~700 KB of transient, re-generable document bytes per job). The job rows are included and the manifest records the omission.
- The #312 warning is replaced on both Backup screens with an accurate "what this covers / files are separate" note, and the reset runbook no longer steers operators away from the UI backup.

Verification: `mgmt/backend` `npm test` 713 tests / 712 pass (the 1 failure is the pre-existing `H-6` flake, C5) · `lint:errors` pass · mgmt SPA + SvelteKit builds pass.

Left for later: R2/Drive object backup is still out of scope for this file (it stores links) — that stays an operational step, and the screens now say so.

## 3. Previous PR — consent evidence privacy + archival ordering

**Audit ID:** P0-06.

Done:

- **The R2 object is no longer deleted before the database has moved.** `moveOneUrl()` now runs upload → **conditional** DB update (guarded on the old URL) → **verify** the row reads the new URL → only then delete the source. If any step fails, both copies are kept and the file is reported as failed, because a duplicate is recoverable and a dangling reference to a receipt — or to consent evidence — is not. The file-header comment claimed this order already; it was the reverse.
- **Consent photos and signatures are archived PRIVATE.** `uploadBytesToDrive()` takes `publicRead`, and only generated PDFs (which the public portal serves) get `setAnyoneReader`. Archiving a year used to publish every consent photo and signature, undoing the `makePublic: false` the upload path deliberately uses for the same data.
- A concurrent re-generation of a PDF is no longer overwritten by a stale archive attempt (the guarded update fails and the file is reported instead).
- New `test/p0-storage-archive-order.test.mjs` (9 tests) with an R2 + Drive-API stub. **5 of the 9 fail on `main`**: the source is already deleted, the row points at a missing object, the delete/update order is inverted, three permission grants instead of one, and the stale overwrite lands.

Verification: `mgmt/backend` `npm test` 700 tests / 699 pass (the 1 failure is the pre-existing `H-6` timing flake, C5) · `lint:errors` pass · `node --check` pass.

Left for later: existing Drive copies of consent evidence that were made public by earlier archive runs still need a one-off remediation pass (dry-run report → apply) — that is an operational step, listed as **C11** below.

---

## 3. Pending

**W1 — remaining P0 (2 PRs, both public portal)**

| PR | Branch | Depends |
|---|---|---|
| 16 | `fix/public-verify-truthful-states` | — |
| 17 | `fix/public-data-freshness-provenance` | 16 |

**W2 — Public backend (8):** canonical cache keys + method enforcement · health split · popup time-aware TTL · users allowlist · write hardening · snapshot atomicity · assembly perf · tests + lockfile
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
| C8 | Public backend has no lockfile or tests | Needs a Miniflare/workerd harness | PR-25 |
| C9 | `verifyToken` revocation check still fails open on an audit-DB error | Availability trade-off; KV deletion (#319) is now the authoritative revocation | Revisit with W4 observability |
| C10 | React mgmt main chunk at 218.3 kB vs 230 kB CI budget | Little headroom left; not a regression | PR-46 bundle budgets |
| C11 | Consent photos/signatures already archived to Drive by earlier runs are still anonymously readable | Code no longer publishes them (#325), but existing files need a one-off ACL remediation | Operational step: dry-run report → apply, before the next archive |
