# Senior Web QA, Security & Development Audit Report

**Repository:** `ashutoshroli/chhath-full-codebase`  
**Audited commit:** `a4cae6a` (`main`)  
**Audit date:** 15 September 2026  
**Scope:** `Public/backend`, `Public/frontend-v6`, and complete `mgmt` suite (`backend`, `frontend-svelte`, retained React `frontend`, `server-render`, D1/Neon schemas and migrations)  
**Perspective:** Senior web tester, backend/frontend developer, security reviewer, accessibility reviewer, and release assessor

## 1. Executive verdict

### Overall decision: **Management financial workflows ke liye NO-GO; public portal ke liye conditional release**

Codebase mein kaafi strong engineering controls aur large backend regression suite hai, lekin green build/tests ko production safety ka proof nahi maana ja sakta. Audit mein ek verified **Critical** transactional defect aur multiple **High** financial-integrity, privacy, authorization-boundary, recovery, caching, PWA, accessibility, and concurrency defects mile.

| Area | Current assessment | Release verdict |
|---|---|---|
| Public backend | Resilient cache/snapshot design, but cache abuse, health amplification, privacy projection, write authenticity, and scale problems | **Conditional / high-risk under abuse or growth** |
| Public frontend-v6 | Builds cleanly; shared architecture strong; freshness, verification, a11y, SEO, hydration, and push-navigation defects | **Conditional; WCAG/SEO claims not ready** |
| Management backend | Very strong regression suite, but loan/consent transaction, concurrency, queue trust, logout, archival, Render, and backup blockers | **NO-GO for loan/financial changes until P0 fixes** |
| Management Svelte SPA | Build passes, but 160 compiler/a11y warnings, PII cache leakage, bearer storage, weak validation/concurrency, inaccessible controls | **NO-GO for broad rollout without P0/P1 fixes** |
| Render service | Tests pass; job execution is not durable/idempotent, payload contract conflicts, SSRF and privacy risks | **Do not rely on it for irreversible jobs yet** |
| Backup/restore and migrations | “Full backup” is incomplete; live constraints/migrations are not reliably reproducible | **Do not treat UI backup as disaster-recovery guarantee** |
| Retained React rollback | Builds, but no behavioral tests, env validation gap, advisories, token storage, and drift | **Buildable, not security-qualified rollback** |

### Verified severity summary

- **Critical:** 1 verified issue.
- **High:** Multiple verified issues across all three main surfaces.
- **Medium/Low:** Extensive accessibility, observability, retention, migration, offline, dependency, SEO, and maintainability debt.
- **No simple unauthenticated management CRUD bypass or direct public frontend XSS was found** in static review.

## 2. Audit method and evidence meaning

The audit combined:

1. Full static execution-path review of source, configs, routes, schemas, migrations, tests, and deployment files.
2. Authentication/RBAC/CSRF/CORS/session trust-boundary tracing.
3. Financial workflow, concurrency, partial-failure, idempotency, and disaster-recovery review.
4. WCAG 2.2 AA-oriented static accessibility review across public skins and management workflows.
5. SEO, PWA, caching, offline, privacy, performance, and responsive-design review.
6. Existing test/check/build execution using Node 22.
7. Production dependency audit using `npm audit --omit=dev`.

**Verified** means behavior directly follows from source or command output. **Conditional risk** means exploitability/impact depends on deployed secrets, live infrastructure, traffic, schema state, provider behavior, or data volume.

No production deployment, live database, real payment/loan mutation, real push/email/WhatsApp delivery, or external provider side effect was executed.

## 3. Architecture summary

- `Public/backend`: single Cloudflare Worker, query-action API, D1/KV/Cache API, public snapshots, portal aggregate payload, popup and push/error write endpoints.
- `Public/frontend-v6`: SvelteKit 2/Svelte 5 static PWA with five structural skins, shared Zod/API/derive/store layer, Workbox, push worker, chatbot, English/Hindi UI.
- `mgmt/backend`: Cloudflare Worker with large action router, cookie/body-token auth, CSRF, 2FA, D1/KV/R2/Drive, finance/loan/consent workflows, queues, Render callbacks, AI/GitHub, backup/restore, retention and cron.
- `mgmt/frontend-svelte`: current SvelteKit static management SPA.
- `mgmt/frontend`: retained React/Vite rollback SPA.
- `mgmt/server-render`: Express service for AI/GitHub/PDF/public-chat offload.
- `mgmt/db`: nine D1 schemas, dated/manual migrations, cleanup operations, and Neon chatbot schema.

