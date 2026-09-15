# Audit Remediation Plan (Fix Approach)

**Base commit:** `a4cae6a` (`main`)  
**Source of findings:** `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md`  
**Status:** Plan only — koi code change abhi nahi kiya gaya. Approval ke baad batch-wise implement hoga.

## 1. Guiding rules for every fix

1. **Server-side truth first.** Frontend validation sirf UX hai; har rule backend/DB par enforce hoga.
2. **Ek fix = ek focused batch = ek PR.** Financial aur security fixes mixed nahi honge.
3. **Test-first for P0.** Pehle failing test likhenge (concurrency/partial-failure), phir fix, phir green.
4. **No behavior guessing.** Jahan live schema/secret/infra state pata nahi, wahan code safe-by-default rahega aur runbook step alag likha jayega.
5. **Backward compatible rollout.** Cookie/session, API contract aur DB constraints ke changes phased honge (detect → repair → enforce).
6. **Har batch ke baad full verification suite** chalayenge (section 8).

## 2. Batch overview

| Batch | Theme | Issues covered | Risk | Blocking? |
|---|---|---|---|---|
| B1 | Loan/consent transaction integrity | P0-01, P0-02, MGMT-BE-01 | High | Yes |
| B2 | Queue trust + duplicate execution | P0-03, P0-04 | High | Yes |
| B3 | Session revocation + management client identity | P0-05, P0-08, Svelte auth/session gaps | High | Yes |
| B4 | Money/year/field validation (backend + both UIs) | P0-09 | Medium | Yes |
| B5 | Object storage privacy + archival order | P0-06 | High | Yes |
| B6 | Backup/restore completeness | P0-07 | High | Yes |
| B7 | Public verification correctness + freshness provenance | P0-10, PUB-FE-01 | Medium | Yes |
| B8 | Public backend abuse/caching/privacy | PUB-BE-01…07 + medium items | Medium | No |
| B9 | Render/offload durability + SSRF + AI write scope | Render 1–7 | High | No |
| B10 | DB constraints + migration ledger | DB findings | High (ops) | No |
| B11 | Accessibility + UX (public + mgmt) | PUB-FE-04/05/07 + mgmt a11y | Medium | No |
| B12 | SEO/PWA/privacy disclosure | PUB-FE-06/08 + manifest/sitemap/privacy | Low | No |
| B13 | CI gates, dependencies, observability, retention | CI/dep/retention/observability | Medium | No |

**Recommended order:** B1 → B2 → B3 → B4 → B5 → B6 → B7 → B9 → B10 → B8 → B11 → B12 → B13.

## 3. P0 batches — detailed approach

### B1. Loan + consent atomicity aur fund reservation

**Files:** `mgmt/backend/src/loans.js`, plus new `mgmt/db/migration/<date>/` files.

**Approach**
1. `saveLoan` ko restructure karenge: pehle **saara validation + config + participant lookup + consent row construction** hoga (koi write nahi).
2. Loan + 3 guarantors + 4 consent rows ek hi `DB_LOANS_EXPENSES.batch()` mein commit honge. Consent failure = poora loan rollback, `success:false`.
3. WhatsApp/email sends commit ke **baad** honge, ek idempotency key ke saath (`loan_id + consent_id + channel + event`). Send failure loan ko fail nahi karega, but queue row banega.
4. **Fund reservation:** ek naya `loan_fund_ledger` (ya `loan_year_balance`) table `DB_LOANS_EXPENSES` mein. Allocation conditional update se hoga:
   `UPDATE ... SET remaining = remaining - ? WHERE year = ? AND remaining >= ?` → `meta.changes === 1` check. Fail = 409-style business error.
5. Reconciliation script/action: ledger ko source ledgers se compare karke drift report karega (auto-write nahi).
6. `resendConsent`: pehle template/number prerequisites verify, phir token rotate. `replaceGuarantor`: single batch. `markLoanDisbursed`: `WHERE loan_status='Approved'` conditional update + changed-row check.

