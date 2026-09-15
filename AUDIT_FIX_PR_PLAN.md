# Audit Fix — Multi-PR Delivery Plan

**Base branch:** `main` (har PR ek naye branch se, `main` par direct commit nahi)  
**Convention (repo history se):** title `type(scope): summary`, branch `feat/…` `fix/…` `chore/…` `perf/…`, squash merge  
**Findings source:** `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md` · **Approach:** `AUDIT_FIX_PLAN.md`  
**Status:** Plan only — koi code change nahi hua. Aapke OK ke baad PR-wise implement hoga.

## 0. Delivery rules

1. **Ek PR = ek concern.** Financial, security, a11y, SEO mix nahi honge.
2. **Har PR self-contained aur mergeable** — adhoora state main par nahi jayega.
3. **P0 PRs mein test pehle** (failing test → fix → green).
4. **Dependency order respect** hoga (table ka `Depends` column).
5. Har PR body mein: problem, root cause, fix, evidence (file:line), tests added, verification output, rollout/rollback note.
6. Risky contract changes **back-compat window** ke saath (dono shapes accept → client migrate → purana band).
7. Har PR ke baad section 4 ki verification suite pass honi chahiye.

## 1. Master PR table (48 PRs, 8 waves)

| # | Branch | Title | Wave | Depends | Risk | Size |
|---|---|---|---|---|---|---|
| 01 | `docs/audit-report-and-fix-plan` | `docs: add senior audit report, fix approach and PR plan` | W0 | — | None | S |
| 02 | `fix/backup-incomplete-warning` | `fix(mgmt): warn that Full Backup does not cover every table yet` | W0 | — | None | S |
| 03 | `fix/loan-consent-atomic-batch` | `fix(mgmt): commit loan, guarantors and all consents in one batch` | W1 | — | High | M |
| 04 | `feat/loan-fund-reservation-ledger` | `feat(mgmt): atomic per-year loan fund reservation` | W1 | 03 | High | M |
| 05 | `fix/loan-resend-replace-disburse-safety` | `fix(mgmt): validate before token rotation and make loan updates conditional` | W1 | 03 | Med | M |
| 06 | `fix/collection-enqueue-server-derived` | `fix(mgmt): derive collection jobs from the stored row, not client payload` | W1 | — | High | M |
| 07 | `fix/collection-job-atomic-claim` | `fix(mgmt): claim collection jobs with an exact-state claim token` | W1 | 06 | Med | S |
| 08 | `fix/cookie-only-logout-revocation` | `fix(mgmt): revoke the effective session token on cookie-only logout` | W1 | — | Med | S |
| 09 | `feat/session-security-version` | `feat(mgmt): invalidate sessions through an account security version` | W1 | 08 | Med | M |
| 10 | `fix/mgmt-cache-account-scope` | `fix(mgmt-ui): scope and purge the local cache per account` | W1 | — | High | M |
| 11 | `fix/mgmt-auth-expiry-flow` | `fix(mgmt-ui): return to Login when the session expires` | W1 | 10 | Low | S |
| 12 | `feat/mgmt-shared-validation` | `feat(mgmt): shared amount/year/column validation for every write` | W1 | — | Med | M |
| 13 | `fix/mgmt-ui-money-validation` | `fix(mgmt-ui): block negative/malformed amounts and atomic donation save` | W1 | 12 | Low | M |
| 14 | `fix/consent-evidence-privacy-and-archive-order` | `fix(mgmt): keep consent evidence private and update DB before deleting R2` | W1 | — | High | M |
| 15 | `feat/backup-complete-manifest-v2` | `feat(mgmt): full-coverage backup manifest and resumable restore` | W1 | 02 | High | L |
| 16 | `fix/public-verify-truthful-states` | `fix(public): never report "not found" when verification data is unavailable` | W1 | — | Med | S |
| 17 | `fix/public-data-freshness-provenance` | `fix(public): distinguish network, cache and snapshot data + request timeouts` | W1 | 16 | Med | M |
| 18 | `fix/public-api-cache-key-and-methods` | `fix(public-api): canonical cache keys and per-action method enforcement` | W2 | — | Med | M |
| 19 | `fix/public-api-health-split` | `fix(public-api): cheap liveness, protected readiness, throttled probes` | W2 | — | Low | S |
| 20 | `fix/public-api-popup-time-aware-cache` | `fix(public-api): stop caching scheduled popups as immutable` | W2 | 18 | Med | S |
| 21 | `fix/public-api-users-allowlist` | `fix(public-api): allowlist public user columns and internal row ids` | W2 | — | Med | S |
| 22 | `fix/public-api-write-hardening` | `fix(public-api): authenticate, validate and bound the public write endpoints` | W2 | — | Med | M |
| 23 | `fix/public-api-snapshot-atomicity` | `fix(public-api): publish snapshots atomically with byte-accurate limits` | W2 | — | Med | S |
| 24 | `perf/public-api-portal-assembly` | `perf(public-api): parallel reads, single-flight fills, version re-check` | W2 | 18 | Med | M |
| 25 | `chore/public-api-tests-and-lockfile` | `chore(public-api): add lockfile, unit tests and CI checks` | W2 | 18–24 | Low | M |
| 26 | `fix/render-payload-size-contract` | `fix(render): one shared size contract for PDF jobs` | W3 | — | Med | M |
| 27 | `feat/render-durable-idempotent-jobs` | `feat(render): durable job claims, deadlines and bounded concurrency` | W3 | 26 | High | L |
| 28 | `feat/render-callback-outbox-and-version-bump` | `feat(mgmt): atomic callback apply, retry outbox and post-callback version bump` | W3 | 27 | High | M |
| 29 | `fix/provider-egress-ssrf-policy` | `fix(security): enforce HTTPS and block private ranges for AI providers` | W3 | — | Med | M |
| 30 | `fix/ai-github-write-allowlist` | `fix(security): allowlist AI-writable paths and scope the GitHub token` | W3 | — | Med | M |
| 31 | `fix/public-chat-abuse-controls` | `fix(render): trusted-IP shared rate limiting and model budgets for chat` | W3 | — | Med | M |
| 32 | `fix/chat-privacy-and-neon-hardening` | `fix(render): chat consent, redaction, retention and verified Neon TLS` | W3 | 31 | Med | M |
| 33 | `chore/db-integrity-detection-and-repair` | `chore(db): detect and repair duplicate/orphan rows before constraints` | W4 | — | Med | M |
| 34 | `feat/db-enforce-keys-and-relations` | `feat(db): enforce unique business keys, checks and loan relations` | W4 | 33, 12 | High | L |
| 35 | `feat/db-migration-ledger` | `feat(db): migration ledger, runner and generated end-state schema` | W4 | 34 | Med | L |
| 36 | `feat/a11y-shared-dialog-public` | `feat(a11y): accessible dialog primitive for the public portal` | W5 | — | Med | M |
| 37 | `feat/a11y-shared-dialog-mgmt` | `feat(a11y): accessible dialog primitive for the management portal` | W5 | — | Med | M |
| 38 | `fix/a11y-controls-and-combobox` | `fix(a11y): real buttons and a proper combobox for management controls` | W5 | 37 | Med | M |
| 39 | `fix/a11y-contrast-focus-zoom` | `fix(a11y): AA contrast, visible focus rings and pinch zoom` | W5 | — | Med | M |
| 40 | `fix/a11y-live-regions-and-labels` | `fix(a11y): announce updates and associate every form label` | W5 | 37 | Low | M |
| 41 | `fix/a11y-structure-and-motion` | `fix(a11y): headings, skip link, tables, safe areas and motion controls` | W5 | 36 | Low | M |
| 42 | `fix/seo-route-metadata` | `fix(seo): per-route canonical, metadata, structured data and sitemap` | W6 | — | Low | M |
| 43 | `fix/pwa-manifest-and-update-ux` | `fix(pwa): localized manifest, update prompt and worker cache headers` | W6 | 17 | Low | M |
| 44 | `fix/privacy-and-push-navigation` | `fix(public): complete privacy notice and same-origin push navigation` | W6 | 17 | Med | M |
| 45 | `perf/public-lazy-skins` | `perf(public): load only the active skin and page` | W6 | 36 | Med | L |
| 46 | `ci/quality-gates` | `ci: add server-render tests, wiring tests, bundle and warning gates` | W7 | most | Low | M |
| 47 | `chore/dependency-upgrades` | `chore(deps): clear known advisories in both management frontends` | W7 | 46 | Med | M |
| 48 | `feat/observability-and-retention` | `feat(ops): structured telemetry and complete retention policies` | W7 | 46 | Med | L |

