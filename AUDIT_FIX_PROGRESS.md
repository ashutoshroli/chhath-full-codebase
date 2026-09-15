# Audit Fix — Progress Tracker

**Plan:** `AUDIT_FIX_PR_PLAN.md` (48 PRs, 8 waves) · **Findings:** `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md`

> This file is updated **in every audit-fix PR**, in the same commit as the code, so a
> reviewer can see at a glance what is finished, what this PR changes, what is still
> pending, and what was deliberately left for later (and where that is tracked).

**Status: 22 of 48 PRs merged · 1 open (this one) · 25 pending**

Wave progress: **W0 ✅ done** · **W1 ✅ done (17/17 — every P0 finding is closed)** · **W2 5/8 in progress** · W3–W7 not started

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
<sub>#332 and #333 were closed as superseded by #334, and #322 by #323: GitGuardian flagged an *intermediate* commit (an enumerated list of credential column names), and such findings stay attached to a PR's whole history — the branch was recreated from `main` as one clean commit.</sub>

---

## 2. This PR — the two write paths get an authenticity check

**Audit ID:** PUB-BE-06. Fifth W2 PR.

`logError` and `savePushSubscription` are the only writes on this Worker, they are anonymous by necessity, and they had no authenticity control of any kind. The assumption worth naming is that CORS was one:

> **CORS does not stop a request. It stops the caller reading the response.**

A cross-origin `POST` still arrives and is still executed — the browser only refuses to hand the *reply* to the calling script. For a write the reply is not the point, the row is. And a `POST` with `Content-Type: text/plain` is a CORS **simple request**, so it never even gets a preflight for an origin allow-list to reject. Which meant:

- any page on the internet, or any script anywhere, could insert rows into **`error_log`** — the table the committee reads to find out whether the public site is broken. Polluting it is enough to hide a real fault, and every insert spends the D1 write quota shared with the management API.
- any caller could insert or **reactivate** a `push_subscriptions` row (`ON CONFLICT … active = 1`), so a subscription a visitor had switched off could be turned back on by a third party.
- the stored push `endpoint` was validated by `/^https:\/\//i`, which accepts `https://` alone, `https://localhost/x`, `https://10.0.0.1/x`, `https://user:pw@host/x`. That column is a delivery target the mgmt Worker later POSTs to, so what is written here decides where a future request is sent.
- `logError` answered `200` even when the write failed, so a logger that had stopped working looked exactly like one that was fine.

Done — four controls, cheapest first, all applied **before the body is read** and before any D1 work:

1. **Content-Type must be `application/json`.** This is not decoration: it makes the request non-simple, which *forces* a preflight, which is what gives the origin allow-list any power over a browser caller. `; charset=utf-8` is fine; `text/plain` and `application/x-www-form-urlencoded` — precisely the simple-request types — are `415`.
2. **Origin.** When `ALLOWED_ORIGINS` is configured, a write's `Origin` must be on it. When it is **not** configured, a write must still carry *some* `Origin`: every browser sends one on a cross-origin POST, so a real visitor is unaffected, while the trivial scripted flood that sets none is refused. That is a floor, not a substitute, and `wrangler.toml` now says so where an operator will read it.
3. **A hard body cap** (8 KB for a report, 4 KB for a subscription), checked against `Content-Length` first and then against the bytes actually read — so a lying or absent header cannot get past it.
4. **A shape check per action.** A report needs a non-empty `message`; `page`/`stack`/`context` must be the right type when present. An unparseable body used to be swallowed into `{}` and written as a row with no message, indistinguishable from a real error that had none.

Also:

- **The push endpoint is parsed, not pattern-matched.** `new URL`, then: `https:` only, no embedded credentials, no IP literal (v4 or bracketed v6), no `localhost` / `.local`, and a host with a dot in it. Deliberately a shape check rather than a host allow-list — pinning today's four push services would break a visitor on a browser that adds a fifth, and the endpoint is not a secret. What must be impossible is storing a delivery target that points somewhere internal. An over-long endpoint is now **refused** rather than truncated: trimming a URL to the 500-character cap invents a different URL and stores it as if the visitor had sent it.
- **The status codes tell the truth:** `415` wrong media type, `403` unapproved origin, `413` too large, `400` bad shape (the caller's fault), `429` rate limited, `503` the write failed (ours). A write is `no-store`.
- **The frontends declare JSON.** `Public/frontend-v6` (and v4, v5, and the retained `Public/frontend` and `frontend-v3`) POSTed `logError` with **no** `Content-Type`, which `fetch` sends as `text/plain` — the simple-request case this finding is about. They now send `application/json`. The cost is one preflight per browsing session, amortised by the `Access-Control-Max-Age: 86400` this Worker already sends; a report lost at unload is a report lost, but a writable log is a broken log. The push POSTs already declared JSON.

New `Public/backend/test/write-hardening.test.mjs` — 47 tests. Highlights of what fails on `main`:

| | on `main` | on this branch |
|---|---|---|
| `POST logError` with `Content-Type: text/plain` | row written | `415`, no D1 work |
| the same from `https://evil.example`, with the allow-list set | row written | `403`, no D1 work |
| a 9 KB body, or one with `Content-Length: 10` | row written | `413` |
| `{}` / `not json` / `[1,2,3]` / `null` | written as a blank row | `400` |
| a failed `error_log` write | `200` | `503` |
| endpoint `https://10.0.0.1/push`, `https://user:pw@…`, `https://localhost/push` | stored | `400` |
| a 600-character endpoint | silently truncated to 500 and stored | `400` |

Also pinned: `application/json; charset=utf-8` is accepted, an explicit `ALLOWED_ORIGINS = "*"` keeps the wildcard posture for writes too, the four real push services are accepted and stored byte-for-byte, both the flattened and nested subscription shapes still work, and the **read** paths still need neither an `Origin` nor a `Content-Type`.

Verification: `Public/backend` `npm test` **116/116** (69 + 47) · `mgmt/backend` **714/714** · `frontend-v6` `svelte-check` 0 errors, `npm test` **70/70** · `node --check` on all 51 Worker files and both legacy scripts.

Deliberately **not** added: a challenge/nonce endpoint, which the report suggests. It costs a second round-trip and a KV write per opt-in against the ~1,000/day budget this file already treats as scarce, and it cannot authenticate an anonymous visitor anyway — anything the page can fetch, a script can fetch. The controls above raise the cost of abuse without pretending to solve attribution.

---

## 3. Pending

**W2 — Public backend (3 left):**

| PR | Branch | What |
|---|---|---|
| 23 | `fix/public-snapshot-atomicity` | KV last-known-good snapshot written atomically |
| 24 | `perf/public-assembly` | Parallel section reads + single-flight cache fill + post-assembly version re-check |
| 25 | `test/public-backend-harness` | Lockfile + a Miniflare/workerd harness covering every action (extends the tests added in PR-18/19/20/21/22) |

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