**Tests (new)**
- Consent insert #1/#2/#3/#4 fail → loan absent, error returned.
- Two parallel `saveLoan` with same year/budget → exactly one succeeds.
- Parallel `markLoanDisbursed` → one success, one rejected.
- `resendConsent` missing template → old token still valid, count unchanged.
- `replaceGuarantor` mid-failure → old state intact.

### B2. Collection queue authenticity aur single execution

**Files:** `mgmt/backend/src/collectionQueue.js` (+ callers in both frontends).

**Approach**
1. `enqueueCollectionJob` ka naya contract: `{ collectionId, docKind }` only. Server row load karega, year/access/lock verify karega, record ID aur notification payload **khud derive** karega.
2. Client-supplied DOCX bytes ka option agar rakhna hai to: stored row revision/digest ke saath bind hoga; mismatch = reject. Warna server-side generation.
3. Idempotency: `UNIQUE(collection_id, doc_kind, event)` per job so duplicate enqueue no-op ho.
4. Claim fix: `claim_token` column + exact predicate —
   `WHERE id=? AND ((status='pending') OR (status='processing' AND claimed_at < ?))`, phir row reread karke `claim_token` match hone par hi process.
5. Old contract ko ek release ke liye accept karenge but server-derived data se override karke, deprecation log ke saath.

**Tests:** fabricated record ID reject; payload/row mismatch reject; two parallel drains → single execution; stale processing recovery; duplicate enqueue no-op.

### B3. Session revocation + management client data hygiene

**Files:** `mgmt/backend/src/index.js`, `mgmt/backend/src/auth.js`, `mgmt/frontend-svelte/src/lib/api.ts`, `cache.ts`, `stores/session.ts`, `routes/+page.svelte`.

**Approach**
1. `withAuth` ek **effective token** context set karega; logout us token ko revoke karega (KV hashed key + audit row). Cookie clearing waisa hi rahega.
2. Session ke saath `security_version` (per login user) store hoga; password change / 2FA change / manual revoke us version ko bump karega → purane sessions invalid.
3. Frontend: cache keys ko `accountId + role + securityVersion` se namespace karenge. Logout/auth-failure/account-switch par **synchronously** memory + localStorage purge hoga, render se pehle.
4. Sensitive views (users, login management, official mail, audit) ke responses **persist nahi** honge — sirf in-memory.
5. Auth expiry par API ek typed event emit karega jise shell sunkar `session.clear()`, modals close, aur login focus karega.
6. Auth storage: cookie-only session ko default banane ka path — `api.ts` se bearer read hataakar `credentials:'include'` + CSRF header. Remember-me default `false`.

**Tests:** cookie-only logout ke baad token replay reject; security-version bump ke baad purana session reject; account switch ke baad cache empty; expiry par UI login par wapas.

### B4. Validation hardening (money/year/columns)

**Files:** new `mgmt/backend/src/validate.js` (shared), `crud.js`, `loans.js`, `tableRegistry.js`; frontend `Home.svelte`, `Expenses.svelte`, `Loans.svelte`, `DonationSettings.svelte`.

**Approach**
1. Ek shared validator: `amount` (finite, > 0, max 2 decimals, upper bound), `year` (integer, supported range, required for financial rows), `rate/tenure` (non-negative bounds), date ordering.
2. Per-table **exact allowed keys**; server-owned columns (`id`, generated IDs, attribution/status) hard reject — snake_case bypass band.
3. Same rules frontend par mirror honge (`min`, `step`, inline error, submit block) — sirf UX ke liye.
4. DB level: naye migration mein `CHECK` (amount > 0), `NOT NULL` year, aur relevant `UNIQUE` — pehle detect/repair query, phir enforce.
5. Donation settings: ek atomic validated payload; UPI/IFSC/account/WhatsApp format validation + change confirmation.

**Tests:** negative/zero/NaN/huge/precision amounts reject; missing year reject; server-owned key reject; frontend validation unit tests.

### B5. Consent evidence privacy + archival ordering

**Files:** `mgmt/backend/src/storage.js`, `r2.js`, `loans.js`.