> Total 48 PRs. Implementation ke waqt koi PR bahut bada nikle to split kar dunga (count badh sakta hai, ghat nahi).

## 2. Per-PR scope detail

### Wave 0 — Safety + docs (turant)

**PR-01 · docs**  
Files: `SENIOR_WEB_AUDIT_REPORT_2026-09-15.md`, `AUDIT_FIX_PLAN.md`, `AUDIT_FIX_PR_PLAN.md`. Sirf documentation.

**PR-02 · backup warning**  
Files: `mgmt/frontend-svelte/src/lib/views/Backup.svelte`, `mgmt/frontend/src/views/Backup.jsx`, `mgmt/db/cleanup/.../RUNBOOK.md`, `README.md`.  
Backup UI par explicit list: kaunsi tables cover nahi hoti; runbook mein CLI export ko authoritative batana. PR-15 ke baad ye warning hat jayegi.

### Wave 1 — P0 blockers

**PR-03 · loan/consent atomic**  
`mgmt/backend/src/loans.js`. Validation + consent construction pehle, phir loan+3 guarantor+4 consent ek `batch()`. Notifications post-commit. Tests: har consent insert par failure injection.

**PR-04 · fund reservation**  
`mgmt/backend/src/loans.js` + migration (`loan_fund_ledger`). Conditional `remaining >= ?` update + `meta.changes` check + reconciliation read-only action. Test: parallel saves → ek success.