## 4. Executable verification results

| Target | Commands/result |
|---|---|
| Public backend | `node --check src/index.js` — **pass** |
| Public frontend-v6 | `svelte-check` — **0 errors, 0 warnings**; Vitest — **46/46 pass**; production build — **pass** |
| Mgmt backend | Node tests — **610/610 pass**; typed-error lint — **pass**; syntax — **pass** |
| Mgmt Svelte | `svelte-check` — **0 errors, 160 warnings across 38 files**; Vitest — **6/6 pass**; build — **pass** |
| Retained React | Vite production build — **pass**, with static/dynamic import chunking warnings |
| Server-render | Node tests — **89/89 pass** |

### Dependency audit

- Public frontend-v6 production dependencies: **0 known advisories**.
- Mgmt backend production dependencies: **0 known advisories**.
- Server-render production dependencies: **0 known advisories**.
- Mgmt Svelte: **7 production-tree advisories** reported (3 low, 3 moderate, 1 high), primarily old SvelteKit/Vite toolchain paths.
- Retained React: **3 production-tree advisories** (2 moderate, 1 high), including `@xmldom/xmldom` and React Router paths.
- Server-render has **no committed lockfile**, so deployments are not reproducible even though its current installed tree audited clean.

> Important: all existing tests passing does not invalidate the findings below. Several high-risk cases have no concurrency, partial-failure, browser, or Cloudflare-runtime test.

# 5. Release blockers (P0)

## P0-01 — CRITICAL: Loan is committed before all required consent records

**Evidence:** `mgmt/backend/src/loans.js:139-280`, consent creation at `:372-470`.  
Loan + guarantors are committed first. Consent records are inserted afterward. Consent insertion failure can still return `success:true`.

**Impact:** Financially committed loan may have zero-to-three consent/legal approval records, and resend cannot recreate a missing consent because it requires an existing `consent_id`.

**Required fix:** Prepare loan, three guarantors, and all four consent inserts before mutation and commit them in one D1 batch/transaction boundary. Send notifications only through an idempotent post-commit outbox. Add failure-injection tests for each consent insert.

## P0-02 — HIGH: Concurrent loans can oversubscribe yearly funds

**Evidence:** budget read/check at `mgmt/backend/src/loans.js:122-195`; insertion later at `:224-249`.  
Two requests can read the same available balance and both commit.

**Impact:** Direct financial-integrity violation.

**Required fix:** Maintain an atomic year-level reservation/balance inside the loans database, or serialize by year via Durable Object. Add parallel request tests.

## P0-03 — HIGH: Collection queue trusts fabricated client snapshots

**Evidence:** `mgmt/backend/src/collectionQueue.js:56-151,338-390`.  
A staff client can submit an allowed-looking record ID plus arbitrary payload/base64 without the server reloading and binding it to a committed collection row.

**Impact:** Fabricated receipts/documents and outbound WhatsApp/email can be generated as system actions.

**Required fix:** Accept only stable collection ID/output kind. Server must load authoritative data, verify stored year/access/revision, derive payload and record ID, and use idempotency keys.

## P0-04 — HIGH: Collection jobs can be processed twice

**Evidence:** `mgmt/backend/src/collectionQueue.js:277-304`.  
Claim predicate accepts both `pending` and `processing`, without matching the observed state/stale timestamp.

**Impact:** Duplicate PDFs, messages, emails, attempt increments and conflicting finalization.

**Required fix:** Atomic claim token with exact state/cutoff predicate; process only after claim-token reread. Add concurrent-drain test.

## P0-05 — HIGH: Cookie-only logout does not revoke the actual server session

**Evidence:** effective cookie token is accepted by auth, but logout passes body token to `doLogout`; see `mgmt/backend/src/auth.js:526-545,820-829` and logout routing in `mgmt/backend/src/index.js`.

**Impact:** Browser cookie is cleared, but replayed/stolen token remains valid for its TTL, potentially 30 days.

**Required fix:** Revoke `req.token || req.__cookieSessionToken`; test cookie-only login → logout → token replay rejection.

## P0-06 — HIGH: Archival deletes R2 before DB references are safely updated and republishes consent evidence

**Evidence:** `mgmt/backend/src/storage.js:18-59,119-164`; original private consent fallback in `mgmt/backend/src/loans.js:27-49`.

**Impact:** DB-update failure leaves broken links after source deletion. Archived consent photos/signatures become anonymous-reader Drive files.

