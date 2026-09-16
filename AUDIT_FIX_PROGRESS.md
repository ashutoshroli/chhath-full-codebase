# Audit Fix — Progress Tracker

**Plan:** `AUDIT_FIX_PR_PLAN.md` (48 PRs, 8 waves) · **Findings:** `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md`

> This file is updated **in every audit-fix PR**, in the same commit as the code, so a
> reviewer can see at a glance what is finished, what this PR changes, what is still
> pending, and what was deliberately left for later (and where that is tracked).

**Status: 26 of 48 PRs merged · 1 open (this one) · 21 pending**

Wave progress: **W0 ✅ done** · **W1 ✅ done (17/17 — every P0 finding is closed)** · **W2 ✅ done (8/8 — every PUB-BE finding is closed)** · **W3 1/7 in progress** · W4–W7 not started

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
<sub>#332 and #333 were closed as superseded by #334, and #322 by #323: GitGuardian flagged an *intermediate* commit (an enumerated list of credential column names), and such findings stay attached to a PR's whole history — the branch was recreated from `main` as one clean commit.</sub>

---

## 2. This PR — one byte contract for the PDF batch, enforced at every hop

**Audit ID:** Render/offload #1 and #2 (plus #11, brought forward — see below). **First W3 PR.**

`pdf_convert_batch` is the one render job that carries real bytes: up to twenty filled `.docx` files out, the same number of PDFs back. Nothing agreed on how many bytes that was allowed to be, and the disagreement was load-bearing in four separate places.

### The 1 MB parser limit made the offload counter-productive

`server.js` parsed **every** request with `express.json({ limit: '1mb' })`, under a comment stating that payloads "carry references + small text (error/diff), never big blobs". That is true of the AI jobs and simply false of this one.

A real bulk run of twenty documents is over 1 MB once base64 has added its third, so body-parser rejected it **before the router ran**. `createAndDispatchJob` saw a failed dispatch, and the Worker's `!dispatch.success` branch then converted **the entire batch itself** — which is precisely the CPU and subrequest limit this offload service exists to stay under.

The shape of the failure is what makes it worth naming: **small batches worked**, so the endpoint looked healthy, and only the large runs fell into the path most likely to take the Worker down.

### Nothing capped the batch, the item, or the result

Measured on `main`, with Drive stubbed:

| | on `main` | on this branch |
|---|---|---|
| a PDF submitted as a `.docx`, named `../../escape.docx` | **`ok: true`** — uploaded to Drive, converted, stored under that name | refused, **0** Drive calls |
| 100 items in one batch (documented limit: "~20") | all 100 accepted, **100** Drive conversions | refused before any Drive call |
| ten records producing 2 MB PDFs | callback body **26.7 MB** — rejected by the Worker's 10 MB cap, so all ten conversions are thrown away | **8.0 MB**, three records kept, `truncated: true`, and only 3 conversions spent |

`Buffer.from(x, 'base64')` **silently discards** anything that is not base64, so garbage decoded to shorter garbage and was uploaded to Drive as a document. And every PDF was accumulated in memory and serialised into one callback, which is how a batch could succeed here, cost twenty Drive conversions, and be discarded on arrival.

Done:

- **One contract, stated in bytes** (`renderContract.js` / `batchContract.js`): items per batch, bytes per item, bytes per batch, the wire limit, and per-item and per-batch **output** budgets. The output total is chosen so a full batch's PDFs, base64-expanded, fit inside the Worker's own 10 MB body cap with room for the JSON around them.
- **The Express limits are derived from it, per route.** One global parser was also the wrong shape: it forced the same allowance on an authenticated job intake that legitimately carries megabytes and on an anonymous browser endpoint carrying one short question. The chat route is now capped at **16 KB — tighter than the old 1 MB** — and the job intake gets what its contract needs.
- **Pre-dispatch splitting.** `planBatches` splits by the same limits Render enforces on arrival, so a dispatch can no longer be the thing that breaks the contract. A document too big for *any* batch is reported per record rather than sinking the run it is part of, and a batch that *was* accepted is no longer also converted locally — that would have produced the same file twice.
- **Items are validated before Drive is touched:** base64 alphabet, the ZIP local-file-header magic (`PK\x03\x04` — a `.docx` is a ZIP; `PK\x05\x06` and `PK\x07\x08` are an empty and a spanned archive and are refused), and a file name that cannot escape its directory, since that name reaches Drive and comes back as the stored PDF name the Worker turns into an R2 key.
- **Conversion STOPS when the output budget is spent**, rather than continuing to spend Drive quota on bytes that cannot be delivered. The remaining records come back with a reason, and `truncated: true` tells the bulk screen why a run was partial.

### CI now runs the Render service's tests

Audit Render/offload **#11**: the service has had 89 tests and CI has never run them, so nothing stopped a change to the Worker/Render contract from breaking a service that deploys separately and auto-deploys. The plan assigns this to PR-46, but half of this contract is enforced *there* — a test nobody runs is documentation, so the job is brought forward. Its lockfile (#10) is a separate finding and stays with its own PR; the job uses `npm install`, which is what Render itself resolves today.

## Verification

- `mgmt/server-render/test/batchContract.test.mjs` — 17 tests.
- `mgmt/backend/test/render-batch-contract.test.mjs` — 11 tests, including a **drift guard**: the contract block is delimited by markers and must be byte-identical in both copies. The two deployments share no code by design, so duplication is the pattern (as with the public Worker's column maps) and the test is what makes it safe. It also asserts the `'1mb'` literal is gone from the *code* — comments are stripped first, so deleting the explanation cannot satisfy it.
- One existing fixture was corrected: `pdfConvertBatch.test.mjs` used `base64: 'UEsDBok'`, which decodes to `PK\x03\x06` — not a ZIP header at all. It now uses real `.docx` magic. Its intent (per-record failure isolation) is unchanged.

```
mgmt/backend:       npm test -> 725 passed (714 + 11) · lint:errors clean
mgmt/server-render: npm test -> 106 passed (89 + 17)
Public/backend:     npm test -> 145 passed (unaffected)
node --check        -> OK across both Workers and the Render service
```

Left for later in W3: the durable/idempotent job store, deadlines and bounded concurrency are PR-27; the `dispatched → applying` claim and the callback outbox are PR-28. This PR deliberately changes only how many bytes move, not when or how often.

---

## 3. Pending

**W3 — Render / AI / chat (6 left):** durable idempotent jobs · callback outbox + version bump · provider SSRF policy · AI write allowlist · chat abuse controls · chat privacy + Neon
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