**Approach**
1. Archival order: upload → **conditional DB update** → verify → source delete. Failure par dono copies rakhenge + `pending_migration` row.
2. `moveOneUrl` ko `visibility` flag milega. Consent photos/signatures ke liye `setAnyoneReader` **kabhi nahi**.
3. Consent objects private bucket/prefix mein; access ek authenticated proxy action ya short-lived signed URL se.
4. Ek one-time remediation action: existing public consent objects ko detect karke private karna + DB URLs update (dry-run first, report, phir apply).
5. Retention/deletion policy consent evidence ke liye document + implement.

**Tests:** DB update failure par source object present; consent upload par public ACL call absent; private read authorization enforced.

### B6. Backup/restore completeness

**Files:** `mgmt/backend/src/backup.js`, both frontends' Backup views, `mgmt/db/cleanup/.../RUNBOOK.md`.

**Approach**
1. Turant UI/README/runbook mein "backup incomplete" warning (choti PR, alag).
2. `BACKUP_MAP` ko authoritative table registry se generate/validate karenge — nine DBs including `DB_AUDIT` aur missing tables.
3. Manifest v2: version, timestamp, per-table row counts, per-binding checksum, aur explicitly "read failed" vs "empty" distinction.
4. Restore: staged validation → per-binding atomic swap → resume-able run ID. Legit empty table ko explicit confirm ke saath clear karega.
5. R2/Drive object export/verify step runbook mein add hoga (DB backup se cover nahi hota).
6. CI test: schema tables ⊆ backup map, warna fail.

**Tests:** schema-vs-map coverage; manifest round-trip; empty-table semantics; partial restore resume; corrupt archive reject.

### B7. Public verification truth + data freshness provenance

**Files:** `Public/frontend-v6/src/lib/components/VerifyContent.svelte`, `src/lib/api/client.ts`, `stores/portal.ts`, `vite.config.ts`.

**Approach**
1. Verify states: `invalid-input`, `checking`, `unavailable` (failed/no successful fetch), `provisional` (stale snapshot), `verified`, `not-found` (sirf fresh successful data par).
2. `loadPortalData` return mein `source: 'network' | 'cache' | 'snapshot'` aur server-provided version/timestamp.
3. `savedAt` sirf network success par update hoga; cache/snapshot par stale flag aur data-age visible.
4. Workbox API caching: ya remove, ya custom strategy jo provenance header set kare. Snapshot max-age limit.
5. `fetchJson` mein AbortController + timeout; `initPortal` mein in-flight dedupe + generation guard (late response discard).

**Tests:** offline first visit par verify "unavailable"; stale snapshot par provisional; cache fallback par stale badge; overlapping refresh mein latest wins; timeout path.

## 4. Post-P0 batches — approach summary

### B8. Public backend hardening
- Canonical cache key: `action + server-read version` (URL/query se independent), unknown query params reject.
- Action → allowed method map; mismatch par 405 + `Allow`.
- Health: no-I/O liveness (`?health=1`), aur dependency readiness protected/cached (30–60s) + limited.
- Popup: time-aware TTL (next boundary, capped) ya bounded time bucket; malformed dates fail-closed.
- Users: explicit SQL + response allowlist; `__rowIndex` sirf collection resource par.
- Writes: approved Origin + `application/json` + size cap + schema; error-log empty/junk reject, 503 on ingestion failure; push endpoint `new URL` validation, oversize reject (truncate nahi), unsubscribe + last-seen.
- Snapshot: single `{version,data}` value, `TextEncoder` byte size, failure logging.
- Version read failure = explicit unavailable (kabhi `0` nahi).
- Portal payload: sections lazy/paginated; parallel reads; post-assembly version re-check.
- Add `package-lock.json`, `node --check` + unit tests (Miniflare/workerd) is directory ke liye.