**Required fix:** Upload → conditional DB update → verify → delete source. Use retryable migration state. Never set public ACL on consent evidence; use authenticated/signed access and retention.

## P0-07 — HIGH: “Full backup” is incomplete and empty-table restore is not faithful

**Evidence:** stale map in `mgmt/backend/src/backup.js:33-67,311-356`; nine live bindings in `mgmt/backend/wrangler.toml:145-202`.

Missing coverage includes `DB_AUDIT` and current tables such as sessions/login attempts, journey, push, newer email/official-mail, AI/provider, collection jobs and Render jobs.

**Impact:** Disaster recovery silently loses important state. An intentionally empty backup table may leave stale live rows untouched.

**Required fix:** Mark current UI backup as incomplete immediately. Generate a versioned manifest from authoritative schemas, enforce schema-vs-backup coverage in CI, include all nine DBs, distinguish read failure from intentionally empty, and independently back up R2/Drive.

## P0-08 — HIGH: Management browser cache can leak PII to the next account

**Evidence:** generic localStorage cache in `mgmt/frontend-svelte/src/lib/cache.ts:19-72`; logout clears session keys but not cached data in `src/lib/api.ts:59-65`; cached view serves before validation in `src/lib/viewData.ts:28-55`.

**Impact:** A lower-privilege or different account on the same browser can briefly or persistently see previous-account cached users, login metadata, phone/email, finance and administrative data.

**Required fix:** Do not persist sensitive management payloads. At minimum, namespace by immutable account+role+security version and synchronously purge memory/localStorage on logout, auth failure, account switch and role change before rendering.

## P0-09 — HIGH: Financial amount validation accepts negative or malformed values

**Backend evidence:** `mgmt/backend/src/crud.js:125-257`, `mgmt/backend/src/tableRegistry.js:99-137`, `mgmt/backend/src/loans.js:154-180`.  
**Frontend evidence:** `mgmt/frontend-svelte/src/lib/views/Home.svelte:166-174,464-466`, `Expenses.svelte:57-63,132-135`, `Loans.svelte:110-140`.

**Impact:** Negative expense can inflate surplus; negative/malformed collection or loan can corrupt totals and capacity. Missing year can bypass year rules. Broad snake_case acceptance can expose server-owned columns.

**Required fix:** Shared strict action schemas; required supported year; finite positive decimal with fixed precision/max; exact per-table allowed keys; reject server-owned fields; enforce D1 `CHECK`, `NOT NULL`, unique and relationship constraints.

## P0-10 — HIGH: Public verification can show false “Record Not Found” during failure/stale state

**Evidence:** `Public/frontend-v6/src/lib/components/VerifyContent.svelte:25-96`; store failure behavior in `src/lib/stores/portal.ts:20-79`.

**Impact:** A valid record can be declared invalid when API is down, first visit is offline, or snapshot is stale.

**Required fix:** Separate malformed ID, service unavailable, stale/provisional result and authoritative current “not found.” Never display a negative verdict without a successful current lookup.

# 6. Public backend detailed findings

## High

### PUB-BE-01 — Cache-key bypass on expensive reads
`Public/backend/src/index.js:917-934,1185-1240,1287-1349` keys cache by full attacker-controlled URL. Unique irrelevant query parameters force repeated full D1 builds.

**Fix:** Canonical internal cache keys from fixed action + server version; reject unknown parameters; add single-flight and edge limits.

### PUB-BE-02 — Read routes accept POST/PUT/DELETE
`Public/backend/src/index.js:1057,1124-1182,1185-1369` does not enforce methods for data reads. Non-GET requests can miss intended cache behavior.

**Fix:** Explicit action→method map and 405/`Allow` responses.

### PUB-BE-03 — Health endpoint is an unthrottled multi-database amplifier
`Public/backend/src/index.js:1055-1120` probes up to six D1 databases plus KV before rate limiting.

**Fix:** No-I/O liveness; protected/cached readiness; dedicated WAF limit.

### PUB-BE-04 — Scheduled popups are cached immutable for one year
Eligibility is time-dependent at `Public/backend/src/index.js:593-656`, but versioned response is immutable at `:1326-1367`.

**Impact:** Future popup can stay hidden; expired popup can stay visible.

**Fix:** TTL to nearest schedule boundary, bounded time bucket, or scheduled version bump/purge.

### PUB-BE-05 — Public users projection is denylist-based
`Public/backend/src/index.js:88-115` uses `SELECT *` and removes only selected fields. New sensitive columns automatically leak.