**PR-05 · resend/replace/disburse**  
`mgmt/backend/src/loans.js`. Prerequisite validation before token rotation; guarantor replacement single batch; `markLoanDisbursed` conditional on `Approved`. Tests: partial failure + parallel disburse.

**PR-06 · collection enqueue v2**  
`mgmt/backend/src/collectionQueue.js` + both frontends' callers. New `{collectionId, docKind}` contract, server-derived payload/record ID, `UNIQUE(collection_id, doc_kind, event)`; purana shape ek release tak accept but server data se override.

**PR-07 · atomic claim**  
`mgmt/backend/src/collectionQueue.js` + migration (`claim_token`). Exact-state predicate + token reread. Test: two parallel drains.

**PR-08 · logout revocation**  
`mgmt/backend/src/index.js`, `auth.js`. Effective token (`body || cookie`) revoke. Test: cookie-only logout → replay rejected.

**PR-09 · security version**  
`mgmt/backend/src/auth.js`, `account.js`, `twoFactor.js` + migration. Password/2FA/revoke par version bump → purane sessions invalid; privileged actions par fail-closed check.

**PR-10 · cache scoping**  
`mgmt/frontend-svelte/src/lib/cache.ts`, `api.ts`, `viewData.ts`. Keys `accountId+role+securityVersion`; sensitive views memory-only; logout/auth-fail/account-switch par synchronous purge.

**PR-11 · auth expiry UX**  
`mgmt/frontend-svelte/src/lib/api.ts`, `stores/session.ts`, `routes/+page.svelte`. Typed auth-expired event → session clear, modals close, login focus. Invalid initial hash normalize (`resolveAllowedTab`).

**PR-12 · backend validation**  
New `mgmt/backend/src/validate.js` + `crud.js`, `loans.js`, `tableRegistry.js`. Amount/year/rate/tenure/date rules; per-table exact key allowlist; server-owned columns reject.

**PR-13 · frontend validation**  
`Home.svelte`, `Expenses.svelte`, `Loans.svelte`, `DonationSettings.svelte` (+ React equivalents jahan zaroori). `min/step`, inline errors, submit block, loan-year fetch failure par contributor list clear; donation ek atomic validated save.

**PR-14 · consent privacy + archive order**  
`mgmt/backend/src/storage.js`, `r2.js`, `loans.js`. Upload → conditional DB update → verify → delete; `visibility` flag; consent par public ACL kabhi nahi; existing public objects ke liye dry-run remediation action.

**PR-15 · backup completeness**  
`mgmt/backend/src/backup.js` + CI test + both Backup views. Generated map (9 DBs, all tables), manifest v2 (counts/checksums/empty-vs-failed), resumable restore with run ID, R2/Drive export step runbook mein.

**PR-16 · verify states**  
`Public/frontend-v6/src/lib/components/VerifyContent.svelte`, `stores/portal.ts`, `i18n.ts`. `invalid-input | checking | unavailable | provisional | verified | not-found`.