### B9. Render/offload durability
- Job transport: base64 JSON hataakar private R2/object reference + signed one-time URL. Interim: shared byte limit + pre-dispatch reject + item cap.
- Render side `job_claims` (Postgres/K-V) — duplicate `jobId` par existing state return, execution repeat nahi.
- Har outbound call par connect/response deadline + overall job deadline + bounded concurrency.
- Callback outbox with exponential retry; delivery failure loud.
- Provider egress policy: HTTPS-only, DNS resolve + private/loopback/link-local/metadata block, `redirect:'error'`, optional allowlist. Same policy Worker aur Render dono par.
- AI GitHub writes: denylist → **allowlist** (specific source roots/extensions), `.github/**`, manifests, lockfiles, deployment configs blocked; corrected diff ⊆ previous context paths; workflow-write-less token; auto-merge permanently off.
- Public chat: trusted proxy IP only, shared/atomic rate store, global + per-provider concurrency aur daily token budget, saturation par fast 503.
- Chat privacy: notice/consent, raw content default off ya short retention, server-generated session IDs, HMAC (rotating salt) IP hash, verified TLS, Neon FK/CHECK + scheduled retention.
- Commit lockfile; `npm ci --omit=dev`; staged deploy.

### B10. DB constraints + migration discipline
- Phase 1: detection queries (duplicates/orphans) → report.
- Phase 2: repair scripts with backups.
- Phase 3: partial unique indexes (login name, consent token/ID, loan ID, `(year, sl_no)`, receipt no) + loan relationships via FK/triggers (insert **aur** update) + CHECK constraints.
- `schema_migrations` ledger + transactional runner + checksums; comment-only migrations ko executable guarded migrations banayenge.
- Canonical schema = generated end-state (post-ALTER), bootstrap-only path clearly separated with an environment guard.
- CI: apply-from-zero, upgrade path, idempotence, aur "no no-op counted as pass".

### B11. Accessibility/UX
- Public + mgmt dono mein **ek shared accessible dialog primitive**: labelled title, initial focus, Tab trap, Escape, inert background, scroll lock, return focus; destructive = `alertdialog`.
- `SearchableSelect` → proper combobox (roles, `aria-activedescendant`, arrows/Enter/Escape) ya audited library.
- Clickable `div/span` → `<button>`; 44px targets; visible `:focus-visible` ring restore.
- Contrast tokens: dedicated text/bg/focus tokens per theme, AA verified; `maximum-scale`/`user-scalable` remove.
- `LiveScroll` duplicate track non-interactive + `inert`; RAF only when active; reduced-motion live listener.
- Live regions: chat `role="log"`, status/`aria-busy`, field `aria-invalid`/`aria-describedby`, label associations (Svelte 160 warnings clear).
- Carousel pause/play + slide announcements + real alt text contract.
- Skip link, one `h1` per page across all skins, semantic tables for decade data, safe-area + narrow-width fixes, Festival `rgb(#hex)` fix.

### B12. SEO/PWA/privacy
- Path-based canonical + per-route title/description/OG/Twitter/`og:url`; JSON-LD (Organization/WebSite).
- Sitemap complete (`/donate`, `/guide`, `/decade`), verify route indexing policy, real 404 (soft-404 band).
- Initial state `loading` (zero-state nahi), reserved dimensions.
- Manifest: localized metadata, portrait lock remove, real screenshots.
- Privacy notice: chatbot, telemetry, push, local cache, fonts, retention, deletion rights; chatbot pe first-use disclosure; fonts self-host.
- Popup suppression per `popup_id + revision`.
- Push/inbox URLs strictly same-origin (`new URL` + origin check, `//host` block); SW ko build-time API origin; rotation par subscription persist.

### B13. CI, dependencies, observability, retention
- CI jobs add: server-render tests, lockfile check, public backend syntax+tests, schema↔backup, migration matrix, route↔view wiring test.
- Warning gates: public frontend 0 warnings maintain; mgmt Svelte warnings ko 0 karke fail-on-warning.
- Bundle budgets: public frontend (new) + mgmt React (existing).
- Dependency policy: advisory review, upgrade SLA, `engines`/`packageManager` pins; mgmt Svelte 7 aur React 3 advisories ke liye upgrade PRs.
- Structured observability: request/job IDs, action, status, latency, cache HIT/MISS, rows read, payload bytes, budget usage, snapshot age, queue depth; alerts.
- Retention: failed job blobs, render_jobs, ai_fixes, official mail, inactive push, Neon chat — policy + implementation + tests.