**Fix:** Explicit SQL and response allowlist; documented consent/data-minimization review.

### PUB-BE-06 — Anonymous cross-origin write ingestion has no authenticity control
`Public/backend/src/index.js:1014-1038,1124-1146`; wildcard-by-default deployment posture in `Public/backend/wrangler.toml:5-10`.

**Impact:** Error-log pollution and arbitrary push-subscription insertion/reactivation.

**Fix:** Enforce approved Origin for browser writes, require JSON/schema/body limit, add short-lived challenge/nonce and edge rate limits. CORS alone is insufficient.

### PUB-BE-07 — `portalData` is an unbounded full-database materialization
`Public/backend/src/index.js:14-31,371-411,1224-1260` loads and serializes complete tables.

**Fix:** Paginate/filter/lazy-load sections, explicit projections, hard response limits and bounded resource caches.

## Medium/Low

- D1 budget accounting undercounts real rows/queries and omits health/version/SEO/write paths: `src/index.js:269-289,1287-1367`.
- KV rate/budget counters are sampled, non-atomic, eventually consistent and fail open: `:210-239,269-280`.
- Snapshot publication is non-atomic and uses character count instead of UTF-8 bytes: `:308-351`.
- Immutable payload can be a torn view across multiple databases because version is read only before assembly: `:371-411,1185-1237`.
- Restricted-CORS responses are cached without correct origin partitioning: `:952-967,1014-1033`.
- Cache fills have no single-flight protection and portal assembly is serial: `:371-411,917-967`.
- Push endpoint truncates rather than rejects and accepts arbitrary HTTPS endpoints: `:711-748`.
- Error ingestion accepts malformed/large/junk data, has race-prone quotas, stores raw IP/context, and may return HTTP 200 on internal failure: `:762-837,1122-1134`.
- Version failures collapse to valid-looking version `0`: `:856-864`.
- Public health leaks truncated dependency errors and can misclassify optional failure: `:1062-1106`.
- Popup malformed dates fail open and reads scan all rows: `:593-656`.
- Internal row IDs are exposed beyond the one resource that needs them: `:18-24`.
- Backend has no local tests, lockfile, lint or integration harness; only syntax is checked by CI.

# 7. Public frontend-v6 detailed findings

## High

### PUB-FE-01 — Cached API fallback is mislabeled as fresh live data
Workbox uses NetworkFirst with six-second timeout/24-hour cache at `Public/frontend-v6/vite.config.ts:93-111`. Client marks any usable 200 as freshly saved at `src/lib/api/client.ts:68-127`.

**Fix:** Remove SW API caching or preserve network/cache provenance and server-issued version/timestamp. Never refresh `savedAt` for cache fallback.

### PUB-FE-02 — All five skins and roughly forty page implementations are eagerly reachable
`Public/frontend-v6/src/lib/skins/registry.ts:8-19` and each skin index statically import every page. Build evidence includes large shared chunks (approximately 260 KB and 144 KB uncompressed) and 4,200+ transformed modules.

**Fix:** Route-aware lazy imports; stable shell; load active skin/page only; add compressed public bundle budget.

### PUB-FE-03 — Saved structural skin can mismatch SSR/hydration
Default SSR theme and localStorage client theme differ in `src/lib/stores/theme.ts:25-37`.

**Fix:** Keep structural shell stable through hydration, make structural skin client-only behind reserved placeholder, or use server-readable cookie/dynamic rendering.

### PUB-FE-04 — Dialogs lack complete keyboard/focus behavior
Shared modal and other overlays lack initial focus, focus trap, inert background and reliable focus restoration: `src/lib/components/Modal.svelte:15-58`, `ContributorDetail.svelte:25-50`, `AnnouncementPopup.svelte:101-193`, `MoreMenu.svelte:121-214`, `Chatbot.svelte:91-146`.

**Fix:** One audited dialog primitive with `aria-labelledby`, Escape, Tab trap, inert/scroll lock and return focus.

### PUB-FE-05 — Focusable controls are inside `aria-hidden`
`src/lib/components/LiveScroll.svelte:33-37,116-125` duplicates contributor cards, while `ContributorCard.svelte:31-39` renders buttons.

**Fix:** Duplicate only noninteractive visual content or use `inert` plus non-focusable descendants.

### PUB-FE-06 — Initial prerender shows zero/empty instead of loading
Portal starts `idle` and loads only in client mount: `src/lib/stores/portal.ts:20-34`; `src/routes/+layout.svelte:42-65`.

**Impact:** Misleading financial first paint, layout shift and poor no-JS/crawler output.