**PR-17 · freshness provenance**  
`Public/frontend-v6/src/lib/api/client.ts`, `stores/portal.ts`, `sync.ts`, `vite.config.ts`, `Chatbot.svelte`. `source` flag, `savedAt` only on network, snapshot max-age, AbortController + timeout, in-flight dedupe + generation guard, Workbox API strategy fix.

### Wave 2 — Public backend

- **PR-18:** canonical internal cache key (action+version), unknown query reject, action→method map, 405 + `Allow`.
- **PR-19:** `?health=1` no-I/O liveness; readiness protected/cached + throttled; optional failures = degraded; error details public se hata kar logs mein.
- **PR-20:** popup TTL = next boundary (capped) / time bucket; malformed dates fail-closed; eligible-only SQL.
- **PR-21:** explicit users projection + response allowlist; `__rowIndex` sirf collection resource.
- **PR-22:** writes — approved Origin, `application/json`, size cap, schema, empty/junk reject, 503 on failure; push `new URL` validation + oversize reject + unsubscribe/last-seen; IP hashing/retention.
- **PR-23:** single `{version,data}` snapshot value, `TextEncoder` bytes, failure logging, version-read failure = explicit unavailable.
- **PR-24:** parallel section reads, single-flight cache fill, post-assembly version re-check, bounded/paginated sections (contract decision ke hisaab se).
- **PR-25:** `package-lock.json`, Miniflare/workerd unit tests (all actions/methods/CORS/popup boundaries/KV failures), CI job.

### Wave 3 — Render / AI / chat

- **PR-26:** ek shared byte contract; pre-dispatch reject; per-item + aggregate caps; decoded ZIP/DOCX magic + name validation; output size cap; results ko accumulate na karna.
- **PR-27:** `job_claims` store, duplicate `jobId` par existing state, connect/response/job deadlines, bounded concurrency, cancellation.
- **PR-28:** Worker `dispatched → applying` atomic claim + changed-row check, callback digest, durable callback outbox with backoff, PDF callback ke baad `public_data_version` bump, non-reconstructable jobs non-retriable.
- **PR-29:** HTTPS-only provider URLs; DNS resolve + loopback/private/link-local/metadata block; `redirect:'error'`; optional allowlist; Worker + Render dono par.
- **PR-30:** AI write allowlist (source roots/extensions), `.github/**`/manifests/lockfiles/deploy configs blocked, corrected diff ⊆ context paths, workflow-write-less token, auto-merge off + branch prefix validation.
- **PR-31:** trusted proxy IP only, shared atomic rate store, global + per-provider concurrency, daily token budget, fast 503, optional challenge.
- **PR-32:** chat consent/disclosure, raw content off/redacted + retention job, server-generated session IDs, rotating HMAC IP hash, verified TLS, Neon FK/CHECK.

### Wave 4 — Database integrity

- **PR-33:** detection SQL + report action/script (duplicates: login name, consent token/ID, loan ID, `(year, sl_no)`, receipt no; orphans: consents/guarantors/files) — read-only.
- **PR-34:** repair scripts + partial unique indexes + CHECK constraints + loan relations (FK jahan possible, warna insert **aur** update triggers). Per-DB, off-peak, backup ke baad.
- **PR-35:** `schema_migrations` ledger + transactional runner + checksums; comment-only migrations → executable guarded migrations; canonical schema = generated end-state; bootstrap path env-guarded; CI apply-from-zero + upgrade + idempotence.

### Wave 5 — Accessibility

- **PR-36 / PR-37:** shared dialog primitive (public/mgmt): labelled title, initial focus, Tab trap, Escape, inert background, scroll lock, return focus, `alertdialog` for destructive. Sabhi modals migrate.
- **PR-38:** `SearchableSelect` → ARIA combobox (arrows/Enter/Escape/activedescendant); clickable `div/span` → `<button>`; 44px targets.
- **PR-39:** contrast tokens (text/bg/focus) per theme AA-verified; `:focus-visible` rings; `maximum-scale`/`user-scalable` remove.
- **PR-40:** chat `role="log"`, status/`aria-busy`, `aria-invalid`/`aria-describedby`, label associations → mgmt Svelte ke 160 warnings zero.
- **PR-41:** one `h1` per page (all skins), skip link, decade tables semantic, LiveScroll duplicate `inert` + RAF only when active + reduced-motion listener, carousel pause/play + alt contract, safe-area/narrow-width, Festival `rgb(#hex)` fix.