## 5. Rollout strategy per risky change

| Change | Rollout |
|---|---|
| Loan transaction + ledger | Migration → dual-read verify → enforce; loan freeze window mein deploy |
| Queue contract | Server-derive + accept old shape (1 release) → clients update → old shape reject |
| Cookie-only auth | Cookie primary + bearer accepted → clients migrate → bearer disabled |
| Consent privacy | New uploads private → remediation dry-run → apply → verify links |
| DB constraints | Detect → repair → enforce (per DB, off-peak) |
| Cache key/method changes | Deploy with metrics; watch cache HIT ratio + 405 rate |
| Skin lazy-loading | Behind build check + visual/bundle diff |

## 6. Testing plan attached to each batch

- **Concurrency:** parallel loan saves, disbursement, backup codes, queue drains, Render callbacks.
- **Partial failure:** every multi-step workflow ke beech failure injection.
- **Security:** cookie-only logout replay, CSRF matrix, role denial for each action, locked-year denial, token replay/expiry, SSRF ranges, AI path allowlist.
- **Data:** negative/precision/huge amounts, missing year, server-owned keys, duplicate/orphan detection.
- **Browser/E2E (new suite):** Playwright — public 12 routes × 5 skins × 2 languages × key widths; mgmt role/hash matrix, session expiry, two-editor conflict, destructive flows.
- **A11y:** axe + keyboard/screen-reader for every dialog/combobox/carousel/table; zoom 200/400%; reduced motion.
- **PWA:** install/update/offline/deep link/push rotation/click safety.
- **Recovery:** backup completeness, restore resume, migration apply-from-zero.

## 7. Deliverable format

- Har batch = separate branch + PR, jisme: problem, fix, evidence, tests added, verification output, rollout/rollback note.
- P0 PRs pehle; base branch policy repo ke default branch par PR (direct main commit nahi).
- Report/plan updates ek chhoti docs PR mein.

## 8. Verification suite (har batch ke baad)

```
# Public backend
cd Public/backend && node --check src/index.js

# Public frontend
cd Public/frontend-v6 && npm ci && npm run check && npm test && npm run build

# Mgmt backend
cd mgmt/backend && npm ci && npm test && npm run lint:errors

# Mgmt Svelte
cd mgmt/frontend-svelte && npm ci && npm run check && npm test && VITE_API_URL=https://example.invalid npm run build

# Retained React
cd mgmt/frontend && npm ci && VITE_API_URL=https://example.invalid npm run build

# Render service
cd mgmt/server-render && npm install && npm test
```

Plus batch-specific new tests, aur production dependency audit (`npm audit --omit=dev`) jahan relevant ho.

## 9. Decisions needed from you (fix se pehle)

1. **Scope:** sirf P0 (B1–B7) karun, ya poora roadmap step-by-step?
2. **Auth direction:** cookie-only session par shift karna hai (recommended) ya bearer hi rakhein?
3. **Consent evidence access:** private bucket + authenticated proxy theek hai? (public links todenge)
4. **Public data shape:** `portalData` ko paginated/sectioned API mein todna allowed hai (frontend changes ke saath), ya backward-compatible rakhna zaroori hai?
5. **Skin loading:** lazy-load karke bundle kam karun (behavior same, chhota visual load-order change) ya abhi chhod dein?
6. **DB constraints:** live D1 par detect/repair/enforce migrations chalane ke liye aap ready ho (backup ke baad)?
7. **Chat logging:** raw question/answer logging default off karun ya redacted + short retention?
8. **PR style:** batch-wise multiple PRs (recommended) ya ek bada PR?
9. **Render transport:** base64 hataakar object-reference design karun, ya interim size-limit fix se kaam chalayein?
10. **Freeze window:** loan/consent workflows par temporary freeze possible hai jab B1 deploy ho?

Aapke jawab ke baad main confirm-order se implement karna shuru karunga.