**Fix:** Treat idle as loading, reserve dimensions, and use a safe build/server snapshot if financial SEO is required.

### PUB-FE-07 — Primary colors and focus ring fail contrast
Brand tokens in `tailwind.config.ts:15-35`; controls/focus in `src/app.css:241-263`. White on primary orange is below AA for normal text; brand focus ring is below 3:1 against white.

**Fix:** Dedicated tested text/background/focus tokens across every theme.

### PUB-FE-08 — Every route canonicalizes/shares as home
`src/routes/+layout.svelte:68-72` emits site root canonical. `src/app.html:20-34` hardcodes home social metadata.

**Fix:** Path-specific canonical, title, description, OG/Twitter URL/content, structured data and sitemap assertions.

## Medium/Low

- Notification push/inbox URLs are not truly same-origin constrained; protocol-relative and arbitrary HTTP(S) can navigate: `static/push-sw.js:163-215`, `NotificationsView.svelte:44-51,122-126`.
- Background refresh hardcodes production API and ignores configured deployment: `static/push-sw.js:257-273`.
- Rotated subscriptions may never be persisted when no page is open: `push-sw.js:292-329`, `src/lib/push.ts:48-115`.
- API/chat requests have no timeout; overlapping refreshes can overwrite newer data: `src/lib/api/client.ts:68-72`, `stores/portal.ts:38-69`, `sync.ts:43-62`, `Chatbot.svelte:47-74`.
- Privacy notice does not fully disclose chatbot, telemetry, push, local cache, Google Fonts, retention or deletion behavior.
- CSP is useful but uses inline script/style and hardcoded production origins; non-Vercel hosting may receive no equivalent headers.
- Worker helper update/cache policy and update UX are incomplete.
- Popup suppression is one global timestamp rather than popup ID/revision.
- Route sitemap omits `/donate`, `/guide`, `/decade`; SPA fallback risks soft 404: `static/sitemap.xml`, `svelte.config.js`.
- Heading hierarchy differs across skins; most home variants and many Classic routes lack page-specific `h1`.
- No skip link; multiple search fields have placeholder-only accessible names.
- Chat/loading/slide changes are not consistently announced.
- Announcement carousel lacks pause/play and image alt contract.
- Hindi mode contains substantial mixed English/hard-coded labels.
- Contributors/decade/notification discovery varies by skin/device.
- Classic mobile header and fixed nav lack robust narrow-width/safe-area behavior.
- Financial decade grids lack table semantics.
- Festival shell contains invalid `rgb(#hex)` style usage.
- Manifest is English-only, portrait-locked and uses generated placeholder screenshots.
- No browser/E2E/axe/visual/PWA test suite exists.

# 8. Management backend detailed findings

## High findings beyond P0

### MGMT-BE-01 — Multi-step loan operations are non-atomic
`mgmt/backend/src/loans.js:1027-1251`: resend revokes/rotates before delivery prerequisites; guarantor replacement performs separate mutations; disbursement uses read-then-unconditional-update.

**Fix:** Validate first, conditional atomic updates/batches, event idempotency and transactional outbox.

### MGMT-BE-02 — Render callback idempotency is only sequential
`mgmt/backend/src/renderJobs.js:188-260`: concurrent callbacks can both observe dispatched state and apply side effects.

**Fix:** Atomic `dispatched → applying` claim and changed-row check; callback digest/result ID; explicit stale-apply recovery.

### MGMT-BE-03 — Reconciliation retries jobs without reconstructable payload
`mgmt/backend/src/renderJobs.js:136-163,282-374`; metadata-only batch PDF/provider jobs omit required bytes/secrets.

**Fix:** Store encrypted/TTL payload reference privately, make Render durable and idempotent, or mark non-reconstructable jobs non-retriable.

### MGMT-BE-04 — Async PDF callback does not bump public data version
Router bump occurs at dispatch, while actual file index mutation happens in callback. See `mgmt/backend/src/docxTemplates.js:464-504,614-666` and `renderJobs.js:199-294`.

**Impact:** Public portal can stay stale after generated document completion.

### MGMT-BE-05 — 2FA one-time factors are replayable under concurrency
Backup code read/remove and TOTP verification are not atomic/replay-tracked: `mgmt/backend/src/twoFactor.js:254-315`, `totp.js:125-144`.

### MGMT-BE-06 — Push fan-out exceeds Worker execution model
`mgmt/backend/src/push.js:46-56,198-221` schedules up to 2,000 sends in one invocation; `waitUntil` does not create separate invocation budgets.

