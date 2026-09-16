# Audit Fix — Progress Tracker

**Plan:** `AUDIT_FIX_PR_PLAN.md` (48 PRs, 8 waves) · **Findings:** `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md`

> This file is updated **in every audit-fix PR**, in the same commit as the code, so a
> reviewer can see at a glance what is finished, what this PR changes, what is still
> pending, and what was deliberately left for later (and where that is tracked).

**Status: 32 of 48 PRs merged · 1 open (this one) · 15 pending**

Wave progress: **W0 ✅ done** · **W1 ✅ done (17/17 — every P0 finding is closed)** · **W2 ✅ done (8/8 — every PUB-BE finding is closed)** · **W3 6/7 in progress** · W4–W7 not started

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
| [#338](https://github.com/ashutoshroli/chhath-full-codebase/pull/338) | a lockfile, and the Worker running for real in CI | PUB-BE-08 | First lockfile for `Public/backend`; `miniflare` pinned exactly (it ships workerd, the thing under test); a harness booting the real Worker on D1 built from the committed schema + real KV + real Cache API; 25 integration tests over every action; a separate CI job so `npm test` stays dependency-free. Two documented `overrides` take miniflare's tree to 0 advisories | Every action's contract, not every branch — the unit suites keep that |
| [#339](https://github.com/ashutoshroli/chhath-full-codebase/pull/339) | one byte contract for the PDF batch, enforced at every hop | Render #1, #2, #11 | The 1 MB parser limit made a real bulk run fall back to converting in the Worker — the very limit the offload avoids; per-route limits now DERIVE from a shared contract (the anonymous chat route drops 1 MB → 16 KB); pre-dispatch splitting; ZIP-magic + file-name validation before Drive; an output budget that stops conversion instead of building a callback the Worker rejects. CI runs the service's 89 tests for the first time | Its lockfile (#10) stays with its own PR |
| [#340](https://github.com/ashutoshroli/chhath-full-codebase/pull/340) | operator steps for Waves 0–2 | — | `docs/POST_AUDIT_MANUAL_STEPS.md` §W: W0–W2 add **no migrations**; a deploy ORDER (frontend before Worker, since #335 requires `application/json` on writes); the one new setting (`ALLOWED_ORIGINS` on the PUBLIC Worker); three prerequisite-migration checks; six smoke tests | C11 consent-ACL pass still needs a human |
| [#341](https://github.com/ashutoshroli/chhath-full-codebase/pull/341) | constrain where a provider API key may be sent | Render #6 | `/^https?:\/\//` accepted `http://169.254.169.254`, `http://localhost`, `http://10.0.0.1` and `https://user:pw@host` — and that URL receives the provider's API key as a Bearer token, fetched server-side. Adds a shared shape policy (https only, no credentials, no private/loopback/link-local/CGNAT address, optional allow-list), DNS resolution of **every** returned address on the Render side, `redirect: 'error'`, and enforcement at USE time as well as save time | Setup: optional `AI_PROVIDER_HOST_ALLOWLIST`; check existing `ai_providers` rows for non-https URLs |
| [#342](https://github.com/ashutoshroli/chhath-full-codebase/pull/342) | write to an allowlist, and only where the model was looking | Render #7 | AI GitHub writes were gated by a denylist that returned `false` for `.github/workflows/ci.yml` (code that runs in CI with the repo's secrets) and `package.json` (dependency substitution). Now an allowlist of `src/`/`test/` roots + source extensions, plus the containment that needs no enumeration: the diff may only touch files the model was SHOWN. The CI-retry path no longer silently drops a refused path; branch names are validated | Setup: optional — use a `GITHUB_TOKEN` without `workflows: write` |
| [#343](https://github.com/ashutoshroli/chhath-full-codebase/pull/343) | catch the operator doc up with Wave 3, and fix a miscount | — | §3 said "W3 — 3 left" while listing four; runbook §W gained a Wave 3 subsection (no migrations, optional `AI_PROVIDER_HOST_ALLOWLIST`, a `workflows:write`-less `GITHUB_TOKEN`, and the `ai_providers` non-https query whose key needs rotating) | — |
| [#344](https://github.com/ashutoshroli/chhath-full-codebase/pull/344) | claim the job row before applying a callback | MGMT-BE-02, -03, -04 | The callback's idempotency check was a SELECT with the R2/GitHub side effect between it and the finalising write, so two concurrent callbacks both applied it — a duplicate PDF, or a second pull request. The claim is now the UPDATE; a dead claim is failed rather than retried; jobs whose payload was never stored time out instead of being re-dispatched with the essentials missing; a completed PDF callback bumps `public_data_version` | No migration — `status` is TEXT with no CHECK |
| [#345](https://github.com/ashutoshroli/chhath-full-codebase/pull/345) | count concurrency instead of milliseconds | — | The assembly test I added in #337 asserted on elapsed wall-clock time and failed on a loaded runner, turning #344's CI red for an unrelated reason. It now counts in-flight D1 reads — the question it was really asking, and one that cannot flake | Same defect shape as C5 |
| [#346](https://github.com/ashutoshroli/chhath-full-codebase/pull/346) | record three committee-reported items | — | C14 (a declined/rejected consent notifies nobody — loaner + group, decided with the committee), C15 (no father's name in the contributor picker), C16 (the public portal never shows a father's name, for anyone — a trailing-space key mismatch) | C14 needs the first migration of the effort |
<sub>#332 and #333 were closed as superseded by #334, and #322 by #323: GitGuardian flagged an *intermediate* commit (an enumerated list of credential column names), and such findings stay attached to a PR's whole history — the branch was recreated from `main` as one clean commit.</sub>

---

## 2. This PR — the public chat's limits actually limit

**Audit ID:** Render/offload #8. Fifth W3 PR.

`/public-chat` is anonymous, and every request costs money and provider quota. It had one guard — a per-IP sliding window — and that guard was keyed on **a value the caller writes**:

```js
const xff = headers['x-forwarded-for'].split(',')[0].trim();   // the FIRST hop
```

`X-Forwarded-For` is built by each proxy **appending** the address it received from, so the left-hand entries are whatever the caller claimed and only the rightmost were added by infrastructure we control. Sending a different value per request therefore makes every request a new "IP".

Measured on `main`: **200 requests from one client, each forging a different first hop → 0 were limited**, against a configured ceiling of 15/minute. A limiter keyed on a value the caller chooses is not a limiter; it is a formality.

Done:

- **The IP is read from the right.** With one trusted proxy in front (Render's), the last entry is the address that proxy actually observed. `CHAT_TRUSTED_PROXY_HOPS` (default 1) says how many hops to skip if that changes, and a *wrong* value clamps towards the proxy's own address — which throttles everyone rather than nobody, the safe direction for a limiter.
- **Absolute ceilings, because the per-IP window answers the wrong question.** It catches one greedy caller; it cannot catch total cost, and 200 IPs each politely inside the window still bought 200 model calls. So: a **global concurrency cap** and a **daily token budget**, both checked *before* any provider work, both answering a fast `503` rather than queueing — holding the request open would tie up memory and a connection while the caller waits for something already saturated.
- **The slot is released in a `finally`.** A slot leaked on the error path would saturate the endpoint permanently after a handful of provider failures — exactly when it most needs to still work.
- The budget resets by **UTC day key**, not by a timer, so a process that sleeps through midnight still starts the new day at zero. Unparseable token counts contribute nothing rather than `NaN`.

**An existing test was pinning the vulnerability.** `publicChat.test.mjs` asserted `clientIpFrom` *"prefers the first X-Forwarded-For hop"` — the exact behaviour that made the bypass work. It now asserts the opposite, with the reason recorded.

**Migrations & setup:** **no migration.** Three optional variables, all with defaults that are already the intended posture:

```
CHAT_TRUSTED_PROXY_HOPS = 1        # Render puts exactly one proxy in front
CHAT_MAX_CONCURRENT     = 4
CHAT_DAILY_TOKEN_BUDGET = 200000
```

**Stated limitation, not hidden:** both new counters are **in-process**. Render can run more than one instance, so the effective ceiling is (instances × limit). Making it exact needs a shared store, and the only one this service has is Neon — which PR-32 is already opening for the chat retention work. Putting the shared counter there is better than building a second, throwaway mechanism here.

## Verification

`mgmt/server-render/test/chatAbuseControls.test.mjs` — 15 tests:

| | on `main` | on this branch |
|---|---|---|
| 200 requests, a different forged first hop each | **0 limited** | the window fills |
| three forged left-hand entries, same real client | three distinct limiter keys | one |
| 200 callers each inside the per-IP window | 200 model calls | capped, then fast `503` |
| a day's token spend | unbounded | `503` once the budget is spent |
| a provider failure mid-request | — | the slot is released in `finally` |

Also pinned: no header falls back to the socket address; a hop count larger than the chain clamps to the leftmost; the ceilings are checked *before* `getPublicChatProviders`; and the first-hop read is gone from the guards module.

```
mgmt/server-render: npm test -> 134 passed (119 + 15)
```

---

## 3. Pending

**W3 — Render / AI / chat (2 left):** durable idempotent jobs (deadlines, bounded concurrency, cancellation) · chat privacy + Neon (incl. the SHARED rate/concurrency store deferred from PR-31)
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
| C5 | `H-6 … WITHOUT decoding` test flake (asserts `ms < 250`) | Pre-existing; timing-based, passes in isolation, fails under full-suite load | PR-46 (CI gates). **The same defect shape was introduced by me in #337 and removed in #345** — that assertion now counts concurrency instead of milliseconds, which is what it was really asking |
| C6 | Migration CI only scans `mgmt/db/migration/2026-09-05/` | Older folders have uncovered files; widening it fails today | PR-46 |
| C7 | 160 `svelte-check` warnings in the mgmt SPA | Mostly label association — belongs with the a11y work, then fail-on-warning | PR-40 / PR-46 |
| C9 | `verifyToken` revocation check still fails open on an audit-DB error | Availability trade-off; KV deletion (#319) is now the authoritative revocation | Revisit with W4 observability |
| C10 | React mgmt main chunk at 218.3 kB vs 230 kB CI budget | Little headroom left; not a regression | PR-46 bundle budgets |
| C11 | Consent photos/signatures already archived to Drive by earlier runs are still anonymously readable | Code no longer publishes them (#325), but existing files need a one-off ACL remediation | Operational step: dry-run report → apply, before the next archive |
| C12 | Public visitor IPs are stored raw in `error_log.client_ip` (and in `context.edgeIp`) | Hashing them needs a salt SECRET to be worth anything — an unsalted hash of an IPv4 is 2^32 to reverse — so it is a deployment step (`wrangler secret put`) plus a fallback path, not a code-only change. Split out of PR-22 to keep the authenticity fix reviewable | Own PR, with the retention window, before W3 |
| C13 | `portalData` still materialises whole tables; the other seven sections still read `SELECT *` and filter in JS | Bounding the payload for real means PAGINATING the public contract, which changes all six frontends — a contract decision, not a fix. PR-24 makes the size visible (a section past 20k rows is logged) instead of pretending it is bounded. Truncating a transparency payload was rejected: hiding contributions is worse than a slow page | Contract decision, then its own PR; the row-count log is the trigger |
| C14 | **Consent `declined` / `rejected` sends nothing at all.** `respondConsent` notifies only on `accepted`; `setConsentVerification` notifies only on `verified`. So a loaner is never told his loan is blocked by a guarantor's refusal — he simply waits — the committee is not told either, and the remarks the decliner is *forced* to write (`'Remarks are required in order to Decline.'`) are visible only if someone opens the Consent Review screen. | New `consent_declined_*` / `consent_rejected_*` templates on the existing naming convention, WhatsApp + email. **Recipients (decided with the committee): the LOANER and the GROUP.** Remarks go to the group message; the loaner is told it was declined and by whom, without the raw remark text, which can be blunt — say so if that should change. **Needs a migration** (seed the new template rows) — the first migration since W0 — plus an operator pass to review the wording before it is used. | Own PR, after W3 |
| C15 | **The contributor picker shows no father's name.** `Home.svelte` builds `{ value: ID, label: Name, sub: Village }`; `u["Father's Name"]` is on the row and unused. Village separates the two *Ajay Verma* rows in the reported screenshot (Gardih / Shaharpura) but **two same-name people in the same village are indistinguishable** — which is exactly when the wrong contributor is picked and money is recorded against the wrong person. | Add father's name to the option and to the search text, in every picker sharing `SearchableSelect`. No migration, no setup. | Own PR with C16 |
| C16 | **The public portal never shows a father's name — for anyone.** The public Worker emits the key with a TRAILING SPACE (`fathers_name: "Father's Name "`, inherited from the original sheet headers) and `Public/frontend-v6/src/lib/api/derive.ts:268` reads `"Father's Name"` without it, so `fatherName` is always `''` and `ContributorDetail.svelte`'s `{#if displayFather}` never renders. Found while checking C15; mgmt is unaffected (its alias is exact and its inbound lookup already normalises — see the note at `tableRegistry.js:75`). | Normalise the header lookup on the READ side, not the wire key: changing the key would break any other reader. No migration, no setup. | Own PR with C15 |