### Wave 6 — SEO / PWA / privacy / performance

- **PR-42:** path-based canonical, per-route title/description/OG/Twitter/`og:url`, JSON-LD, sitemap complete, verify indexing policy, real 404; initial state `loading` (zero-state nahi).
- **PR-43:** manifest localization + orientation unlock + real screenshots; update-available UX; `sw.js`/`push-sw.js` no-cache headers; popup suppression per `popup_id + revision`.
- **PR-44:** privacy notice complete (chat/telemetry/push/cache/fonts/retention/deletion); chat first-use disclosure; fonts self-host; push/inbox URLs strictly same-origin; SW build-time API origin; rotation persist + server unsubscribe.
- **PR-45:** skins/pages lazy per route, stable SSR shell (ya client-only structural skin), bundle budget.

### Wave 7 — Platform quality

- **PR-46:** CI: server-render tests, public backend job, schema↔backup test, migration matrix, route↔view wiring test, bundle budgets, fail-on-warning gates.
- **PR-47:** dependency upgrades — mgmt Svelte toolchain (7 advisories), React `react-router`/`@xmldom/xmldom` (3 advisories), `engines`/`packageManager` pins, lockfile policy.
- **PR-48:** structured telemetry (request/job IDs, cache HIT/MISS, rows read, payload bytes, latency, queue depth, snapshot age, budget usage) + alerts; retention for failed blobs, render_jobs, ai_fixes, official mail, inactive push, Neon chat.

## 3. Sequencing (parallel-safe groups)

```
W0: 01, 02                       (independent)
W1a: 03 → 04 → 05                (loans, serial)
W1b: 06 → 07                     (queue, parallel to W1a)
W1c: 08 → 09                     (session)
W1d: 10 → 11                     (mgmt client)
W1e: 12 → 13                     (validation)
W1f: 14                          (storage)
W1g: 02 → 15                     (backup)
W1h: 16 → 17                     (public correctness)
W2: 18 → {19,20,21,22,23,24} → 25
W3: 26 → 27 → 28 ; {29,30} ; 31 → 32
W4: 33 → 34 → 35                 (ops window required)
W5: {36,37} → {38,39,40,41}
W6: 42 ; 17 → {43,44} ; 36 → 45
W7: 46 → {47,48}
```

## 4. Verification per PR

```
# always
git diff --check

# touched app only (or all before merging a wave)
cd Public/backend && node --check src/index.js
cd Public/frontend-v6 && npm ci && npm run check && npm test && npm run build
cd mgmt/backend && npm ci && npm test && npm run lint:errors
cd mgmt/frontend-svelte && npm ci && npm run check && npm test && VITE_API_URL=https://example.invalid npm run build
cd mgmt/frontend && npm ci && VITE_API_URL=https://example.invalid npm run build
cd mgmt/server-render && npm install && npm test
```

Plus us PR ke naye tests, aur security/dependency PRs mein `npm audit --omit=dev`.

## 5. Ops steps jo mujhse nahi ho sakte (aapke liye)

1. **PR-14** ke baad existing public consent objects ka remediation apply (dry-run report review karke).
2. **PR-34/35** ke migrations live D1 par chalane ka window + pre-migration backup.
3. **PR-27/29/30** ke liye Render env/secrets aur GitHub token scope update.
4. **PR-43/44** ke liye hosting headers (`sw.js` no-cache) aur self-hosted font assets.
5. **PR-47** ke baad staging par smoke test (major dependency upgrades).

## 6. Aapki confirmation ke liye

- **Default assumptions** (agar aap kuch aur na bolo): cookie-only auth direction (PR-09/10 me groundwork, bearer ek release tak accepted), consent files private + authenticated access, `portalData` backward-compatible rahega (PR-24 additive sections), skins lazy (PR-45), chat raw logging default off, migrations detect → repair → enforce (PR-33/34/35 alag).
- Bolo **"OK, start karo"** → main PR-01 se shuru karunga aur wave-wise PRs banata jaunga, har wave ke baad status update dunga.
- Ya specific order bolo (jaise "sirf W0+W1 abhi") to main utna hi karunga.