**Fix:** Durable queue/cron batches with delivery idempotency and per-recipient state.

## Medium/conditional findings

- Superadmin password policy differs between reset/add/change paths: `account.js:9-13,60-119,178-204`; `passwordReset.js:103-120`.
- Body cap is checked after full buffering and by JS characters, not bytes: `index.js:543-566`.
- Audit trail does not uniformly cover security/financial/backup/provider/storage/send mutations.
- Resend/GitHub/error escalation have replay/partial-recipient idempotency gaps.
- Retention misses failed blobs, Render/AI, official mail, replaced objects and other stores.
- KV rate limits are get-then-put, eventually consistent and fail open.
- Session role/revocation can fail open during D1 outage.
- Consent evidence may already use publicly reachable R2 URL depending on bucket/custom-domain policy.
- Inbound email HTML is stored unsanitized server-side; current Svelte display sanitization helps, but server defense is still recommended.
- Query-string webhook secrets and raw reset/OTP storage increase operational leakage risk.
- Most outbound provider calls lack explicit deadlines/idempotent retry policy.
- Readiness does not cover every critical binding/feature; no Wrangler dry-run, broad lint/typecheck, coverage gate or deployed contract test.

## Strong backend controls

- PBKDF2 password hashing, dummy work for unknown users and constant-time comparisons.
- Hashed session KV keys and non-replayable token hashes in audit storage.
- HttpOnly/Secure/SameSite cookie migration, double-submit CSRF, and fail-closed allowed-origin behavior.
- Google audience/issuer/expiry/verified-email validation and no self-registration.
- Strong sheet/RBAC allowlists and stored-year checks for standard CRUD.
- Atomic ID allocation and selected D1 batches.
- Central decoded-size caps, base64 validation and image/DOCX magic checks.
- Queue terminal guards/retry caps and stronger claim-token behavior in WhatsApp queue.
- HMAC/constant-time webhook verification, AES-GCM provider-key encryption and auto-merge disabled by default.
- 610 passing backend tests provide meaningful regression value.

# 9. Management Svelte SPA findings

## High

- **Bearer credentials in localStorage/sessionStorage:** `mgmt/frontend-svelte/src/lib/api.ts:9-44`; remember-me defaults true in `components/Login.svelte:20-22,145-149`. Prefer cookie-only auth so JavaScript never sees long-lived bearer tokens.
- **No optimistic concurrency / mutable row index identifiers:** `src/lib/api.ts:330-342`; stale cache and year-lock state can overwrite or target changed records. Use immutable IDs + revisions/ETags and backend 409 conflict handling.
- **Previous year contributors remain after failed loan-year fetch:** `src/lib/views/Loans.svelte:47-89`. Clear before load, generation-check response and block issue flow on failure.
- **Popup/push URL policy differs between preview and real delivery:** `PopupManagement.svelte:151-161,307-326`, `LoginPopups.svelte:95-98`, `PopupSlideshow.svelte:30-36,104-108`, `CustomNotification.svelte:7-45`.
- **Shared Modal lacks dialog semantics/focus/keyboard behavior:** `src/lib/components/Modal.svelte:12-24`.
- **SearchableSelect and many clickable div/span controls are mouse-only:** `src/lib/components/SearchableSelect.svelte:39-68` and multiple CRUD/template/mail rows.

## Medium/Low

- Viewport disables zoom; global focus outline is removed without adequate replacement; primary orange contrast is poor: `src/app.html:5`, `src/lib/styles.css:40-61`.
- Login announcements auto-advance without keyboard/touch pause or reduced-motion handling.
- Large image/DOCX/CSV/ZIP files are fully read client-side without consistent caps; ZIP bomb and tab-freeze risk.
- CSV exports do not neutralize spreadsheet formulas.
- General API calls lack timeout/abort; stale responses can win.
- API auth expiry clears storage but does not clear live Svelte session state.
- Initial forbidden/unknown hash is not normalized and can render blank content.
- Multi-database restore is sequential and not atomic/resumable.
- Donation settings are saved one by one without atomic validation/publish.
- AI provider UI permits insecure HTTP base URLs.
- Dynamic errors/success/loading and labels are inconsistently announced/associated.
- Global cache can present five-minute-old administrative data as current, with no universal stale/offline badge.
- CSP is report-only and broad; missing/invalid API URL does not fail with a clear config screen.
- Error Log is advertised in navigation but not mounted in current Svelte shell; retained React app does mount it.
- Automated frontend coverage is only 6 helper tests; there is no role/session/workflow/browser/a11y/E2E suite.
- Executed `svelte-check` confirmed **160 warnings across 38 files**, mainly label association and reactive-state capture warnings. CI currently allows these warnings.

# 10. Server-render, database, and rollback findings

## Render/offload

1. **1 MB Express JSON cap conflicts with base64 PDF-batch contract:** `mgmt/server-render/src/server.js:10-11`; frontend batches and Worker dispatch can exceed this after base64 expansion.
2. PDF batch has no item/aggregate/output cap, accumulates all base64 results, and does not strongly validate decoded DOCX/file name: `src/jobs/pdfConvertBatch.js:12-28`, `src/lib/drive.js:65-96`.
3. `/jobs` responds 202 and fire-and-forgets without durable claim/idempotency: `src/routes/jobs.js:32-57`.
4. Model/GitHub/Drive/callback requests often lack hard deadlines; callback delivery has no durable retry/outbox.
5. Worker can redispatch after ten minutes while original irreversible GitHub/Drive work may still run.
6. Saved OpenAI-compatible base URL enables SSRF and forwards provider key to the chosen host: backend validation in `mgmt/backend/src/aiConfig.js:133-155`; use in Render model/provider/chat paths.
7. AI GitHub writes use a denylist rather than strict allowed source roots; workflows/manifests/deployment-sensitive files can remain writable. Prompt injection enters from errors/source/CI logs.
8. Public-chat limiter is per-process, trusts first `X-Forwarded-For`, has no global/provider concurrency or token budget, and Origin is not non-browser authentication.
9. Raw questions/answers and client session IDs can be retained indefinitely; unsalted IP hash is enumerable and TLS verification is disabled in Neon client.
10. No committed lockfile; Render uses semver resolution and auto-deploys, reducing reproducibility.
11. CI does not run the existing 89 server-render tests.

## D1/Neon schemas and migrations

- Important business keys are ordinary indexes rather than enforced unique constraints: login names, consent tokens/IDs, loan IDs, `(year, sl_no)` and others.
- Loan referential-integrity migration is documentation/no-op; canonical schema lacks complete FK enforcement.
- Several constraint migrations apply nothing to live DBs, and proposed triggers omit update cases.
- No migration ledger/checksum runner exists; some migrations are non-idempotent, others require manual commands, and fresh canonical schema is not guaranteed to be the final code-compatible state.
- CI focuses on the latest migration folder and can count no-op/comment migrations as passing.
- Neon chat schema has no real FK cascade/role constraint/automated retention. Raw content retention is manual/commented.
- Cleanup/bootstrap SQL contains destructive drops and multi-database operations are not atomic. R2/Drive are outside DB rollback.
- File URL export output is not clearly covered by root ignore policy, creating accidental artifact/PII commit risk.

## Retained React rollback

- Production build passes, but there are no tests or lint script.
- CI build does not prove a required `VITE_API_URL` is valid.
- Bearer tokens remain in Web Storage and CSP is report-only.
- Malformed stored user JSON can break boot.
- Build reports modules that are both statically and dynamically imported, preventing intended chunk movement.
- Main app chunk was about **217.6 KB** uncompressed; heavy DOCX utility chunk about **365.5 KB**.
- Production audit reported advisories in `@xmldom/xmldom` and React Router dependency paths.

# 11. Recommended remediation roadmap

## Phase P0 — Before next financial/management release

1. Make loan + guarantors + all consents atomic.
2. Add atomic yearly loan-fund reservation.
3. Rebuild collection enqueue from authoritative server rows and fix atomic claims.
4. Fix cookie-only logout revocation.
5. Correct money/year/key validation in backend and both frontends.
6. Fix R2/Drive archival order and consent privacy.
7. Declare current UI backup incomplete; implement full versioned backup coverage and independent object-store backup.
8. Purge/partition management browser cache; move to cookie-only sessions.
9. Add concurrency/partial-failure tests for every item above.
10. Prevent false-negative public verification.

## Phase P1 — Security, reliability and release quality

1. Canonicalize public cache keys, enforce HTTP methods and protect health/read amplification.
2. Fix time-aware popup caching and strict public users allowlist.
3. Protect public write endpoints with schema/body/origin/challenge/edge controls.
4. Make Render jobs durable/idempotent; replace base64 transport with private object references; add deadlines and callback outbox.
5. Enforce provider egress/SSRF policy and GitHub path allowlist; keep AI auto-merge disabled.
6. Introduce DB uniqueness, relationships/checks, migration ledger and schema-from-zero/upgrade tests.
7. Fix management modal/select/keyboard/zoom/focus/contrast; make warning threshold fail CI after cleanup.
8. Correct Workbox freshness provenance, API races/timeouts and push same-origin navigation.
9. Correct route SEO/canonical/sitemap/404 and structural-skin loading.
10. Add server-render to CI and commit a reviewed lockfile.

## Phase P2 — Scale, privacy and maintainability

1. Replace unbounded portal aggregate with bounded resources/pagination.
2. Add Cloudflare-native rate limiting/Queues/Durable Objects for exact counters and fan-out.
3. Establish data-classification, retention, deletion and audit matrix across D1/KV/R2/Drive/Neon/localStorage.
4. Add structured observability: request/job IDs, cache outcome, rows read, payload bytes, latency, queue state, snapshot age, version, provider outcome and alerts.
5. Consolidate duplicated skin/page logic and management form validation into typed shared contracts.
6. Add dependency update policy, SBOM/dependency review and explicit runtime/package-manager pins.

# 12. Required test plan

## Backend/Cloudflare

- Concurrent loan saves, disbursement, backup-code use, callback delivery and queue drains.
- Failure injection after every statement in loan/consent/replacement/archive/restore workflows.
- Cookie-only logout/replay, demotion/revocation during dependency outage and CSRF matrix for every mutation.
- Public cache nonce/method/health flood tests, popup schedule boundary tests and snapshot partial-write/Unicode-size tests.
- Workerd/Miniflare integration for KV eventual consistency, D1 metadata, R2 privacy and Worker subrequest limits.

## Browser/E2E

- Public: all 12 routes × five skins at 320/360/375/768/1024 widths, English/Hindi, stale/offline/failure states, verification correctness, deep links and 404.
- Management: anonymous/Superadmin/Admin/Subadmin direct hashes, login/2FA/recovery/session expiry/account switch, year lock changes during edit, two-editor conflicts and every destructive workflow.
- Axe/manual keyboard for every modal, combobox, popup, chatbot, menu, public token route and table.
- 200%/400% zoom, reduced motion, contrast, safe-area, soft keyboard and screen-reader announcements.
- PWA install/update/offline/deep-link/push rotation/click safety on Chromium and iOS Safari.
- Backup partial failure/resume, PDF oversize/timeout/retry, CSV formula/size/ZIP-bomb boundaries, popup preview-vs-live URL policy.

## CI quality gates

- Public frontend: keep zero Svelte warnings and add bundle budget.
- Mgmt Svelte: reduce 160 warnings to zero and fail CI on warning.
- Add server-render test job and lockfile reproducibility.
- Add schema-to-backup-map and schema-to-migration final-state checks.
- Add route-to-view wiring test so menu entries cannot land on placeholders.
- Add dependency advisory review with documented exceptions and upgrade SLA.

# 13. Positive engineering observations

- Public frontend has one shared schema/derive/store layer across skins, reducing financial formula drift.
- Public backend uses explicit allowlists for several sensitive tables, ETags/versioned URLs, stale snapshot fallback and dedicated public KV.
- Management backend has strong password/session primitives, CSRF/CORS controls, granular RBAC, typed error discipline and extensive regression coverage.
- HMAC/constant-time checks protect GitHub and Render callbacks; provider keys are encrypted; auto-merge is off.
- Several complex workflows already use D1 batches, bounded retries, terminal-state guards, upload magic checks and useful diagnostics.
- Svelte and React builds both succeed; current public frontend has clean type/a11y compile diagnostics and no production advisory in its installed dependency tree.
- The existing 610 backend tests are valuable. Main gap is not basic unit discipline; it is concurrency, partial failure, real Cloudflare primitives, browser behavior and cross-service contract testing.

# 14. Final assessment

The platform is feature-rich and clearly has received serious hardening work, but the most important remaining failures sit at the exact boundaries unit tests commonly miss: **transaction completeness, concurrent allocation, durable job claims, authoritative server data, session revocation, object-storage privacy, recovery completeness, cache provenance and real keyboard/browser behavior**.

**Recommended management decision:** freeze new loan/consent and destructive recovery operations until P0-01 through P0-09 are corrected and covered by failure/concurrency tests. Public portal can remain available if business accepts the current risk, but verification wording, cache freshness, public backend abuse paths, accessibility blockers and SEO metadata should be corrected before calling it production-grade, WCAG-compliant or fully reliable.
