# Full Codebase Audit — chhath-full-codebase

**Date:** 2026-09-04 · **Scope:** all 160 files / ~22,180 LOC
(`mgmt/backend` Worker, `mgmt/frontend` React SPA, `Public/backend` Worker, `Public/frontend` static site, `mgmt/db` schema + migrations, `tools/`)

**Verdict up front:** this codebase has had real, careful hardening work done on it (the inline comments document dozens of previously-fixed bugs, and the error/rate-limit/caching layers are better than most projects this size). But it still contains **two privilege-escalation holes that let a non-Superadmin become Superadmin or forge legal consent records**, a **broken-access-control hole that exposes every member's PII to every logged-in user**, a **completely non-functional error-escalation path**, and **zero automated tests of any kind**. It is not production-ready in its current state.

**Production-readiness score: 4.5 / 10** (rationale at the end.)

---

## Severity legend

| | Meaning |
|---|---|
| **Critical** | Exploitable now, causes privilege escalation, data destruction, or forgery of legal records. Fix before next deploy. |
| **High** | Security/data-integrity risk or a broken core feature. Fix this sprint. |
| **Medium** | Correctness, performance, or operability problem that will bite under load or during an incident. |
| **Low** | Code quality, dead code, minor divergence. Fix opportunistically. |

Counts: **4 Critical · 19 High · 38 Medium · 21 Low** (82 findings).

---

# 1. CRITICAL

## C-1 — Privilege escalation: `updateRecord` accepts *any* table in the registry, including `login_users`

**File:** `mgmt/backend/src/crud.js:151` (`updateRecordByIdx`) + `mgmt/backend/src/index.js:344` (router) + `mgmt/backend/src/auth.js:530` (`requireRole`)
**Severity: Critical**

`requireRole(user, 'edit', sheetName)` only consults the *action*:

```js
// auth.js:530
const ROLE_PERMISSIONS = { Superadmin: ['add','edit','delete'], Admin: ['add','edit'], Subadmin: ['add'] };
export function requireRole(user, action, sheetName) {
  const allowed = ROLE_PERMISSIONS[user.role] || [];
  if (!allowed.includes(action)) throw PermissionError(...);
  if (action === 'add' && user.role === 'Subadmin' && sheetName) { /* only 'add' is table-scoped */ }
}
```

`resolveSheet()` happily resolves **35 tables**, including `login` → `login_users`, `activity log`, `error_log`, `loan_consents`, `generated_files`, `portal_settings`. `TABLES_WITH_YEAR` doesn't include any of them, so even the year-lock check is skipped, and `validatePayload('LOGIN', …)` has no required fields.

**Exploit (an Admin promoting themselves to Superadmin):**

```json
POST / { "action":"updateRecord", "token":"<admin session>",
         "sheet":"LOGIN", "rowIndex": 7, "payload": { "Role":"Superadmin" } }
```
→ `UPDATE login_users SET role = 'Superadmin' WHERE id = 7`. `verifyToken()` re-reads the live role on the next request, so the escalation takes effect immediately.

Same primitive also allows an Admin to:
* `sheet:"loan_consents"`, `payload:{status:"accepted", verification_status:"verified"}` → **forge a legally-binding loan consent** without any OTP, photo, signature or geo.
* `sheet:"generated_files"`, `payload:{public_link:"https://evil/x.pdf"}` → replace a "✅ Verified Record" download on the public portal.
* `sheet:"activity log"` → **tamper with the audit trail** that is supposed to prove who did what.

**Fix — whitelist the tables each mutating action may touch, per role:**

```js
// mgmt/backend/src/crud.js — add near the top
// Only these sheets may EVER be reached through the generic saveRecord /
// updateRecord / deleteRecord router actions. Everything else (logins, consents,
// audit logs, the generated-file index, portal settings) has a dedicated,
// individually-gated handler and must NOT be reachable generically.
const GENERIC_CRUD_SHEETS = new Set([
  'USERS', 'COLLECTIONS', 'EXPENSES', 'COMMITEE MEMBERS', 'LOANS', 'LOAN GUARANTOR',
]);

function assertGenericSheetAllowed(sheetName) {
  const n = (sheetName || '').toString().trim().toUpperCase();
  if (!GENERIC_CRUD_SHEETS.has(n)) {
    throw PermissionError(
      `"${sheetName}" cannot be modified through this endpoint. Use its own dedicated screen/action.`
    );
  }
  return n;
}
```

then call it as the **first** statement of all three entry points:

```js
export async function saveRecord(env, sheetName, payload, user) {
  assertGenericSheetAllowed(sheetName);          // <-- ADD
  requireRole(user, 'add', sheetName);
  ...
}

export async function updateRecordByIdx(env, sheetName, rowIndex, payload, user) {
  assertGenericSheetAllowed(sheetName);          // <-- ADD
  requireRole(user, 'edit', sheetName);
  ...
}

export async function deleteRecordByIdx(env, sheetName, rowIndex, user) {
  assertGenericSheetAllowed(sheetName);          // <-- ADD
  requireRole(user, 'delete', sheetName);        // also pass the sheet (was omitted)
  ...
}
```

Add `import { PermissionError } from './auth.js';` to `crud.js`. Also extend `requireRole` so `edit`/`delete` are table-scoped the way `add` already is:

```js
// auth.js
const ROLE_WRITE_SHEETS = {
  Subadmin: { add: ['USERS', 'COLLECTIONS'], edit: [], delete: [] },
  Admin:    { add: null, edit: null, delete: [] },   // null = all generic sheets
  Superadmin: { add: null, edit: null, delete: null },
};
export function requireRole(user, action, sheetName) {
  const perRole = ROLE_WRITE_SHEETS[user.role];
  if (!perRole) throw PermissionError(`Your role (${user.role || 'unknown'}) has no write permission.`);
  const allowedSheets = perRole[action];
  if (allowedSheets === undefined) throw PermissionError(`Your role (${user.role}) cannot ${action}.`);
  if (Array.isArray(allowedSheets)) {
    if (allowedSheets.length === 0) throw PermissionError(`Your role (${user.role}) cannot ${action}.`);
    const n = (sheetName || '').toString().trim().toUpperCase();
    if (!allowedSheets.includes(n)) throw PermissionError(`Your role can only ${action} ${allowedSheets.join(' and ')}.`);
  }
}
```

---

## C-2 — Any staff user can overwrite any generated PDF, including consent legal documents

**File:** `mgmt/backend/src/index.js:565` (router) + `mgmt/backend/src/docxTemplates.js:243` (`convertDocxToPdf`)
**Severity: Critical**

The router passes **client-controlled `mode`, `recordId`, `docType`, `year` and `force`** straight through:

```js
// index.js:565
convertDocxToPdf: () => withAuth(env, req, (user) =>
  docx.convertDocxToPdf(env, req.docType, req.year, req.recordId, req.base64,
                        req.fileName, user, req.mode, { force: !!req.force })),
```

and `convertDocxToPdf` picks its authorization *from that client value*:

```js
// docxTemplates.js:244
const m = CONVERT_MODES.includes(mode) ? mode : 'bulk';
if (m === 'public') { if (user) requireStaffRole(user); }
else if (m === 'bulk') { requireSuperadmin(user); }
else { requireStaffRole(user); }            // 'auto' | 'single'  <-- attacker picks this
```

A **Subadmin** sends `mode:"auto"`, `docType:"consent_loaner"`, `recordId:"consent_loaner-2026-CN<victim>"`, `force:true` and arbitrary `.docx` bytes. `recordGeneratedFile()` does an `ON CONFLICT … DO UPDATE`, so the existing row is **overwritten** and the public portal's "✅ Verified Record" now serves the attacker's document. The `Superadmin`-only intent of `'bulk'` is decorative.

**Fix — derive the mode server-side from the caller's role; never trust `req.mode`:**

```js
// index.js — replace the convertDocxToPdf handler
convertDocxToPdf: () => withAuth(env, req, (user) => {
  // The MODE is a server-side decision, not a client parameter (it selects the
  // authorization branch). 'single'/'auto' may only ever write a record id that
  // matches the docType they are allowed to produce; 'bulk' is Superadmin-only.
  const requested = req.mode === 'bulk' ? 'bulk' : 'single';
  if (requested === 'bulk') requireSuperadmin(user);
  return docx.convertDocxToPdf(
    env, req.docType, req.year, req.recordId, req.base64, req.fileName,
    user, requested,
    // Only a Superadmin may force-overwrite an already-indexed document.
    { force: user.role === 'Superadmin' && !!req.force }
  );
}),
```

and defend in depth inside `docxTemplates.js`:

```js
// docxTemplates.js — inside convertDocxToPdf, after the DOC_TYPES check
// Consent PDFs are legal documents. They may ONLY be produced by the token-gated
// public path (convertDocxToPdfPublic) or by a Superadmin bulk run — never by an
// ordinary staff call that can choose its own recordId.
const CONSENT_DOC_TYPES = new Set(['consent_loaner', 'consent_guarantor']);
if (CONSENT_DOC_TYPES.has(docType) && m !== 'public' && m !== 'bulk') {
  throw PermissionError('Consent documents cannot be generated from this screen.');
}
// The recordId must belong to the docType being written.
if (recordId && !recordId.startsWith(`${docType}-${parseInt(year)}-`)) {
  throw ValidationError('recordId does not match the requested document type/year.');
}
```

The same hole exists via the queue: `collectionQueue.enqueueCollectionJob` stores client-supplied `doc_type` / `record_id` / `filled_base64`, and `runOneJob` then calls `convertDocxToPdf` with a **forced `{ role: 'Superadmin', system: true }`** user (`collectionQueue.js:283`). Apply the same restriction at enqueue time:

```js
// collectionQueue.js — in enqueueCollectionJob, after the year checks
const QUEUEABLE_DOC_TYPES = new Set(['', 'receipt', 'certificate', 'samaan']);
const dt = (job.docType || '').toString();
if (!QUEUEABLE_DOC_TYPES.has(dt)) throw new Error('This document type cannot be queued.');
if (job.recordId && dt && !job.recordId.toString().startsWith(`${dt}-`)) {
  throw new Error('recordId does not match docType.');
}
// Cap the payload — filled_base64 is unbounded today (see H-6).
if ((job.filledBase64 || '').length > 8 * 1024 * 1024) throw new Error('The document is too large to queue.');
```

---

## C-3 — Consent tokens and OTPs are handed to every staff role, enabling consent forgery

**File:** `mgmt/backend/src/loans.js:706` (`getLoanConsents`), `loans.js:722` (`getConsentsForReview`)
**Severity: Critical**

```js
// loans.js:706
export async function getLoanConsents(env, loanId, user) {
  requireStaffRole(user);                       // includes Subadmin
  const { results } = await env.DB_LOANS_EXPENSES
    .prepare('SELECT * FROM loan_consents WHERE loan_id = ?').bind(loanId).all();
  ...
```

`SELECT *` returns `token` **and** `otp` (plus `ip_address`, `geo_lat/lng`, `photo_url`, `signature_url`). With those two values a Subadmin can:

1. `verifyConsentOtp(token, otp)` → receives a valid `verifyToken`;
2. `respondConsent(token, 'accepted', …, verifyToken)` → **accepts the loan on the guarantor's behalf**, complete with a fabricated photo/signature/geo.

`getConsentsForReview` leaks the same columns for *every* accepted/declined consent in the system, unpaginated.

**Fix — never select the credential columns; project explicitly:**

```js
// loans.js — add once near the top
// Columns safe to return to an admin screen. `token` and `otp` are CREDENTIALS
// (they are sufficient to impersonate the consenting person — see
// verifyConsentOtp/respondConsent) and must never leave the Worker.
const CONSENT_ADMIN_COLS = `
  id, consent_id, loan_id, person_id, role, status, otp_verified, send_count,
  created_at, responded_at, device_id, ip_address, user_agent,
  geo_lat, geo_lng, geo_accuracy, photo_url, signature_url, decline_remarks,
  verification_status, verification_remarks, verified_by, verified_at`;

export async function getLoanConsents(env, loanId, user) {
  requireAdminOrAbove(user);                    // was requireStaffRole — Subadmin has no business here
  const { results } = await env.DB_LOANS_EXPENSES
    .prepare(`SELECT ${CONSENT_ADMIN_COLS} FROM loan_consents WHERE loan_id = ?`)
    .bind(loanId).all();
  ...
}

export async function getConsentsForReview(env, user) {
  requireAdminOrAbove(user);
  const limit = 500;                            // was unbounded
  const { results } = await env.DB_LOANS_EXPENSES.prepare(
    `SELECT ${CONSENT_ADMIN_COLS} FROM loan_consents
      WHERE status IN ('accepted','declined')
      ORDER BY responded_at DESC LIMIT ?`
  ).bind(limit).all();
  ...
}
```

Additionally **burn the OTP on successful verification** (the comment at `loans.js:521` claims this happens, but only the KV meta is rewritten — the DB `otp` column is left intact):

```js
// loans.js — in verifyConsentOtp, replace the otp_verified UPDATE
await env.DB_LOANS_EXPENSES
  .prepare("UPDATE loan_consents SET otp_verified = 1, otp = '' WHERE id = ?")
  .bind(rowObj.id).run();
```

---

## C-4 — OTPs and consent tokens are generated with `Math.random()`

**File:** `mgmt/backend/src/loans.js:16-19`, `mgmt/backend/src/announcements.js:12`
**Severity: Critical**

```js
// loans.js:16
function generateLoanId()      { return 'LN' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function generateConsentId()   { return 'CN' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function generateConsentToken(){ return crypto.randomUUID().replace(/-/g,'') + Math.random().toString(36).slice(2, 8); }
function generateOtp()         { return String(Math.floor(100000 + Math.random() * 900000)); }
```

`Math.random()` is **not a CSPRNG**. The 6-digit OTP that authorizes a legally-binding consent is drawn from a predictable PRNG whose state can be recovered from a handful of observed outputs (and an attacker can *request* outputs freely via `requestConsentOtp`, 5/hour/consent, and observe `consent_id` suffixes). `announcements.js:12` builds the announce link token the same way.

**Fix — use `crypto.getRandomValues` everywhere:**

```js
// mgmt/backend/src/loans.js  (and mirror in announcements.js)
function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
// Rejection-free uniform 6-digit OTP from a CSPRNG.
function generateOtp() {
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= 4294000000); // reject the biased tail
  return String(100000 + (v % 900000));
}
function generateLoanId()       { return 'LN' + randomHex(8); }
function generateConsentId()    { return 'CN' + randomHex(8); }
function generateConsentToken() { return randomHex(32); }   // 256 bits
```

```js
// mgmt/backend/src/announcements.js:12
function generateAnnouncementToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
function generateCustomAnnouncementId() {
  return 'CA' + [...crypto.getRandomValues(new Uint8Array(8))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
```

Same `Math.random()` pattern (lower impact — these are only ids, not credentials) at: `whatsapp.js:43` (`TPL…`), `whatsapp.js:92` (`GRP…`), `loans.js:868` (`LTPL…`), `popups.js:107` (`POP…`), `popups.js:189` (`SLD…`), `collectionQueue.js:35` (`JOB…`), `logger.js:36` (`ERR…`), `backup.js:239` (staging-table suffix), `device.js:8`, `Public/backend/src/index.js:414`. Route them all through a shared `randomHex()`.


---

# 2. HIGH

## H-1 — IDOR: any logged-in user can read any member's full profile and financial history

**File:** `mgmt/backend/src/index.js:319-320`, `mgmt/backend/src/views.js:96` / `:118`
**Severity: High**

```js
// index.js:319
getUserHistory: () => withAuth(env, req, () => getUserHistory(env, req.userId)),
getUserProfile: () => withAuth(env, req, () => getUserProfile(env, req.userId)),
```

No role check, no "is this me?" check. `getUserProfile` returns the raw `users` row (`Mobile`, `Email`, `WhatsApp`, father's name, village), every contribution with amount and payment mode, every loan taken (amount/rate/tenure/status) and every loan guaranteed. Any Subadmin can enumerate `USER0001…USER9999`. Worse, the results are cached in KV (`CACHEABLE_ACTIONS` at `index.js:100`) keyed only by `userId`, so the PII sits in the shared KV namespace for 5 minutes (see H-4).

`getUsers` (`index.js:311`) likewise dumps `SELECT *` from `users` — email + mobile for the whole village — to any role.

**Fix:**

```js
// index.js
getUserHistory: () => withAuth(env, req, (user) => {
  // A staff member may look up a contributor's history (they need it to record a
  // contribution), but this must be an explicit, role-gated decision.
  requireStaffRole(user);
  return getUserHistory(env, req.userId);
}),
// A full profile (contact details + every loan + every guarantee) is either YOUR
// OWN or an Admin/Superadmin action.
getUserProfile: () => withAuth(env, req, (user) => {
  if ((req.userId || '').toString().trim() !== user.name) requireAdminOrAbove(user);
  return getUserProfile(env, req.userId);
}),
getUsers: () => withAuth(env, req, (user) => {
  requireStaffRole(user);
  return getSheetDataAsJSON(env, 'USERS');
}),
```

and strip contact details from the list read that every role needs:

```js
// mgmt/backend/src/views.js — new function; use it for the getUsers action
// The contributor picker only needs id/name/village/designation. Mobile, WhatsApp
// and Email are contact data and are fetched per-person, role-gated, when needed.
export async function getUsersForPicker(env) {
  const { results } = await env.DB_CORE.prepare(
    `SELECT id, id_code, name, name_hindi, village, village_hindi,
            designation, designation_hindi, fathers_name, fathers_name_hindi
       FROM users ORDER BY id ASC`
  ).all();
  return results.map(r => fromColumnRow('users', r));
}
```

Also remove `getUserProfile` and `getUserHistory` from `CACHEABLE_ACTIONS` (or add the caller's role to the cache key) — a cache whose key does not include the authorization dimension is a latent leak by construction.

## H-2 — "Report to WhatsApp" has never worked: it reads a column that does not exist

**File:** `mgmt/backend/src/errorLog.js:57`
**Severity: High** (broken core feature — the entire escalation path for production errors)

```js
// errorLog.js:57
const superadminMembers = (await getSheetDataAsJSON(env, 'COMMITEE MEMBERS'))
  .filter(m => m.Role === 'Superadmin');
```

`committee_members` has **no `role` column** (`mgmt/db/schema/core.sql:6-14`: `year, name, created_by, view_role, view_role_hindi, whatsapp`), and `fromColumnRow` maps `view_role` → `'View Role'`. So `m.Role` is always `undefined`, `superadminMembers` is always `[]`, and every call throws:

> `No Superadmin WhatsApp/Mobile number is registered in USERS.`

Every `ReportErrorButton` on the public Consent/Announce pages is therefore dead. The same latent bug is in the public frontend: `Public/frontend/script.js:648` renders `r.Role || u.Designation`, so the committee **role** never shows on the public site — it silently displays the person's designation instead.

**Fix:**

```js
// errorLog.js:57 — the column is `view_role`, surfaced as 'View Role'
const superadminMembers = (await getSheetDataAsJSON(env, 'COMMITEE MEMBERS'))
  .filter(m => (m['View Role'] || '').toString().trim().toLowerCase() === 'superadmin');

// Belt and braces: if no committee row is tagged Superadmin, fall back to the
// actual Superadmin LOGINS, so error escalation can never silently have no target.
let targets = superadminMembers.map(m => waNumberOf(userMap[m.Name]));
if (!targets.filter(Boolean).length) {
  const { results: admins } = await env.DB_CORE
    .prepare("SELECT name FROM login_users WHERE role = 'Superadmin'").all();
  targets = (admins || []).map(a => waNumberOf(userMap[a.name]));
}
const numbers = [...new Set(targets.filter(Boolean))];
```

```js
// Public/frontend/script.js:648
${escapeHtml(r['View Role'] || u.Designation || 'Member')}
```

## H-3 — Every user-facing validation error is returned as HTTP 500 with a generic message

**File:** `mgmt/backend/src/index.js:222` (`httpStatusForError`), `:812` (catch block) — affects **107 `throw new Error(...)` sites**
**Severity: High** (breaks the UX of every form + floods the error log)

```js
// index.js:812
const safeMessage = isExpectedError(err)
  ? (err.message || String(err))
  : 'Something went wrong on the server. Please try again; the committee has been notified.';
```

`isExpectedError` only returns true for `ValidationError` / `PermissionError` / `AuthError`. But the majority of user-facing messages are raw `Error`s:

* `crud.js:101` `Missing required field: Amount`
* `crud.js:111` `Amount must be a number`
* `crud.js:116` `Mobile must be 10 digits`
* `loans.js:127` `Exactly 3 guarantors required`
* `loans.js:132` `Rule Violation: A Committee Member cannot be a Guarantor`
* `loans.js:575-577` `Location permission is required in order to Accept.` / `Capturing a photo is required…`
* `loans.js:826` `The loan is not Approved yet…`
* …104 more.

Result: a member who forgets to allow location on the **public consent page** is told *"Something went wrong on the server"*, the request returns **500**, and a spurious `error_log` row is written — exactly the log-noise problem the `ValidationError` class was introduced to solve.

**Fix — convert every user-facing throw to `ValidationError`.** Mechanical pass; start with the highest-traffic files:

```js
// crud.js — add the import and swap the throws
import { requireRole, requireYearUnlocked, requireYearAccess, ValidationError, PermissionError } from './auth.js';

function validatePayload(sheetName, payload) {
  ...
      throw ValidationError(`Missing required field: ${f}`);
  ...
  if (normalized === 'COLLECTIONS' && isResell && !(payload.Detail || '').toString().trim())
    throw ValidationError('The name of the resold item is required');
  ...
    throw ValidationError('Amount must be a number');
  ...
        throw ValidationError(f + ' must be 10 digits');
}
```

```js
// loans.js
if (!guarantorPayloads || guarantorPayloads.length !== 3) throw ValidationError('Exactly 3 guarantors required');
if (new Set(ids).size !== ids.length)                     throw ValidationError('Receiver and Guarantors must all be different');
...
if (!geoLat || !geoLng)   throw ValidationError('Location permission is required in order to Accept.');
if (!photoBase64)         throw ValidationError('Capturing a photo is required in order to Accept.');
if (!signatureBase64)     throw ValidationError('Uploading a signature is required in order to Accept.');
```

Add a lint rule / CI grep to stop regressions:

```bash
# fails if a bare `throw new Error` appears in a request path (drive.js/config.js are infra-only)
! grep -rn "throw new Error(" mgmt/backend/src \
    --exclude=drive.js --exclude=config.js --exclude=backup.js
```

## H-4 — The Public Worker is bound to the **same KV namespace** that holds mgmt session tokens and the Drive OAuth token

**File:** `Public/backend/wrangler.toml:24-26` vs `mgmt/backend/wrangler.toml:47-49` — both `id = "fc720867ed48459bb723279a56767711"`
**Severity: High**

The unauthenticated, internet-facing public Worker holds a read/write binding to the namespace that stores:

* `session:<raw token>` → full mgmt session objects (name + role) keyed **by the raw token**;
* `drive_access_token` → a live Google Drive OAuth access token;
* `mgmtcache:getUserProfile:*` → cached member PII (see H-1);
* `loginfail:*`, `consentotp:*` → lockout counters and OTP verification proofs.

The current public code only reads `pub:*` keys, but that is a **convention enforced by a comment**, not a boundary. One bug, one dependency, or one future feature in the public Worker turns into full session theft and a Drive credential leak. It also means the two Workers compete for the same ~1000/day free-tier KV write budget — which `Public/backend/src/index.js:141` already documents as a real outage cause.

**Fix — give the public Worker its own namespace:**

```bash
wrangler kv namespace create PUBLIC_CACHE
```

```toml
# Public/backend/wrangler.toml — replace the KV_SESSIONS block
# Dedicated namespace. The public Worker must NOT be able to reach mgmt's session
# store (session:<token>), the Drive OAuth token, or the mgmt response cache.
[[kv_namespaces]]
binding = "KV_PUBLIC"
id = "<new id from the command above>"
```

then rename every `env.KV_SESSIONS` in `Public/backend/src/index.js` to `env.KV_PUBLIC` (10 sites: lines 152, 168, 179, 190, 204, 215, 229). Drop the now-redundant `pub:` prefixes or keep them — harmless either way.

Additionally, **stop storing sessions keyed by the raw token**. `mgmt/backend/src/auth.js:266` does `KV_SESSIONS.put('session:' + token, …)`; a KV dump therefore yields directly replayable tokens (the audit DB deliberately stores only a hash — KV should match):

```js
// auth.js — key KV on the hash too, so the raw token exists only in transit
const sessionKey = (th) => 'session:' + th;

// in login():
await env.KV_SESSIONS.put(sessionKey(tokenHash),
  JSON.stringify({ name: actualName, role: user.role, expiresAt, th: tokenHash }),
  { expirationTtl: Math.floor(ttl / 1000) });

// in verifyToken() / doLogout():
const th = await sha256Hex(token);
const cached = await env.KV_SESSIONS.get(sessionKey(th));
```

## H-5 — The public portal ships the entire member + finance database to every anonymous visitor

**File:** `Public/backend/src/index.js:250` (`getAllPortalData`), consumed by `Public/frontend/script.js:150`
**Severity: High** (privacy + performance)

One unauthenticated `GET ?action=portalData` returns **eight unpaginated full-table scans**: every user (name, father's name, village, designation, Hindi variants), every collection row with amounts, every expense, every loan with interest rate and status, every guarantor relationship, every generated-file link, and every consent (loan_id/role/status/person_id).

The Worker's own comment (`index.js:186`) budgets **60,000 rows per build**. That is a multi-megabyte JSON blob parsed on a low-end Android phone, and it exposes the *social graph* of who guaranteed whose loan — considerably more than the "transparency" the UI actually renders (aggregates + a searchable list).

Data minimisation has been done for `mobile`/`email`/`signature`, which is good — but the shape is still wrong.

**Fix — split the payload and paginate:**

```js
// Public/backend/src/index.js — replace the single portalData action with:
//   ?action=summary            aggregates per year (tiny, safe to cache forever)
//   ?action=collections&year=  paginated page of that year's rows only
//   ?action=person&id=         one person's public record (used by Download Center)
// Keep ?action=portalData as a deprecated alias that serves ONLY the current year.
const PAGE = 500;

if (action === 'collections') {
  const year = parseInt(url.searchParams.get('year')) || new Date().getFullYear();
  const offset = Math.max(0, parseInt(url.searchParams.get('offset')) || 0);
  const { results } = await env.DB_COLLECTIONS.prepare(
    `SELECT id, year, sl_no, name, amount, payment_mode, date,
            contribution_type, detail, certificate_or_receipt, is_resell
       FROM collections WHERE year = ? ORDER BY id ASC LIMIT ? OFFSET ?`
  ).bind(year, PAGE, offset).all();
  ...
}
```

Interim mitigation (one line, deployable today) — stop shipping the guarantor graph and consents, which nothing on the public page needs except the Download Center's per-person lookup:

```js
// getAllPortalData — drop these two keys and move their use behind ?action=person
// guarantors: ...,
// loanConsents: ...,
```

Also note the last-known-good snapshot (`index.js:215`, `KV.put(SNAPSHOT_KEY, JSON.stringify(dataObj))`) will **silently exceed KV's 25 MB value limit** at that scale — the `catch {}` swallows the failure, so the outage fallback quietly stops existing. Add a size guard:

```js
const body = JSON.stringify(dataObj);
if (body.length > 20 * 1024 * 1024) {   // KV hard limit is 25 MB
  await logPublicError(env, 'public-backend', 'maybeSaveSnapshot',
    `Snapshot skipped: payload is ${(body.length/1048576).toFixed(1)} MB (KV limit 25 MB) — the D1-outage fallback is NOT available.`,
    '', '{}', '');
  return;
}
```

## H-6 — Unbounded base64 uploads on both authenticated and public endpoints

**Files:** `mgmt/backend/src/loans.js:28` (`uploadConsentFile`), `account.js:170` (`uploadFileToDrive`), `docxTemplates.js:107` (`assertValidDocxBase64`), `collectionQueue.js:80` (`filled_base64`)
**Severity: High** (memory exhaustion / DoS / free-tier burn)

`base64ToBytes` supports a `maxBytes` option — and it is only used by `popups.js:196` (8 MB) and `seo.js:19` (8 MB). Every other path is unlimited:

```js
// loans.js:28  — PUBLIC endpoint (respondConsent), no session required
const bytes = base64ToBytes(base64, { label: fileName || 'File' });   // no maxBytes
// account.js:170 — uploadFile action, Admin+
const bytes = base64ToBytes(base64Data, { label: fileName || 'File' });
// docxTemplates.js:107 — validates format but never size
```

A single anonymous `respondConsent` with a 60 MB base64 photo will blow the Worker's 128 MB heap; `collection_jobs.filled_base64` has no cap and is written to D1 (which has a 1 MB row/2 MB statement practical limit — larger writes fail *after* the record was already saved).

**Fix — cap every entry point:**

```js
// mgmt/backend/src/base64.js — export shared, documented limits
export const MAX_PHOTO_BYTES     = 6 * 1024 * 1024;   // consent photo/signature (client sends ~200-400 KB)
export const MAX_DOCX_BYTES      = 10 * 1024 * 1024;  // a .docx template with a letterhead image
export const MAX_GENERIC_UPLOAD  = 8 * 1024 * 1024;
export const MAX_QUEUE_BASE64    = 8 * 1024 * 1024;   // must also fit a D1 row
```

```js
// loans.js:28
import { base64ToBytes, MAX_PHOTO_BYTES } from './base64.js';
async function uploadConsentFile(env, base64, fileName, year) {
  if (r2Available(env)) {
    const bytes = base64ToBytes(base64, { label: fileName || 'File', maxBytes: MAX_PHOTO_BYTES });
    ...
```

```js
// account.js:170
const bytes = base64ToBytes(base64Data, { label: fileName || 'File', maxBytes: MAX_GENERIC_UPLOAD });
```

```js
// docxTemplates.js — in assertValidDocxBase64, after the UEsDB check
if (base64ByteLength(b64) > MAX_DOCX_BYTES) {
  throw ValidationError(`This .docx is too large (max ${MAX_DOCX_BYTES / 1048576} MB).`);
}
```

## H-7 — `uploadFile` publishes arbitrary attacker-chosen content to a world-readable Drive folder

**File:** `mgmt/backend/src/index.js:352` + `account.js:161`
**Severity: High**

```js
// index.js:352
uploadFile: () => withAuth(env, req, (user) => {
  requireAdminOrAbove(user);
  return uploadFileToDrive(env, req.base64, req.fileName, req.mimeType);   // makePublic defaults TRUE
}),
```

No extension/magic-number check, no size cap, no filename sanitisation, and `makePublic` defaults to `true` (`account.js:162`), so the file is shared `{role:'reader', type:'anyone'}`. An Admin (or anyone with a stolen Admin session) can host arbitrary HTML/phishing/malware on the committee's Google account and hand out a `drive.google.com` link. Note this action has **no caller in the frontend** — `api.uploadFile` is exported but never used.

**Fix — delete the action (preferred), or lock it down:**

```js
// index.js — remove the handler entirely; nothing calls it.
// (also remove `uploadFile` from mgmt/frontend/src/api.js)
```

If it must stay:

```js
uploadFile: () => withAuth(env, req, (user) => {
  requireSuperadmin(user);
  // The real type comes from the bytes, never from the client's mimeType, and the
  // object is uploaded PRIVATE. Only images are accepted.
  const bytes = base64ToBytes(req.base64, { label: 'File', maxBytes: MAX_GENERIC_UPLOAD });
  const sniffed = sniffImageMime(bytes);
  if (!sniffed || sniffed === 'image/heic') throw ValidationError('Only JPG/PNG/GIF/WebP images can be uploaded.');
  const safeName = (req.fileName || '').toString().replace(/[^\w.\-]+/g, '_').slice(0, 80) || `file_${Date.now()}`;
  return uploadFileToDrive(env, req.base64, safeName, sniffed, { makePublic: false });
}),
```

## H-8 — `saveLoanTransaction` is not atomic: a loan can exist with no guarantors

**File:** `mgmt/backend/src/loans.js:141-160`
**Severity: High** (data integrity on financial records)

```js
// loans.js:141 — INSERT #1, committed on its own
await env.DB_LOANS_EXPENSES.prepare(`INSERT INTO loans (...) VALUES (...)`).bind(...).run();
// loans.js:158 — a SEPARATE batch
await env.DB_LOANS_EXPENSES.batch(guarStmts);
```

If the guarantor batch fails (bad payload key, D1 timeout, Worker eviction), the loan row is already persisted with `loan_status='Created'` and **zero** guarantors — and `recomputeLoanStatus` (`loans.js:301`) requires `results.length > 0`, so it can never be approved or cleaned up through the UI. `deleteLoanTransaction` (`loans.js:187`) has the mirror problem: it deletes `loans` and `loan_guarantors` but **never `loan_consents`**, leaving live consent tokens pointing at a deleted loan.

**Fix — one batch for the whole transaction:**

```js
// loans.js — replace both writes with a single batch
const loanCols = toColumnPayload('loans', loanPayload);
const loanKeys = Object.keys(loanCols);
const stmts = [
  env.DB_LOANS_EXPENSES.prepare(
    `INSERT INTO loans (${loanKeys.join(', ')}) VALUES (${loanKeys.map(() => '?').join(', ')})`
  ).bind(...loanKeys.map(k => loanCols[k])),
  ...guarantorPayloads.map(gPayload => {
    gPayload['Created By'] = user.name;
    gPayload['Loan ID'] = loanId;
    const cols = toColumnPayload('loan_guarantors', gPayload);
    const keys = Object.keys(cols);
    return env.DB_LOANS_EXPENSES.prepare(
      `INSERT INTO loan_guarantors (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    ).bind(...keys.map(k => cols[k]));
  }),
];
// D1 batch is a single implicit transaction: either the loan AND all three
// guarantors land, or nothing does.
await env.DB_LOANS_EXPENSES.batch(stmts);
```

```js
// loans.js — deleteLoanTransaction: also remove the consents (and their live tokens)
const stmts = [
  env.DB_LOANS_EXPENSES.prepare('DELETE FROM loans WHERE id = ?').bind(rowIndex),
];
if (loanId) {
  const lid = loanId.toString().trim();
  stmts.push(env.DB_LOANS_EXPENSES.prepare('DELETE FROM loan_guarantors WHERE loan_id = ?').bind(lid));
  // Orphaned consent rows keep VALID tokens that still resolve in
  // findConsentRowByToken — they must go with the loan.
  stmts.push(env.DB_LOANS_EXPENSES.prepare('DELETE FROM loan_consents WHERE loan_id = ?').bind(lid));
} else {
  if (!loanerId) throw ValidationError('Either a Loan ID or the loaner id is required to delete a loan.');
  stmts.push(env.DB_LOANS_EXPENSES.prepare('DELETE FROM loan_guarantors WHERE year = ? AND loaner = ?')
    .bind(parseInt(year), loanerId.toString().trim()));
}
await env.DB_LOANS_EXPENSES.batch(stmts);
```

(The `else` branch also fixes an unguarded `loanerId.toString()` → `TypeError` when both `loanId` and `loanerId` are absent — `loans.js:194`.)

## H-9 — `Sl. No.` allocation is a read-then-write race, producing duplicate receipt numbers

**File:** `mgmt/backend/src/crud.js:132`
**Severity: High**

```js
// crud.js:132
const row = await d1.prepare('SELECT MAX(sl_no) as maxSl FROM collections WHERE year = ?')
  .bind(payload.Year).first();
payload['Sl. No.'] = (row && row.maxSl ? row.maxSl : 0) + 1;
```

Two volunteers saving simultaneously (very likely during a festival collection drive) both read the same max and both write the same `sl_no`. `RECEIPT_NO` is derived from it (`NCS-<year>-<sl_no>`, `templates.js:196`) — so **two different people get the same receipt number**, and the QR/verification story breaks. The same pattern exists for `USER####` ids (`crud.js:126`).

**Fix — allocate inside the INSERT so SQLite serialises it:**

```js
// crud.js — replace both pre-computations
if (normalized === 'COLLECTIONS') {
  // Allocate sl_no INSIDE the INSERT so two concurrent saves cannot read the same
  // MAX() and both write it. SQLite evaluates the subquery under the write lock.
  const cols = toColumnPayload(table, payload);
  delete cols.sl_no;
  const keys = Object.keys(cols);
  const result = await d1.prepare(
    `INSERT INTO collections (${keys.join(', ')}, sl_no)
     VALUES (${keys.map(() => '?').join(', ')},
             (SELECT COALESCE(MAX(sl_no), 0) + 1 FROM collections WHERE year = ?))`
  ).bind(...keys.map(k => cols[k]), payload.Year).run();
  return { success: true, id: null, rowIndex: result.meta.last_row_id };
}
```

and add the constraint that makes a duplicate impossible even if a new code path appears:

```sql
-- mgmt/db/migration/2026-09-05/01-integrity.sql   (DB: chhath-collections)
-- Two concurrent saves used to be able to allocate the same Sl. No. for a year,
-- which produced two identical RECEIPT_NOs. Deduplicate, then enforce.
UPDATE collections SET sl_no = id
 WHERE id NOT IN (SELECT MIN(id) FROM collections GROUP BY year, sl_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_collections_year_sl_no ON collections(year, sl_no);
```

```sql
-- DB: chhath-core — same class of race for USER#### ids
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_id_code ON users(id_code);
-- login_users.name is the session/identity key; a duplicate makes
-- findLoginRowByIdentifier()'s LIMIT 1 non-deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_login_users_name  ON login_users(name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_login_users_email ON login_users(email);
```

## H-10 — Missing index on `users.id_code` — every profile read is a full table scan

**File:** `mgmt/db/schema/core.sql:98-99` (only `village`, `mobile` are indexed); `mgmt/backend/src/views.js:129` claims otherwise
**Severity: High** (performance / free-tier row-read quota)

```js
// views.js:129 — comment says "indexed: idx_users... on id_code". No such index exists.
const user = (await getSheetDataByColumn(env, 'USERS', 'id_code', id))[0];
```

`getUserProfile` performs **1 users scan + 1 loans scan per referenced loaner + 1 users scan per loaner** — at 32k users that's tens of thousands of rows read per profile open, against a shared 5M/day free-tier budget. Missing indexes also on `loan_consents.consent_id` (used by `setConsentVerification`, `resendConsent`, `replaceGuarantor`, `notifyConsentVerified`), `popups.popup_id`, `custom_announcements.id_code`.

**Fix:**

```sql
-- mgmt/db/migration/2026-09-05/02-missing-indexes.sql
-- DB: chhath-core
CREATE INDEX IF NOT EXISTS idx_users_id_code ON users(id_code);

-- DB: chhath-loans-expenses
-- consent_id is the business key for setConsentVerification / resendConsent /
-- replaceGuarantor / notifyConsentVerified — all of them were full scans.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_consents_consent_id ON loan_consents(consent_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_consents_token      ON loan_consents(token);
CREATE INDEX        IF NOT EXISTS idx_loan_consents_role      ON loan_consents(role);

-- DB: chhath-misc
CREATE UNIQUE INDEX IF NOT EXISTS uq_popups_popup_id                ON popups(popup_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_announcements_id_code   ON custom_announcements(id_code);

-- DB: chhath-logs
-- logger.js's de-dup query filters (source, page, message, created_at) but only
-- created_at was indexed, so EVERY logError did a near-full scan of error_log.
CREATE INDEX IF NOT EXISTS idx_error_log_dedup ON error_log(source, page, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);
```

## H-11 — `getUserProfile` is an N+1 query loop

**File:** `mgmt/backend/src/views.js:157-176`
**Severity: High**

```js
// views.js:157
for (const lid of neededLoanIds)   { const rows = await getSheetDataByColumn(env, 'LOANS', 'loan_id', lid); ... }
for (const lname of neededLoanerIds) { loansByLoanerName[lname] = await getSheetDataByColumn(env, 'LOANS', 'name', lname); }
for (const lid of neededLoanerIds) { const u = (await getSheetDataByColumn(env, 'USERS', 'id_code', lid))[0]; ... }
```

Three sequential `await` loops. A person who guaranteed 10 loans triggers ~30 round-trips, each one currently a full table scan (H-10). `docxTemplates.js:456` (`getPersonDownloads`) has the same shape — `isFileGenerated()` inside a `for` over every collection, plus a per-loan `await` in two more loops.

**Fix — batch with a single `IN (…)` query:**

```js
// views.js — replace the three loops
const inList = (n) => Array.from({ length: n }, () => '?').join(', ');

const loanIds = [...neededLoanIds];
const loanerIds = [...neededLoanerIds].filter(Boolean);

const [loanRows, loanerLoanRows, loanerUserRows] = await Promise.all([
  loanIds.length
    ? env.DB_LOANS_EXPENSES.prepare(`SELECT * FROM loans WHERE loan_id IN (${inList(loanIds.length)})`)
        .bind(...loanIds).all().then(r => r.results || [])
    : [],
  loanerIds.length
    ? env.DB_LOANS_EXPENSES.prepare(`SELECT * FROM loans WHERE name IN (${inList(loanerIds.length)})`)
        .bind(...loanerIds).all().then(r => r.results || [])
    : [],
  loanerIds.length
    ? env.DB_CORE.prepare(`SELECT * FROM users WHERE id_code IN (${inList(loanerIds.length)})`)
        .bind(...loanerIds).all().then(r => r.results || [])
    : [],
]);

const loansByLoanId = {};
loanRows.map(r => fromColumnRow('loans', r)).forEach(l => { loansByLoanId[l['Loan ID']] = l; });
const loansByLoanerName = {};
loanerLoanRows.map(r => fromColumnRow('loans', r)).forEach(l => {
  (loansByLoanerName[(l.Name || '').toString().trim()] ||= []).push(l);
});
const nameById = {};
loanerUserRows.map(r => fromColumnRow('users', r)).forEach(u => { nameById[u.ID] = u.Name; });
```

```js
// docxTemplates.js — getPersonDownloads: one query instead of one per record
const wantedIds = collections.map(c => c.recordId).concat(loanerRecordIds, guarantorRecordIds);
const { results: genRows } = wantedIds.length
  ? await env.DB_FILE_INDEX.prepare(
      `SELECT doc_type, year, record_id, public_link FROM generated_files
        WHERE record_id IN (${wantedIds.map(() => '?').join(', ')})`
    ).bind(...wantedIds).all()
  : { results: [] };
const genByRecord = {};
(genRows || []).forEach(g => { genByRecord[g.record_id] = g; });
// then: publicLink: (genByRecord[recordId] || {}).public_link || null
```

## H-12 — Session tokens live in `localStorage` with a 30-day lifetime

**File:** `mgmt/frontend/src/api.js:6-18`
**Severity: High**

```js
const TOKEN_KEY = 'cpm_token';
store.setItem(TOKEN_KEY, token);    // localStorage when "remember me" (default TRUE in Login.jsx:7)
```

Any XSS anywhere in the SPA — or a malicious browser extension, or a shared/kiosk device — yields a 30-day Superadmin token. There is no CSP (`mgmt/frontend/vercel.json` sets only rewrites), and the app loads third-party script from `googletagmanager.com` and `fonts.googleapis.com`, so the XSS surface is not hypothetical.

**Fix (short term — reduce the blast radius):**

```js
// mgmt/frontend/src/components/Login.jsx:7
const [remember, setRemember] = useState(false);   // was true — don't default to a 30-day localStorage token
```

```js
// mgmt/backend/src/auth.js:6
const SESSION_LONG_MS = 7 * 24 * 60 * 60 * 1000;   // was 30 days
```

**Fix (proper) — move to an `HttpOnly; Secure; SameSite=Strict` cookie.** The API already accepts the token in the body, so migrate incrementally: set the cookie at login, prefer `Cookie` over `req.token` in `withAuth`, and drop body tokens once all clients are updated.

```js
// mgmt/backend/src/index.js — login handler
const res = await login(env, req.name, req.password, req.rememberMe, req.serverIp, req.deviceInfo);
if (res && res.success) {
  const maxAge = Math.floor((res.expiresAt - Date.now()) / 1000);
  return jsonOut({ ...res, token: undefined }, request, env, 200, {
    'Set-Cookie': `cpm_session=${res.token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
  });
}
```

```js
// auth.js — withAuth prefers the cookie
export async function withAuth(env, req, fn, request) {
  const cookie = request ? (request.headers.get('Cookie') || '') : '';
  const m = /(?:^|;\s*)cpm_session=([^;]+)/.exec(cookie);
  const token = (m && m[1]) || req.token;         // body token kept only for the migration window
  const user = await verifyToken(env, token);
  if (!user) throw AuthError('Session expired, please login again');
  return fn(user);
}
```

Note: once the token travels in a cookie, CSRF becomes real — `api.js:143` deliberately omits `Content-Type` to avoid a preflight, which makes every request a CORS "simple request". You must then add a double-submit CSRF token or require `Content-Type: application/json` (which forces a preflight and re-enables the `ALLOWED_ORIGINS` check).

## H-13 — Every admin's IP is sent to a third party on every page load

**File:** `mgmt/frontend/src/device.js:22-29`, called from `api.js:130` on **every** API call
**Severity: High** (privacy / availability / dead weight)

```js
export function getClientIp() {
  if (!cachedIpPromise) {
    cachedIpPromise = fetch('https://api.ipify.org?format=json') ...
```

`api.call()` `await`s this before the *first* request of every page load, so a slow or blocked `ipify` **delays the first API call** (and in a restrictive network it costs the full fetch timeout). The value is then **discarded**: `index.js:190` overwrites `req.clientIp` with `CF-Connecting-IP` and keeps the client value only as a labelled hint. This is a GDPR-relevant third-party data flow with zero benefit.

**Fix — delete it:**

```js
// mgmt/frontend/src/device.js — remove getClientIp entirely
// (the server records the authoritative CF-Connecting-IP; a client-reported IP is
//  both spoofable and useless, and fetching it leaked every admin's IP to ipify)
```

```js
// mgmt/frontend/src/api.js:2
import { getDeviceId, getDeviceInfo } from './device.js';
...
// api.js:130
async function call(action, params = {}, requireAuth = true) {
  const body = { action, ...params, deviceId: getDeviceId(), deviceInfo: getDeviceInfo() };
```

Then drop `clientIpReported` from `buildLogContext` (`index.js:206`) — it will always be empty.

## H-14 — No security headers on either frontend

**File:** `mgmt/frontend/vercel.json` (rewrites only); `Public/frontend` has no config at all
**Severity: High**

No CSP, no `X-Frame-Options`/`frame-ancestors` (the admin portal is clickjackable), no `Referrer-Policy` (the **consent token is in the URL path** — `/consent/:token` — and leaks in the `Referer` of every outbound link/image, including the Google Drive image loads), no HSTS, no `X-Content-Type-Options`.

**Fix:**

```json
// mgmt/frontend/vercel.json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://lh3.googleusercontent.com https://drive.google.com https://files-chhath.shaharpura.com https://www.google-analytics.com; connect-src 'self' https://chhath-mgmt-api.shaharpura.workers.dev https://www.google-analytics.com; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        { "key": "Referrer-Policy", "value": "no-referrer" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" },
        { "key": "Permissions-Policy", "value": "camera=(self), geolocation=(self), microphone=()" }
      ]
    }
  ]
}
```

`Referrer-Policy: no-referrer` is the important one here — it is what stops the consent token leaking to Google. Add an equivalent `Public/frontend/vercel.json` (its CSP can be much tighter: no `connect-src` beyond the public Worker).

## H-15 — Password change does not invalidate other sessions

**File:** `mgmt/backend/src/account.js:139` (`changePassword`), `account.js:75` (`updateLoginUser`)
**Severity: High**

Neither function touches `user_sessions` or KV. The canonical "I think someone has my password" remediation therefore **does nothing** — the attacker's existing session (up to 30 days) keeps working. Same for a Superadmin resetting a compromised account's password.

**Fix:**

```js
// mgmt/backend/src/auth.js — add
// Revokes every session of a login (used after a password change / role change /
// forced reset). The KV entries can't be deleted directly (we only hold hashes),
// so verifyToken()'s revoked_at check is what actually kills them on next use.
export async function revokeAllSessionsFor(env, name, exceptTokenHash) {
  if (!env.DB_AUDIT) return;
  try {
    await env.DB_AUDIT.prepare(
      `UPDATE user_sessions SET revoked_at = ?
        WHERE name = ? AND revoked_at IS NULL AND token_hash != ?`
    ).bind(new Date().toISOString(), name, exceptTokenHash || '').run();
  } catch (e) { /* best effort */ }
}
```

```js
// account.js — changePassword, after the UPDATE
await env.DB_CORE.prepare('UPDATE login_users SET password = ?, updated_at = ? WHERE id = ?')
  .bind(newHashed, new Date().toISOString(), row.id).run();
// A password change must log out every OTHER device — otherwise "someone knows my
// password" has no remediation and a stolen 30-day token stays valid.
await revokeAllSessionsFor(env, user.name, user.th);
return { success: true, otherDevicesLoggedOut: true };
```

```js
// account.js — updateLoginUser, when a password or role is changed
if (password) { ...; await revokeAllSessionsFor(env, currentName, null); }
```

## H-16 — `restoreBackup` runs a full second export in-request; both can exceed Worker limits mid-flight

**File:** `mgmt/backend/src/backup.js:193` + `:120`
**Severity: High** (data-loss risk during the *recovery* path)

`restoreBackup` first calls `exportBackup(env, user)` to build a safety snapshot — i.e. it materialises **every row of every table twice** (snapshot + the incoming backup) in one 128 MB Worker invocation, then does per-table staging writes. The code already warns about this for export (`BACKUP_ROW_WARN = 150000`) but restore has no such guard, and a CPU/memory kill lands **in the middle of the table-by-table swap**, leaving some tables restored and others not — with the rollback snapshot never delivered to the operator.

**Fix — require the operator to supply a fresh snapshot, and make the restore resumable per table:**

```js
// backup.js — restoreBackup
// A safety snapshot must exist BEFORE we start, but building it in this same
// request doubles the memory and can be killed mid-swap. Require the caller to
// have downloaded one (the UI already offers "Download backup" first) and to pass
// its checksum, and restore ONE binding per request so a kill can't straddle
// databases.
export async function restoreBackup(env, user, backup, confirm, opts = {}) {
  requireSuperadmin(user);
  if ((confirm || '').toString().trim().toUpperCase() !== 'RESTORE') {
    throw ValidationError('Restore not confirmed — type exactly "RESTORE" in the confirmation box.');
  }
  if (!opts.snapshotAcknowledged) {
    throw ValidationError(
      'Download a fresh backup first, then re-run the restore with the "I have a current backup" box ticked.'
    );
  }
  const only = (opts.onlyBinding || '').toString();
  if (!only || !BACKUP_MAP[only]) {
    // Tell the UI which bindings to walk, one request each.
    return { success: true, staged: true, bindings: Object.keys(BACKUP_MAP).filter(b => backup.data[b]) };
  }
  // ... restore ONLY `only`, return its report; the UI loops over the list.
}
```

## H-17 — Announce-link PIN lockout is keyed only on the token → trivial denial of service

**File:** `mgmt/backend/src/announcements.js:73`
**Severity: High**

```js
const lockKey = 'announcepinfail:' + token;
```

Anyone who has the (shareable, WhatsApp-distributed) announce URL can send 5 wrong PINs and lock the link for **15 minutes** — mid-ceremony, for the operator on stage. `login()` was already fixed to key on `identifier + IP` (`auth.js:229`) for exactly this reason; this path was missed. The PIN is also not required to be numeric despite `inputMode="numeric"`, and `generateAnnouncementLink` echoes the PIN back in the response.

**Fix:**

```js
// announcements.js — verifyAnnouncementPin(env, token, pin, clientIp)
export async function verifyAnnouncementPin(env, token, pin, clientIp) {
  if (!token || !pin) return { success: false, message: 'PIN is required' };
  // Key on token + edge IP so an attacker's wrong guesses only lock THEIR OWN IP
  // out, never the operator's on-stage device (mirrors auth.js's login lockout).
  const ip = (clientIp || '').toString().trim();
  const lockKey = ip ? `announcepinfail:${token}:${ip}` : `announcepinfail:${token}`;
  ...
```

```js
// index.js router
verifyAnnouncementPin: () => announce.verifyAnnouncementPin(env, req.token, req.pin, req.serverIp),
```

```js
// announcements.js — generateAnnouncementLink: enforce digits, stop echoing the PIN
if (!/^\d{6,}$/.test((pin || '').toString().trim())) {
  throw ValidationError(`PIN must be at least ${ANNOUNCE_MIN_PIN_LENGTH} digits (numbers only).`);
}
...
return { success: true, token };   // the caller already typed the PIN; don't echo it back
```

## H-18 — `reannounceAll` / `markAnnounced` mutate financial-adjacent data behind a 6-digit PIN, and race

**File:** `mgmt/backend/src/announcements.js:220` (`markAnnounced`), `:236` (`reannounceAll`)
**Severity: High**

Two problems:

1. **Read-modify-write race.** `markAnnounced` does `SELECT announcedcount` then `UPDATE … SET announcedcount = ?`. Two operators (or a double-tap on the on-stage device — the UI has the button in two places, `AnnouncePage.jsx:57` and `:421`) lose a count.
2. `reannounceAll` binds `session.year` — which came from `announcement_links.year` (a `REAL` column read back into KV as a **number or string** depending on how it was written) — against `collections.year`. A string/REAL affinity mismatch silently matches **0 rows**, so "Re-announce" appears to work and does nothing.

**Fix:**

```js
// announcements.js — atomic increment, no read-then-write
export async function markAnnounced(env, announceToken, itemId, itemType) {
  await requireAnnounceSession(env, announceToken);
  if (itemType === 'custom') {
    const r = await env.DB_MISC.prepare(
      `UPDATE custom_announcements
          SET announced = 1, announcedcount = COALESCE(announcedcount, 0) + 1
        WHERE id_code = ? RETURNING announcedcount`
    ).bind(itemId.toString()).first();
    if (!r) throw ValidationError('Item not found');
    return { success: true, announcedCount: r.announcedcount };
  }
  const rowIndex = parseInt(itemId);
  if (!rowIndex) throw ValidationError('Item not found');
  const r = await env.DB_COLLECTIONS.prepare(
    `UPDATE collections
        SET announced = 1, announcedcount = COALESCE(announcedcount, 0) + 1
      WHERE id = ? RETURNING announcedcount`
  ).bind(rowIndex).first();
  if (!r) throw ValidationError('Item not found');
  return { success: true, announcedCount: r.announcedcount };
}
```

```js
// announcements.js — reannounceAll: coerce the year, and report what changed
const year = parseInt(session.year);
if (!year) throw ValidationError('This announce link has no valid year.');
...
const res = await env.DB_COLLECTIONS
  .prepare('UPDATE collections SET announced = 0, announcedcount = 0 WHERE year = ?')
  .bind(year).run();
// Returning the count makes a silent no-op impossible to miss.
return { success: true, collectionsReset: res.meta.changes };
```

## H-19 — Zero tests. No test runner, no test file, no CI.

**Files:** none exist. No `test`/`vitest`/`jest` script in any of the four `package.json`s; no `.github/workflows`.
**Severity: High**

22k lines of code handling money, legally-binding consent, and role-based access control, with **no automated verification of any kind**. Every finding in this document could have been a failing test. Full breakdown in §6.



---

# 3. MEDIUM

### Security / access control

**M-1 · `mgmt/backend/src/index.js:530-534, 543-547, 556-560` — template read actions have no role check.**
`getReceiptTemplates` / `getReceiptTemplate` / `getCertificateTemplate*` / `getSamaanTemplate*` are `withAuth(env, req, () => tpl.getTemplates(...))` with **no role argument at all** — any Subadmin can read the full Markdown of every year's receipt/certificate template.
```js
getReceiptTemplates: () => withAuth(env, req, (user) => { requireStaffRole(user); return tpl.getTemplates(env, 'receipt'); }),
getReceiptTemplate:  () => withAuth(env, req, (user) => { requireStaffRole(user); return tpl.getTemplate(env, 'receipt', req.year); }),
// …same for certificate / samaan
```

**M-2 · `mgmt/backend/src/docxTemplates.js:334` — `getRecordsForDocType` gates only on year access, not role.**
It returns placeholder maps for **every** record of a year, including `MOBILE` for every contributor. A Subadmin who was on the committee that year gets the lot.
```js
export async function getRecordsForDocType(env, docType, year, user) {
  requireSuperadmin(user);            // ADD — this is a bulk-generation input, Superadmin-only
  await requireYearAccess(env, user, year);
```

**M-3 · `mgmt/backend/src/templates.js:185, 200, 214` — `getReceiptData`/`getCertificateData`/`getSamaanData` gate only on year access.** Same pattern; add `requireStaffRole(user);` before `requireYearAccess`.

**M-4 · `mgmt/backend/src/index.js:635` — `processCollectionQueue` is an unmetered heavy-work trigger for any staff role.**
`processCollectionQueueOnDemand` → `processPendingJobs` → up to 5 Google Drive conversions per call. `QueueStatus.jsx:28` calls it from a 10 s poll. Any Subadmin can loop it and burn the Drive quota / Worker CPU.
```js
// collectionQueue.js — add a KV-backed cooldown
const DRAIN_COOLDOWN_MS = 5000;
export async function processCollectionQueueOnDemand(env, user) {
  requireStaffRole(user);
  if (env.KV_SESSIONS) {
    const last = parseInt(await env.KV_SESSIONS.get('cq:lastdrain') || '0', 10) || 0;
    if (Date.now() - last < DRAIN_COOLDOWN_MS) return { processed: 0, throttled: true };
    await env.KV_SESSIONS.put('cq:lastdrain', String(Date.now()), { expirationTtl: 60 });
  }
  return processPendingJobs(env);
}
```

**M-5 · `mgmt/backend/src/collectionQueue.js:284` — the queue processor fabricates a Superadmin identity.**
`const systemUser = { name: job.created_by || 'system', role: 'Superadmin', system: true };` — every authorization decision downstream sees a Superadmin. Safer to add an explicit `system: true` bypass to the role helpers and pass the *real* stored role, so a future gate can distinguish "internal caller" from "Superadmin".

**M-6 · `mgmt/backend/src/auth.js:508` — `withApiKey` compares a secret via hex-encoded `timingSafeEqualHex`, but leaks length.**
`timingSafeEqualHex` (`auth.js:96`) starts with `let diff = x.length ^ y.length` and loops `Math.max` — constant *given the lengths*, but an attacker still learns the key length from timing the loop. Hash both sides first:
```js
export async function withApiKey(env, req, fn) {
  if (!req.apiKey || !env.WHATSAPP_QUEUE_API_KEY) throw PermissionError('Invalid API key');
  const [a, b] = await Promise.all([sha256Hex(req.apiKey.toString()), sha256Hex(env.WHATSAPP_QUEUE_API_KEY.toString())]);
  if (!timingSafeEqualHex(a, b)) throw PermissionError('Invalid API key');   // fixed-length inputs
  return fn();
}
```
(`withApiKey` also needs to become `async` at its two call sites, `index.js:686` and `:692`.)

**M-7 · `mgmt/backend/src/popups.js:96` — `roles` is stored unvalidated.**
`savePopup` accepts any string; a typo (`'SuperAdmin'`) silently makes the popup invisible forever. Validate against the known set:
```js
const VALID_POPUP_ROLES = ['Superadmin', 'Admin', 'Subadmin', 'Public'];
const list = (Array.isArray(roles) ? roles : (roles || '').split(',')).map(r => r.trim()).filter(Boolean);
const bad = list.filter(r => !VALID_POPUP_ROLES.includes(r));
if (bad.length) throw ValidationError(`Unknown role(s): ${bad.join(', ')}. Allowed: ${VALID_POPUP_ROLES.join(', ')}.`);
const rolesStr = list.join(',');
```

**M-8 · `mgmt/backend/src/account.js:106` — `updateOwnProfile` does not validate `Email`.**
`Mobile`/`WhatsApp` get a 10-digit check; `Email` is written raw (and can be set to another user's email, breaking email login's `LIMIT 1`). Add the same regex `addLoginUser` uses, plus a uniqueness check.

**M-9 · `mgmt/backend/src/index.js:222` — `httpStatusForError` cannot distinguish 400 from 403 reliably.**
It relies on `err.permission`, which only `PermissionError` sets — every `ValidationError` used for an authorization-ish message becomes 400. Minor, but it makes WAF/monitoring rules unreliable. Prefer an explicit `err.status`.

**M-10 · `mgmt/frontend/src/api.js:143` — requests deliberately omit `Content-Type` to dodge the CORS preflight.**
That makes every call a CORS *simple request*, so `ALLOWED_ORIGINS` (`index.js:171`) is never enforced for the request itself — only the response is hidden from the attacker. Harmless while the token is in the body (H-12), fatal once it moves to a cookie. Set `'Content-Type': 'application/json'` and accept the preflight.

**M-11 · `mgmt/backend/src/drive.js:22` — Drive query string is built by escaping only `'`.**
`getOrCreateFolder` interpolates `name` into a Drive `q=` expression with `name.replace(/'/g, "\\'")`. All current callers pass constants, so it is not exploitable today — but it is a search-injection primitive waiting for the first dynamic folder name. Whitelist instead:
```js
if (!/^[\w .\-]{1,80}$/.test(name)) throw new Error(`Unsafe Drive folder name: ${name}`);
```

**M-12 · `Public/backend/src/index.js:264` — public rate limiter samples writes 1-in-20, so a burst of ≤20 rps per IP is never counted.**
Documented as a deliberate KV-write tradeoff, and reasonable — but it means `PUB_RL_MAX = 60` is really "60 in expectation", and a slow-drip scraper is invisible. Once the namespace is split (H-4) the write budget is no longer shared; raise `RL_SAMPLE` to 1 for the `logError` action at minimum.

**M-13 · `Public/backend/src/index.js:337` — the public `logError` per-IP limiter is a `LIKE '%…%'` scan of `error_log`.**
`SELECT COUNT(*) … WHERE created_at >= ? AND context LIKE ?` cannot use an index on `context`. Every public JS error costs a partial table scan. Add a dedicated column or move the counter to the (now separate) KV namespace.

### Correctness / bugs

**M-14 · `mgmt/backend/src/loans.js:346` — `getConsentByToken` loads the entire LOANS and USERS tables on a public endpoint.**
```js
const loans = await getSheetDataAsJSON(env, 'LOANS');
const loan = loans.find(l => l['Loan ID'] === loanId);
const users = await getSheetDataAsJSON(env, 'USERS');
```
Two full scans per anonymous consent-page open. Replace with `WHERE loan_id = ?` and an `IN (…)` over just the participants' `person_id`s. The same pattern is in `requestConsentOtp:392`, `respondConsent:586`, `notifyConsentAccepted:672`, `resendConsent:781`, `replaceGuarantor:823`, `markLoanDisbursed:838` — **seven** full USERS scans across the consent flow.

**M-15 · `mgmt/backend/src/announcements.js:180` — `buildAnnouncementQueue` scans USERS + COLLECTIONS + CUSTOM_ANNOUNCEMENTS in full, then filters in JS.** Called on every PIN verify *and* every 15-second poll from `AnnouncePage.jsx:187`. Use `getSheetDataByYear`.

**M-16 · `mgmt/backend/src/announcements.js:283` — `addCustomAnnouncement` reads every collection row just to compute `order`.**
```js
const row = await env.DB_COLLECTIONS.prepare('SELECT COUNT(*) AS n FROM collections WHERE year = ?').bind(parseInt(year)).first();
const order = row ? (row.n || 0) : 0;
```

**M-17 · `mgmt/backend/src/docxTemplates.js:339, 361` — `getRecordsForDocType` uses `getSheetDataAsJSON` + `filterByYear` (full scan) instead of `getSheetDataByYear`.** The Phase-1 index work was applied to `views.js` but not here.

**M-18 · `mgmt/backend/src/templates.js:171` — `resolveEntry` scans all collections to find one row by `__rowIndex`.**
```js
const entry = (await getSheetDataByColumn(env, 'COLLECTIONS', 'id', rowIndex))[0];
if (!entry) throw ValidationError('Collection entry not found.');
if (year && year !== 'All' && parseInt(entry.Year) !== parseInt(year)) throw ValidationError('Collection entry not found for this year.');
```

**M-19 · `mgmt/backend/src/views.js:8` — `getYears` performs five full table scans on every call.** Cached (5 min) but still five scans on every cache miss / version bump. Replace with five `SELECT DISTINCT year` queries (each index-served), run via `Promise.all`.

**M-20 · `mgmt/backend/src/popups.js:246, 271` — `getActivePopups` / `previewPublicPopups` read *all* popups and *all* slides then filter in JS.** Deliberate (to avoid the TEXT-affinity `active` trap) but now that migration 05 normalised the column to `'0'/'1'`, push the filter down: `WHERE active = '1' AND (start_at = '' OR start_at <= ?) AND (end_at = '' OR end_at >= ?)`.

**M-21 · `mgmt/backend/src/dataVersion.js:56` — the UPSERT fallback is a lossy read-modify-write.**
If `idx_portal_settings_key` (migration `08`) has not been applied, every write silently takes the racy path and increments can be lost — meaning the public portal serves stale data with a *matching* ETag. Make the missing index loud:
```js
} catch (e) {
  console.error('[bumpDataVersion] UPSERT failed — is idx_portal_settings_key applied?', e && e.message);
  await logWarn(env, 'backend', 'bumpDataVersion',
    'portal_settings has no UNIQUE index on "key" — falling back to a racy read-modify-write. Apply migration 2026-09-01/08.', {});
```

**M-22 · `mgmt/backend/src/whatsapp.js:206` — the claim `UPDATE … WHERE id IN (…)` is capped at 500 ids.**
`getPendingMessages(limit)` allows up to 500, producing a 500-placeholder statement plus a 500-placeholder re-read. D1 has a 100-parameter *soft* limit in some paths and this is fragile. Chunk the claim at 50.

**M-23 · `Public/backend/src/index.js:229` — `d1BudgetAdd` is a read-modify-write.** Concurrent builds each read the same counter, so the daily budget guard under-counts precisely when it matters (a flood).

**M-24 · `mgmt/frontend/src/useViewData.js:11-24` — `load` is memoised on `[key]` but closes over `fetcher`.**
```js
const load = useCallback((force) => { ... fetcher() ... }, [key]);
```
A `fetcher` capturing a changed prop (e.g. `year`) is stale until `key` changes. It happens to work because every call site puts the varying value in `key`, but it is a trap. Also `getCached(key)` is called three times per render, and `cached !== false` is a mystery guard.
```js
const fetcherRef = useRef(fetcher);
fetcherRef.current = fetcher;
const load = useCallback((force) => {
  const cached = force ? undefined : getCached(key);
  if (cached !== undefined) { setData(cached); setLoading(false); return; }
  setLoading(true); setError('');
  fetcherRef.current()
    .then(res => { setCached(key, res); setData(res); })
    .catch(err => { setError(err.message || 'Failed to load'); reportClientError('useViewData', `load failed for ${key}`, err); })
    .finally(() => setLoading(false));
}, [key]);
```
(It also swallows load errors without reporting them — the one place in the app where a failed read is invisible.)

**M-25 · `mgmt/frontend/src/views/Home.jsx:71-75` — unbounded, un-cancelled request on every contributor selection.**
```js
useEffect(() => { ...; api.getUserHistory(form.Name).then(setHistory)... }, [form.Name]);
```
No debounce and no abort, so rapid picking fires N requests whose responses can land out of order (older history shown for the newer person).
```js
useEffect(() => {
  if (!form.Name) { setHistory(null); return; }
  let alive = true;
  setHistoryLoading(true);
  const t = setTimeout(() => {
    api.getUserHistory(form.Name)
      .then(h => { if (alive) setHistory(h); })
      .catch(() => { if (alive) setHistory(null); })
      .finally(() => { if (alive) setHistoryLoading(false); });
  }, 250);
  return () => { alive = false; clearTimeout(t); };
}, [form.Name]);
```

**M-26 · `mgmt/frontend/src/views/Home.jsx:262` — `data.pastRet` is dereferenced without a guard.**
The render uses `data?.collections` defensively at line 79 but then `{fmt(data.pastRet)}` at 262. If `data` is `null` (backend returned `null`, which `api.js:158` explicitly passes through) the tab white-screens. Add `if (!data) return <div className="inline-spinner">Loading…</div>;` after the `error` check.

**M-27 · `mgmt/frontend/src/views/ConsentPage.jsx:60` — `getGeoLocation` can resolve twice.**
The 10 s `setTimeout` resolves `null` while `getCurrentPosition` is still pending; the later success callback then calls `resolve` again (a no-op, but the captured position is discarded and the user is told permission failed). Clear the pending request:
```js
function getGeoLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => finish(null), 10000);
    navigator.geolocation.getCurrentPosition(
      (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => finish(null),
      { timeout: 9000, maximumAge: 60000 }
    );
  });
}
```

**M-28 · `mgmt/frontend/src/views/ConsentPage.jsx:126` — the camera cleanup calls `setState` after unmount.**
`useEffect(() => () => stopCamera(), [])` and `stopCamera` ends in `setState('idle')`. Split the track-stopping from the state update:
```js
const stopTracks = () => { if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; } };
const stopCamera = () => { stopTracks(); setState('idle'); };
useEffect(() => stopTracks, []);   // cleanup must not touch state
```

**M-29 · `mgmt/frontend/src/useDropdownList.js:5` — the dropdown cache is a module singleton that survives logout.**
`let cache = null` is never cleared by `clearSession()`, so on a shared device the next user sees the previous session's lists. Export and call an invalidator from `App.logout()`.

**M-30 · `mgmt/frontend/src/cache.js:3` — the response cache is an unbounded `Map` with no eviction.** Entries are only removed when read after expiry, so a long session accumulates every `home:<year>` / `committee:<year>` payload. Add a size cap or a periodic sweep.

**M-31 · `mgmt/frontend/src/flags.js:9` vs `mgmt/backend/src/flags.js:19` — the two `isTruthyFlag` implementations still disagree.**
Backend accepts `'yes'` and trims; frontend accepts `String(v).toLowerCase() === 'true'` but **not** `'yes'`, and does not trim (`' 1 '` → false). The whole point of `flags.js` was to end this divergence.
```js
// mgmt/frontend/src/flags.js — make it byte-identical to the backend
export function isTruthyFlag(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null || v === undefined) return false;
  const s = v.toString().trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}
```
`Public/frontend/script.js:415` has a *third* variant (`isResellRow`) that only accepts `true`/`'TRUE'` — so a row stored as `'1'` renders as a contributor named "Unknown User".

**M-32 · `mgmt/frontend/src/views/Home.jsx:24` and `Public/frontend/script.js:415` — `Is Resell` is compared to the literal `'TRUE'`.**
`autoGenerateDocType` uses `payload['Is Resell'] === 'TRUE'` while `submit` writes `'TRUE'`/`'FALSE'` — consistent for new rows, but any row written as `1`/`true` (e.g. via the generic `updateRecord`) silently gets a receipt generated for a resold item. Use `isTruthyFlag` in all three places.

**M-33 · `mgmt/db/schema/*.sql` — numeric identity columns are declared `REAL`.**
`collections.year/sl_no/contribution_type/utr`, `users.mobile/whatsapp`, `committee_members.whatsapp`, `loans.year`, `loan_consents.otp/send_count`, `custom_announcements.year/order` — all `REAL`. This is the root cause of an entire class of bugs the code now works around in ~8 places (`toCleanStr`, `normalizeType`, `waNumber`'s exponential handling, `.replace(/\.0+$/,'')`). `utr REAL` will corrupt any UTR with a leading zero or >15 digits. Fix forward with a table rebuild:
```sql
-- DB: chhath-collections
CREATE TABLE collections_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER, sl_no INTEGER, name TEXT,
  amount REAL, created_by TEXT, payment_mode TEXT, date TEXT,
  contribution_type TEXT, detail TEXT, certificate_or_receipt TEXT,
  utr TEXT, is_resell TEXT, announced TEXT, announcedcount INTEGER
);
INSERT INTO collections_new SELECT id, CAST(year AS INTEGER), CAST(sl_no AS INTEGER), name,
  amount, created_by, payment_mode, date,
  CAST(CAST(contribution_type AS INTEGER) AS TEXT), detail, certificate_or_receipt,
  REPLACE(CAST(utr AS TEXT), '.0', ''), is_resell, announced, CAST(announcedcount AS INTEGER)
FROM collections;
DROP TABLE collections; ALTER TABLE collections_new RENAME TO collections;
-- recreate indexes (see schema/collections.sql + 03-scalability-indexes.sql)
```

**M-34 · No foreign keys anywhere.**
`collections.name → users.id_code`, `loan_guarantors.loan_id → loans.loan_id`, `loan_consents.loan_id → loans.loan_id`, `popup_slides.popup_id → popups.popup_id`, `generated_files.record_id` — all soft references. The code compensates with `.find()` and "Unknown User" fallbacks; the DB permits orphans (and H-8 produces them). D1 supports `PRAGMA foreign_keys` and `REFERENCES` — worth adding on the same-database relationships at least (`loans`↔`loan_guarantors`↔`loan_consents`, `popups`↔`popup_slides`).

**M-35 · `mgmt/db/schema/*` — no `NOT NULL` / `CHECK` constraints on anything except the audit tables.**
`loan_consents.status` can be any string; `login_users.role` can be any string (and an unknown role silently gets zero permissions, `auth.js:531`); `collections.amount` can be negative. Add `CHECK (status IN ('pending','accepted','declined','replaced'))`, `CHECK (role IN ('Superadmin','Admin','Subadmin'))`, `CHECK (amount >= 0)`.

### Production readiness

**M-36 · No health check on the Public Worker.** `mgmt` has `GET ?health=1` → 503 when degraded (`config.js:63`). The public Worker has nothing; an uptime monitor hitting `/` gets `{"status":false,"message":"Invalid Request"}` with **HTTP 400**, which most monitors treat as down. Add a `?health=1` that pings `DB_CORE` and returns 200/503.

**M-37 · No environment-variable validation at startup on the Public Worker.** `checkConfig` (`config.js:41`) exists only for mgmt. The public Worker will happily serve a partially-bound deployment (e.g. `DB_MISC` missing → popups silently disappear, `index.js:317` returns `[]`).

**M-38 · No retention/rotation on `activity_log`, `login_attempts`, `collection_jobs`, `person_messages`, `group_messages`.**
Only `error_log` got a 180-day trim (migration `04-logs.sql:48`), and even that was a one-shot `DELETE`, not a recurring job. `collection_jobs` stores `filled_base64` (megabytes each) **forever** — `getCollectionQueueStatus` deliberately doesn't select it, but it is still on disk. Add a cron-driven sweep:
```js
// mgmt/backend/src/index.js — in scheduled(), gated to run ~once an hour
async scheduled(event, env, ctx) {
  ctx.waitUntil(cq.processPendingJobs(env).catch(...));
  // Retention sweep (cheap, bounded). The cron fires every minute, so only act on
  // the top of the hour to avoid 60 pointless DELETEs an hour.
  if (new Date().getUTCMinutes() === 7) ctx.waitUntil(runRetentionSweep(env));
}
```
```js
// new: mgmt/backend/src/retention.js
const DAYS = (n) => new Date(Date.now() - n * 86400000).toISOString();
export async function runRetentionSweep(env) {
  const jobs = [
    // filled_base64 is the bulk of this table; blank it as soon as the job is done.
    [env.DB_MISC,  `UPDATE collection_jobs SET filled_base64 = '' WHERE status = 'done' AND filled_base64 != '' AND finished_at < ?`, DAYS(1)],
    [env.DB_MISC,  `DELETE FROM collection_jobs WHERE status = 'done' AND finished_at < ?`, DAYS(30)],
    [env.DB_LOGS,  `DELETE FROM error_log    WHERE created_at < ?`, DAYS(180)],
    [env.DB_LOGS,  `DELETE FROM activity_log WHERE timestamp  < ?`, DAYS(365)],
    [env.DB_AUDIT, `DELETE FROM login_attempts WHERE created_at < ?`, DAYS(90)],
    [env.DB_AUDIT, `DELETE FROM user_sessions  WHERE expires_at < ?`, Date.now() - 30 * 86400000],
    [env.DB_WHATSAPP_INDEX, `DELETE FROM person_messages WHERE status IN ('sent','failed') AND sent_at < ?`, DAYS(180)],
    [env.DB_WHATSAPP_INDEX, `DELETE FROM group_messages  WHERE status IN ('sent','failed') AND sent_at < ?`, DAYS(180)],
  ];
  for (const [db, sql, arg] of jobs) {
    if (!db) continue;
    try { await db.prepare(sql).bind(arg).run(); } catch (e) { /* best effort */ }
  }
}
```



---

# 4. PERFORMANCE

**P-1 · `mgmt/frontend/src/views/Home.jsx:79` — the whole collection list is filtered and rendered unvirtualised on every keystroke.**
```js
const filtered = (data?.collections || []).filter(r => { ... search ... });   // runs every render
```
With "All Years" selected this is every collection row ever recorded, each producing a `<div className="data-row">` with 6 nested spans. At a few thousand rows the search box becomes unusable on a mid-range Android phone.
```js
// 1) memoise the filter; 2) debounce the input; 3) cap what is rendered.
const [search, setSearch] = useState('');
const deferredSearch = useDeferredValue(search);          // React 18 — import from 'react'
const filtered = useMemo(() => {
  const q = deferredSearch.toLowerCase();
  return (data?.collections || []).filter(r => {
    if (isTruthyFlag(r['Is Resell'])) return (r.Detail || '').toLowerCase().includes(q);
    return ((userMap[r.Name] || {}).Name || '').toLowerCase().includes(q);
  });
}, [data, deferredSearch, userMap]);

const VISIBLE = 200;
const shown = filtered.slice(0, VISIBLE);
// …render `shown`, then:
{filtered.length > VISIBLE && (
  <div style={{ textAlign: 'center', padding: 12, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
    Showing {VISIBLE} of {filtered.length} — refine your search to narrow the list.
  </div>
)}
```
Also replace `key={i}` with `key={r.__rowIndex}` (line 347) — index keys force React to re-render every row when the filter changes, and cause input state to attach to the wrong row. Same fix needed in `Expenses.jsx:75`, `Committee.jsx:83`, `Loans.jsx:127`, `LoginManagement.jsx:90`, `WhatsApp.jsx:151,345`, `PopupManagement.jsx:280`, `UserProfileModal.jsx:41,56,69,85`.

**P-2 · `mgmt/backend/src/views.js:34` — `getHomeData('All')` returns every collection row in the response body.**
No pagination and no aggregation-only mode; the client then renders all of it (P-1). Add a `limit`/`offset` and an aggregates-only response:
```js
export async function getHomeData(env, year, opts = {}) {
  const isAll = !year || year === 'All';
  // Totals are computed IN D1 — we no longer need to ship every row just to sum it.
  const totals = await env.DB_COLLECTIONS.prepare(
    isAll ? 'SELECT COALESCE(SUM(amount),0) AS t FROM collections'
          : 'SELECT COALESCE(SUM(amount),0) AS t FROM collections WHERE year = ?'
  ).bind(...(isAll ? [] : [parseInt(year)])).first();
  const limit = Math.min(Math.max(parseInt(opts.limit) || 500, 1), 2000);
  const offset = Math.max(parseInt(opts.offset) || 0, 0);
  const { results } = await env.DB_COLLECTIONS.prepare(
    isAll ? 'SELECT * FROM collections ORDER BY year DESC, id DESC LIMIT ? OFFSET ?'
          : 'SELECT * FROM collections WHERE year = ? ORDER BY id DESC LIMIT ? OFFSET ?'
  ).bind(...(isAll ? [limit, offset] : [parseInt(year), limit, offset])).all();
  ...
  return { collections, totCol: totals.t, totExp, pastRet, totBudget, surplus, hasMore: collections.length === limit };
}
```

**P-3 · `mgmt/frontend/src/views/BulkGeneratePdfs.jsx:88` — bulk generation is strictly sequential with a Drive round-trip per record.**
Each iteration: 1 QR generation + 1 docx fill + 1 `convertDocxToPdf` (which itself is 3 Drive calls, or 2 with R2). For 500 receipts that is ~1500 sequential network calls in a browser tab the operator must not close. Batch with bounded concurrency:
```js
const CONCURRENCY = 4;   // Drive tolerates this comfortably; higher risks 429s
async function mapLimit(items, limit, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}
await mapLimit(records, CONCURRENCY, (rec) => processOne(rec));
```
Better still, move it server-side onto `collection_jobs` (the machinery already exists) so closing the tab doesn't abort the run.

**P-4 · `mgmt/backend/src/docxTemplates.js:29` — `getDocxTemplate` re-downloads the template bytes from Drive on every call.**
`getFileBytesBase64(env, row.drive_file_id)` on every receipt, every consent page load, every bulk record. The bytes change only when a Superadmin uploads. Cache in KV keyed on `drive_file_id` + `updated_at`:
```js
export async function getDocxTemplate(env, docType, year) {
  const row = await env.DB_TEMPLATES.prepare('SELECT * FROM docx_templates WHERE doc_type = ? AND year = ?')
    .bind(docType, parseInt(year)).first();
  if (!row) return null;
  // The bytes only change on upload, so key the cache on the file id + updated_at.
  const cacheKey = `docxtpl:${row.drive_file_id}:${row.updated_at || ''}`;
  let base64 = env.KV_SESSIONS ? await env.KV_SESSIONS.get(cacheKey).catch(() => null) : null;
  if (!base64) {
    base64 = await getFileBytesBase64(env, row.drive_file_id);
    if (env.KV_SESSIONS) await env.KV_SESSIONS.put(cacheKey, base64, { expirationTtl: 86400 }).catch(() => {});
  }
  return Object.assign({}, row, { base64, downloadUrl: `https://drive.google.com/uc?export=download&id=${row.drive_file_id}` });
}
```
(KV values are capped at 25 MB — fine for a `.docx`, and `MAX_DOCX_BYTES` from H-6 keeps it well under.)

**P-5 · `mgmt/backend/src/drive.js` — no timeout on any Google API `fetch`.**
Ten `fetch` calls with no `AbortSignal`. A hung Drive request consumes the whole Worker wall-clock budget and the operator sees a generic 500 with no clue.
```js
// drive.js — wrap every call
const DRIVE_TIMEOUT_MS = 20000;
async function withTimeout(promiseFn, label) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), DRIVE_TIMEOUT_MS);
  try { return await promiseFn(c.signal); }
  catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`${label} timed out after ${DRIVE_TIMEOUT_MS / 1000}s — Google Drive did not respond.`);
    throw e;
  } finally { clearTimeout(t); }
}
// usage:
const res = await withTimeout((signal) => fetch(url, { ...opts, signal }), 'Drive upload');
```
Same for `seo.js:196` (`triggerRebuild` calls an operator-supplied URL) and `whatsapp.js` has no outbound calls (fine).

**P-6 · `mgmt/backend/src/index.js:117` — `mgmtCachePut` re-serialises the full response into KV on every miss.**
For `getHome('All')` that is a multi-megabyte `JSON.stringify` + KV write per version bump, and KV values are capped at 25 MB (a silent `catch`, `index.js:120`). Skip the cache above a threshold:
```js
async function mgmtCachePut(env, action, param, version, result) {
  try {
    if (!env || !env.KV_SESSIONS) return;
    const body = JSON.stringify(result);
    // KV's hard value limit is 25 MB and a large write is slower than the D1 read
    // it saves. Above this, don't cache — just serve from D1 each time.
    if (body.length > 1_000_000) return;
    await env.KV_SESSIONS.put(`mgmtcache:${action}:${param}:v${version}`, body, { expirationTtl: MGMT_CACHE_TTL_SECONDS });
  } catch (e) { /* best effort */ }
}
```

**P-7 · `mgmt/frontend/src/App.jsx:169-181` — four unconditional fetches fire on login regardless of the landing tab.**
`getYears`, `getLockedYears`, `getUsers`, `getCommittee('All')`. `getUsers` is the whole users table and `getCommittee('All')` is every committee row ever — both blocking the first paint of Home. `getCommittee('All')` is only needed by the Loans tab (guarantor validation) and by `myCommitteeYears`; fetch a purpose-built endpoint instead:
```js
// backend: a tiny endpoint that answers only "which years was I on the committee?"
getMyCommitteeYears: () => withAuth(env, req, async (user) =>
  ({ years: Array.from(await getCommitteeYearsForName(env, user.name)) })),
```
```js
// App.jsx
const myYearsView = useViewData('myCommitteeYears', () => api.getMyCommitteeYears(), [user]);
const myCommitteeYears = useMemo(() => new Set((myYearsView.data?.years || []).map(Number)), [myYearsView.data]);
// …and lazy-load committeeAllView only when the Loans tab mounts.
```

**P-8 · `mgmt/frontend/src/components/QueueStatus.jsx:39` + `views/QueueMonitor.jsx:60` + `views/WhatsApp.jsx:409` — three independent 10–12 s polls, none of which pause when the tab is hidden.**
Three D1 queries every ~10 s per open tab, forever. Gate on visibility:
```js
useEffect(() => {
  load();
  const tick = () => { if (document.visibilityState === 'visible') load(); };
  timer.current = setInterval(tick, 10000);
  const onVis = () => { if (document.visibilityState === 'visible') load(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { clearInterval(timer.current); document.removeEventListener('visibilitychange', onVis); };
}, []);
```

**P-9 · `mgmt/backend/src/backup.js:120` — `exportBackup` materialises every table into one object.** Acknowledged in-code (`BACKUP_ROW_WARN`) but not solved; at the projected 32k-member scale this *will* exceed the Worker's memory. Stream it per binding (see H-16).

**P-10 · `mgmt/frontend/vite.config.js:30` — `manualChunks` groups all of React + router into one `vendor` chunk and both PDF libs into `pdf-utils`.** Reasonable, but `docx-utils` (docxtemplater + pizzip + image module) is ~400 KB and is eagerly pulled in by `ReceiptModal` → which `Home.jsx:14` lazy-loads, good — but `components/ReceiptModal.jsx:8` imports `docxFill.js` **statically**, defeating the `safeImport` used elsewhere. Make it dynamic for consistency.

---

# 5. CODE QUALITY

**Q-1 · No schema validation library anywhere.** Every handler does ad-hoc `if (!x) throw` on `req.*`. There are 90+ router actions and no single place that says what a valid request looks like. Introduce `zod` at the router boundary — it also fixes H-3 for free:
```js
// mgmt/backend/src/schemas.js
import { z } from 'zod';
const Year = z.union([z.number().int().min(1900).max(2200), z.literal('All'),
                      z.string().regex(/^\d{4}$/)]);
export const SCHEMAS = {
  saveRecord:   z.object({ sheet: z.string().min(1), payload: z.record(z.unknown()) }),
  updateRecord: z.object({ sheet: z.string().min(1), rowIndex: z.coerce.number().int().positive(),
                           payload: z.record(z.unknown()) }),
  deleteRecord: z.object({ sheet: z.string().min(1), rowIndex: z.coerce.number().int().positive() }),
  getHome:      z.object({ year: Year }),
  respondConsent: z.object({
    token: z.string().length(64), decision: z.enum(['accepted', 'declined']),
    verifyToken: z.string().min(20),
    geoLat: z.coerce.number().min(-90).max(90).optional(),
    geoLng: z.coerce.number().min(-180).max(180).optional(),
    photoBase64: z.string().max(8_400_000).optional(),
    signatureBase64: z.string().max(8_400_000).optional(),
    declineRemarks: z.string().max(2000).optional(),
  }),
  // …one entry per action
};
```
```js
// index.js — before dispatch
const schema = SCHEMAS[action];
if (schema) {
  const parsed = schema.safeParse(req);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonOut({ success: false, message: `${first.path.join('.') || 'request'}: ${first.message}` },
                   request, env, 400);
  }
  Object.assign(req, parsed.data);
}
```

**Q-2 · Inconsistent success/failure shape.** Handlers variously return `{success:true}`, `{success:true, ...summary}`, a bare array (`getYears`, `getErrorLog`, `getLoanConsents`), a bare object (`getHome`), `null` (`getDocxTemplate`), and `{status:true, seo}` (`publicGetSeo` — a *different* key). `api.js:158` has to special-case `null` and `api.js:172` special-cases `success === false`. Standardise on `{ ok: boolean, data?: T, message?: string }` behind a version bump.

**Q-3 · `Public/backend/src/index.js:33` and `mgmt/backend/src/tableRegistry.js:41` — the column-alias map is duplicated across two deployments** with a documented reason ("zero dependency on mgmt's source tree") — but the copies have already drifted: the public map has trailing spaces (`"Father's Name "`, `'Mobile '`, `announced_count`) that the mgmt map does not (`announcedcount`). Publish it as a tiny shared npm/workspace package, or generate both from one JSON.

**Q-4 · Three copies of `parseStoredDate`** (`mgmt/backend/src/popups.js:23`, `Public/backend/src/index.js:99`) with a comment saying they must stay identical. Same for `isTruthyFlag` (4 copies), `driveFileId`/`driveImageUrl` (`mgmt/frontend/src/driveUrl.js:42` and `Public/frontend/script.js:36`), and `escapeHtml`. Every one is a comment-enforced invariant.

**Q-5 · Dead code / unused exports:**
* `mgmt/backend/src/crud.js:63` `getSheetDataByColumn` is exported but the `SNAKE_SAFE` guard duplicates `tableRegistry`'s.
* `mgmt/backend/src/templates.js:238` `ensureSeedTemplate` has **no callers**.
* `mgmt/backend/src/dropdownLists.js:65` `DROPDOWN_LIST_SEED` is exported and unused ("kept as a reference").
* `mgmt/backend/src/r2.js:52` `keyFromR2Url` / `:44` `isR2Url` — used only by `storage.js`; fine, but `getFromR2`'s `contentType` return is never read.
* `mgmt/backend/src/index.js:1` imports `withApiKey, requireStaffRole, verifyToken` — `requireStaffRole` is imported but never used in that file.
* `mgmt/frontend/src/api.js:239` `api.uploadFile` — no callers (see H-7).
* `mgmt/backend/src/whatsapp.js:339` `renderTemplate` (the unchecked variant) — no callers; only `renderTemplateChecked` is used.
* `mgmt/backend/src/consentPlaceholders.js:36` `DOCUMENTED_GUARANTOR_SLOTS` is exported but only used internally.
* `mgmt/frontend/src/views/ConsentPage.jsx:157` `verifyStoreKey` is computed twice (once inline in the `useState` initialiser with a duplicated template literal).

**Q-6 · `mgmt/backend/src/index.js:245-838` — one 600-line handler map inside `fetch`.**
The entire router, all 90+ handlers, is re-constructed as a fresh object literal on **every single request** (including the closures). It is also untestable and unreviewable as a unit. Extract to a module-level map of `(env, req, ctx) => …` and look up by key.

**Q-7 · Config/secrets hygiene is mostly good but not complete.**
`wrangler.toml` correctly keeps secrets out and documents `wrangler secret put`. However:
* `mgmt/backend/wrangler.toml:47` / `Public/backend/wrangler.toml:26` commit a real KV namespace id and 9 real D1 database ids. Not secrets (they need an authenticated account) but they are environment-identifying and there is no dev/staging split — there is exactly **one** environment, so a local `wrangler dev` writes to production data. Add `[env.staging]` blocks with separate ids.
* `mgmt/frontend/src/api.js:1` `VITE_API_URL` has no fallback or validation — an unset var yields `fetch(undefined)` → `"Failed to fetch"` on every call with no hint why.
  ```js
  const API_URL = import.meta.env.VITE_API_URL;
  if (!API_URL) {
    // Fail loudly at load rather than as an unexplained "Failed to fetch" on every call.
    throw new Error('VITE_API_URL is not set — the frontend cannot reach the API. Set it in the Vercel project env vars.');
  }
  ```
* `Public/frontend/script.js:117` hardcodes `BASE_API_URL` (documented as unavoidable — no build step). `build.mjs` exists though, so it *could* be injected the same way SEO is.
* `mgmt/frontend/index.html:73` hardcodes `GTM-M2JP98W5` with a comment saying "replace with your real container ID" — either it is real (and should be an env var) or it is a placeholder still shipping to production.

**Q-8 · `mgmt/backend/src/index.js:31` `READ_ONLY_ACTIONS` is a 40-entry hand-maintained denylist-by-omission.**
The safe default is documented (an unlisted action is treated as a write), which is right — but `exportBackup` and `logError`/`reportErrorToWhatsApp` are listed as read-only while `reportErrorToWhatsApp` **does** write (`error_log.reported` + two message rows). Harmless (it doesn't change public data) but the list is already wrong, which is what always happens to hand-maintained lists. Derive it from a per-handler `{ write: true }` flag instead.

**Q-9 · Comments are doing the job of code.** The codebase is unusually well-commented — but a large fraction of the comments are *invariant enforcement* ("must stay identical to…", "this comment is the enforcement boundary", "don't add new queries against DB_MISC here"). `Public/backend/wrangler.toml:36` literally says *"D1 bindings are per-database not per-table, so this comment is the enforcement boundary."* Those should be tests or lint rules.

**Q-10 · Nine markdown files at the repo root** (`AUDIT_BUGS_LIST.md`, `FIX_CHECKLIST.md`, `FIXES_20260831.md`, `WHATSAPP_DEBUG_GUIDE.md`, `WHATSAPP_FIX_COMPLETE.md`, `WHATSAPP_ROOT_CAUSE.md`, `WHATSAPP_QUEUE_SETUP.md`, `TEST_AFTER_FIX.md`, `POPUP_ERRORLOG_FIXES.md`, …) are point-in-time incident notes, not documentation. Move them to `docs/history/` and keep one `README` + one `RUNBOOK`.

**Q-11 · `mgmt/frontend/src/views/*` — `alert()` / `confirm()` are the error and confirmation UI.**
`Home.jsx:99,106,177,225`, `SettingsModal.jsx:85,90,101,105`, `Backup.jsx`, `AnnouncePage.jsx:245,262`. Blocking, unstyled, unsuppressable-in-iOS-standalone, and untestable. Route through the existing `Modal` component.

**Q-12 · `mgmt/frontend/src/views/*` — heavy inline `style={{…}}` objects in render.**
Hundreds of object literals recreated per render (`Home.jsx` alone has ~40). Minor GC pressure, major readability cost, and it bypasses `styles.css` entirely. Move to CSS classes.



---

# 6. TESTING — current coverage: **0%**

There is no test runner, no test file, no CI workflow, and no `test` script in any of the four `package.json` files. `TEST_AFTER_FIX.md` is a manual checklist. `tools/loadtest.mjs` is a load generator, not a test.

## 6.1 Critical paths with NO coverage

| # | Path | Files | Why it must be tested |
|---|---|---|---|
| 1 | **Role enforcement matrix** | `auth.js:530-560`, `crud.js` | C-1 is exactly this. Every (role × action × sheet) combination. |
| 2 | **Password hash verify + legacy upgrade** | `auth.js:186-206` | A regression locks every admin out, or accepts wrong passwords. |
| 3 | **Login lockout + IP keying** | `auth.js:229-260` | H-17 is the same class of bug, unfixed here. |
| 4 | **Session revocation** (role change, delete, remote logout) | `auth.js:302-360` | Silent failure = a demoted Superadmin keeps power for 30 days. |
| 5 | **OTP issue → verify → respond** | `loans.js:388-560` | Legal consent. Expiry, attempt cap, verifyToken binding, replay. |
| 6 | **`respondConsent` authorization** | `loans.js:530` | C-3: does a stolen token+otp let a third party accept? |
| 7 | **Year lock / year access** on save, edit, delete, enqueue | `crud.js:151-240`, `collectionQueue.js:56` | The stored-year-vs-payload-year IDOR was fixed once; nothing stops it recurring. |
| 8 | **`Sl. No.` / `USER####` allocation under concurrency** | `crud.js:126-135` | H-9: duplicate receipt numbers. |
| 9 | **`toColumnPayload` alias resolution** | `tableRegistry.js:120` | An unknown key throws; a wrong alias writes the wrong column. |
| 10 | **Backup → restore round-trip** (incl. reserved-word columns `order`/`key`/`from`) | `backup.js:270-360` | This code has already destroyed four tables once (documented at `backup.js:250`). |
| 11 | **WhatsApp queue claim/lease** | `whatsapp.js:180-240` | Duplicate sends to real people; the claim-token logic is subtle. |
| 12 | **`waNumber` normalisation** | `phone.js:31` | 12 input shapes, one output. Currently verified by nothing. |
| 13 | **`isTruthyFlag` across all four copies** | `flags.js` ×2, `announcements.js`, `script.js` | M-31: they already disagree. |
| 14 | **CORS `allowedOrigin` fail-closed behaviour** | `index.js:171` | The "no wildcard default" invariant is a one-line regression away. |
| 15 | **Rate limiters** (per-IP, OTP/hour, error-report/hour) | `index.js:139`, `loans.js:44`, `errorLog.js:32` | All three fail *open*; nothing proves they ever close. |
| 16 | **`convertDocxToPdf` mode → role mapping** | `docxTemplates.js:243` | C-2. |
| 17 | **Public payload PII minimisation** | `Public/backend/src/index.js:78` (`usersPublicSafe`) | A non-committee member's mobile must never appear. One `continue` away from a leak. |
| 18 | **ETag / 304 / version-bump invalidation** | `Public/backend/src/index.js:700` + `dataVersion.js` | A stale ETag serves last year's finances forever. |
| 19 | **Consent placeholder parity** (consent page vs bulk vs download centre) | `consentPlaceholders.js` | The whole reason this module exists; nothing asserts the three callers agree. |
| 20 | **`httpStatusForError` mapping** | `index.js:222` | H-3. |

## 6.2 Recommended setup

```jsonc
// mgmt/backend/package.json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest --run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "wrangler": "^4.20.0",
    "vitest": "^2.1.0",
    "@cloudflare/vitest-pool-workers": "^0.5.0"
  }
}
```

```js
// mgmt/backend/vitest.config.js
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        // Real D1 + KV, per-test isolated storage — so these are true integration
        // tests against the actual bindings, not mocks that drift from reality.
        miniflare: { d1Databases: ['DB_CORE','DB_COLLECTIONS','DB_LOANS_EXPENSES','DB_TEMPLATES','DB_FILE_INDEX','DB_WHATSAPP_INDEX','DB_LOGS','DB_MISC','DB_AUDIT'], kvNamespaces: ['KV_SESSIONS'] },
        isolatedStorage: true,
      },
    },
    setupFiles: ['./test/setup.js'],
  },
});
```

```js
// mgmt/backend/test/setup.js — apply the real schema so tests catch schema drift
import { env } from 'cloudflare:test';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll } from 'vitest';

const SCHEMA_FOR = {
  DB_CORE: 'core.sql', DB_COLLECTIONS: 'collections.sql',
  DB_LOANS_EXPENSES: 'loans_expenses.sql', DB_TEMPLATES: 'templates.sql',
  DB_FILE_INDEX: 'file_index.sql', DB_WHATSAPP_INDEX: 'whatsapp_index.sql',
  DB_LOGS: 'logs.sql', DB_MISC: 'misc.sql', DB_AUDIT: 'audit.sql',
};

beforeAll(async () => {
  for (const [binding, file] of Object.entries(SCHEMA_FOR)) {
    const sql = readFileSync(new URL(`../../db/schema/${file}`, import.meta.url), 'utf8');
    for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
      await env[binding].prepare(stmt).run();
    }
  }
});
```

## 6.3 Unit tests for core business logic

```js
// mgmt/backend/test/unit/phone.test.js
import { describe, it, expect } from 'vitest';
import { waNumber, waNumberOf, looksLikeAttemptedNumber } from '../../src/phone.js';

describe('waNumber', () => {
  it.each([
    ['9876543210',        '919876543210', 'bare 10 digits'],
    ['+91 98765 43210',   '919876543210', 'E.164 with spaces'],
    ['0091-9876543210',   '919876543210', '00 country prefix'],
    ['09876543210',       '919876543210', 'trunk zero'],
    ['919876543210',      '919876543210', 'already prefixed'],
    ['9876543210.0',      '919876543210', 'D1 REAL round-trip'],
    ['9.87654321e9',      '919876543210', 'D1 exponential form'],
  ])('normalises %s -> %s (%s)', (input, expected) => {
    expect(waNumber(input)).toBe(expected);
  });

  it.each([
    ['5876543210', 'starts with 5 — not an Indian mobile'],
    ['987654321',  'only 9 digits'],
    ['98765432101','11 digits'],
    ['',           'empty'],
    [null,         'null'],
    ['abcdefghij', 'non-numeric'],
  ])('rejects %s (%s)', (input) => {
    expect(waNumber(input)).toBe('');
  });

  it('distinguishes "no number on file" from "invalid number"', () => {
    expect(looksLikeAttemptedNumber('')).toBe(false);
    expect(looksLikeAttemptedNumber('12345')).toBe(true);
  });

  it('prefers WhatsApp over Mobile', () => {
    expect(waNumberOf({ WhatsApp: '9111111111', Mobile: '9222222222' })).toBe('919111111111');
    expect(waNumberOf({ Mobile: '9222222222' })).toBe('919222222222');
    expect(waNumberOf(null)).toBe('');
  });
});
```

```js
// mgmt/backend/test/unit/flags.test.js — pins the invariant M-31 currently violates
import { describe, it, expect } from 'vitest';
import { isTruthyFlag as backend } from '../../src/flags.js';
import { isTruthyFlag as frontend } from '../../../frontend/src/flags.js';

const CASES = [
  [true, true], [1, true], ['1', true], ['true', true], ['True', true],
  ['TRUE', true], ['yes', true], [' 1 ', true], [' true ', true],
  [false, false], [0, false], ['0', false], ['false', false], ['no', false],
  ['', false], [null, false], [undefined, false], ['banana', false],
];

describe('isTruthyFlag', () => {
  it.each(CASES)('backend(%o) === %o', (input, expected) => {
    expect(backend(input)).toBe(expected);
  });
  // The two copies MUST agree — a divergence is how "Active but never shown"
  // popup bugs happen (see the comment in mgmt/backend/src/flags.js).
  it.each(CASES)('frontend agrees with backend for %o', (input) => {
    expect(frontend(input)).toBe(backend(input));
  });
});
```

```js
// mgmt/backend/test/unit/roles.test.js — the test that would have caught C-1
import { describe, it, expect } from 'vitest';
import { requireRole, requireSuperadmin, requireAdminOrAbove } from '../../src/auth.js';

const ROLES = ['Superadmin', 'Admin', 'Subadmin'];
const GENERIC = ['USERS', 'COLLECTIONS', 'EXPENSES', 'COMMITEE MEMBERS', 'LOANS', 'LOAN GUARANTOR'];
// Tables that must NEVER be reachable through the generic CRUD actions.
const FORBIDDEN = ['LOGIN', 'loan_consents', 'generated_files', 'activity log',
                   'error_log', 'portal_settings', 'popups', 'announcement_links'];

describe('generic CRUD authorization', () => {
  it.each(ROLES.flatMap(role => FORBIDDEN.map(sheet => [role, sheet])))(
    '%s cannot edit %s through the generic endpoint', (role, sheet) => {
      expect(() => requireRole({ role }, 'edit', sheet)).toThrow();
      expect(() => requireRole({ role }, 'add', sheet)).toThrow();
      expect(() => requireRole({ role }, 'delete', sheet)).toThrow();
    });

  it('Subadmin may only ADD Users and Collections', () => {
    expect(() => requireRole({ role: 'Subadmin' }, 'add', 'USERS')).not.toThrow();
    expect(() => requireRole({ role: 'Subadmin' }, 'add', 'COLLECTIONS')).not.toThrow();
    expect(() => requireRole({ role: 'Subadmin' }, 'add', 'EXPENSES')).toThrow();
    expect(() => requireRole({ role: 'Subadmin' }, 'edit', 'COLLECTIONS')).toThrow();
    expect(() => requireRole({ role: 'Subadmin' }, 'delete', 'COLLECTIONS')).toThrow();
  });

  it('an unknown/legacy role has no write permission at all', () => {
    for (const action of ['add', 'edit', 'delete']) {
      expect(() => requireRole({ role: 'Treasurer' }, action, 'COLLECTIONS')).toThrow();
      expect(() => requireRole({ role: undefined }, action, 'COLLECTIONS')).toThrow();
      expect(() => requireRole({ role: '' }, action, 'COLLECTIONS')).toThrow();
    }
  });

  it('Admin cannot reach Superadmin-only helpers', () => {
    expect(() => requireSuperadmin({ role: 'Admin' })).toThrow();
    expect(() => requireAdminOrAbove({ role: 'Admin' })).not.toThrow();
    expect(() => requireAdminOrAbove({ role: 'Subadmin' })).toThrow();
  });
});
```

```js
// mgmt/backend/test/unit/password.test.js
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, timingSafeEqualHex } from '../../src/auth.js';

const env = { PASSWORD_SALT: 'test-global-salt' };

describe('password hashing', () => {
  it('produces the self-describing pbkdf2$iterations$salt$hash format', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  });

  it('uses a DIFFERENT salt for identical passwords', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const h = await hashPassword('s3cret-passphrase');
    await expect(verifyPassword(env, 's3cret-passphrase', h)).resolves.toMatchObject({ ok: true, needsUpgrade: false });
    await expect(verifyPassword(env, 's3cret-passphras',  h)).resolves.toMatchObject({ ok: false });
  });

  it('accepts a LEGACY bare sha256 hash and flags it for upgrade', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('old-pw' + env.PASSWORD_SALT));
    const legacy = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    await expect(verifyPassword(env, 'old-pw', legacy)).resolves.toMatchObject({ ok: true, needsUpgrade: true });
  });

  it('rejects an empty / malformed stored hash rather than accepting anything', async () => {
    for (const bad of ['', null, undefined, 'pbkdf2$100000$deadbeef', 'pbkdf2$$$', 'garbage']) {
      await expect(verifyPassword(env, 'anything', bad)).resolves.toMatchObject({ ok: false });
    }
  });

  it('timingSafeEqualHex is length-tolerant and correct', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abcdef')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(true);
  });
});
```

```js
// mgmt/backend/test/unit/tableRegistry.test.js
import { describe, it, expect } from 'vitest';
import { toColumnPayload, fromColumnRow, resolveSheet } from '../../src/tableRegistry.js';

describe('toColumnPayload', () => {
  it('resolves headers with curly apostrophes and trailing spaces', () => {
    expect(toColumnPayload('users', { "Father's Name": 'A' })).toEqual({ fathers_name: 'A' });
    expect(toColumnPayload('users', { "Father\u2019s Name": 'A' })).toEqual({ fathers_name: 'A' });
    expect(toColumnPayload('users', { "Father's Name ": 'A' })).toEqual({ fathers_name: 'A' });
    expect(toColumnPayload('users', { "Father's  Name": 'A' })).toEqual({ fathers_name: 'A' });
  });

  it('THROWS on an unknown field instead of guessing a column name', () => {
    expect(() => toColumnPayload('users', { 'Blood Group': 'O+' }))
      .toThrow(/not a known column of "users"/);
  });

  it('drops __rowIndex', () => {
    expect(toColumnPayload('users', { Name: 'x', __rowIndex: 5 })).toEqual({ name: 'x' });
  });

  it('round-trips through fromColumnRow', () => {
    const header = { 'Sl. No.': 3, Year: 2026, Amount: 500, 'Payment Mode': 'Cash' };
    const cols = toColumnPayload('collections', header);
    const back = fromColumnRow('collections', { id: 9, ...cols });
    expect(back).toMatchObject({ ...header, __rowIndex: 9 });
  });

  it('maps AnnouncedCount both ways (the alias that was silently missing)', () => {
    expect(toColumnPayload('collections', { AnnouncedCount: 2 })).toEqual({ announcedcount: 2 });
    expect(fromColumnRow('collections', { announcedcount: 2 })).toMatchObject({ AnnouncedCount: 2 });
  });

  it('resolveSheet is case- and whitespace-insensitive and rejects the unknown', () => {
    expect(resolveSheet('  CoLLections ')).toEqual({ db: 'collections', table: 'collections' });
    expect(() => resolveSheet('nope')).toThrow(/Unknown sheet/);
  });
});
```

```js
// mgmt/backend/test/unit/consentPlaceholders.test.js — pins the parity invariant
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { buildConsentPlaceholders, consentPlaceholderFactory, statusLabel } from '../../src/consentPlaceholders.js';

const loan = { 'Loan ID': 'LN1', Name: 'USER0001', Year: 2026, Amount: 50000,
               'Intrest Rate': 2, Tenure: 12, 'Final Repayment Date': '2027-01-15' };
const consents = [
  { consent_id: 'CN-L', role: 'loaner',    person_id: 'USER0001', status: 'pending' },
  { consent_id: 'CN-1', role: 'guarantor', person_id: 'USER0002', status: 'accepted', verification_status: 'verified' },
  { consent_id: 'CN-2', role: 'guarantor', person_id: 'USER0003', status: 'declined', decline_remarks: 'busy' },
  { consent_id: 'CN-3', role: 'guarantor', person_id: 'USER0004', status: 'pending' },
];
const nameOf = (id) => ({ USER0001: 'Loaner', USER0002: 'G One', USER0003: 'G Two', USER0004: 'G Three' }[id] || id);

describe('consent placeholders', () => {
  it('always emits all 3 documented guarantor slots plus the counts', async () => {
    const p = await buildConsentPlaceholders(env, loan, consents, consents[1], nameOf);
    expect(p).toMatchObject({
      GUARANTOR_1_NAME: 'G One', GUARANTOR_2_NAME: 'G Two', GUARANTOR_3_NAME: 'G Three',
      ACCEPTED_COUNT: 1, DECLINED_COUNT: 1, PENDING_COUNT: 1,
      LOAN_CONSENT_ID: 'CN-L', CONSENT_ID: 'CN-1',
    });
  });

  it('emits every festival/date key even when Festival Dates are unset (never a raw [TOKEN])', async () => {
    const p = await buildConsentPlaceholders(env, loan, consents, consents[1], nameOf);
    for (const k of ['DIWALI_NEXT_DAY_DATE','DIWALI_NEXT_DAY_DAY_NAME','NAHAY_KHAY_DATE',
                     'NAHAY_KHAY_DAY_NAME','CHHATH_MORNING_ARGHYA_DATE',
                     'CHHATH_MORNING_ARGHYA_DAY_NAME','FINAL_REPAYMENT_DAY_NAME']) {
      expect(p, `missing ${k}`).toHaveProperty(k);
    }
  });

  // THE regression this module exists to prevent: the consent page and the bulk
  // generator must produce the SAME map for the same consent.
  it('factory output matches buildConsentPlaceholders key-for-key', async () => {
    const factory = await consentPlaceholderFactory(env, loan, consents, nameOf);
    const direct = await buildConsentPlaceholders(env, loan, consents, consents[1], nameOf);
    expect(Object.keys(factory(consents[1])).sort()).toEqual(Object.keys(direct).sort());
    expect(factory(consents[1])).toEqual(direct);
  });

  it('statusLabel keeps verification and decline remarks', () => {
    expect(statusLabel('declined', { decline_remarks: 'busy' })).toContain('busy');
    expect(statusLabel('accepted', { verification_status: 'rejected', verification_remarks: 'blurred' })).toContain('blurred');
    expect(statusLabel('accepted', { verification_status: 'verified' })).toMatch(/Verified/);
    expect(statusLabel('pending', null)).toMatch(/Pending/);
  });
});
```

```js
// mgmt/backend/test/unit/base64.test.js
import { describe, it, expect } from 'vitest';
import { cleanBase64, base64ToBytes, base64ByteLength, sniffImageMime } from '../../src/base64.js';

describe('base64 handling', () => {
  it('strips a data-URL prefix and whitespace', () => {
    expect(cleanBase64('data:image/jpeg;base64,QUJD')).toBe('QUJD');
    expect(cleanBase64('QU\nJD\r\n')).toBe('QUJD');
  });
  it('accepts the URL-safe alphabet', () => expect(cleanBase64('a-_b')).toBe('a+/b'));
  it('rejects garbage with a user-readable message', () => {
    expect(() => cleanBase64('not base64!!')).toThrow(/not valid/);
    expect(() => cleanBase64('')).toThrow(/required/);
  });
  it('enforces maxBytes', () => {
    const big = 'A'.repeat(4 * 1024 * 1024);            // ~3 MB decoded
    expect(() => base64ToBytes(big, { maxBytes: 1024 })).toThrow(/too large/);
  });
  it('computes byte length without decoding', () => {
    expect(base64ByteLength('QUJD')).toBe(3);
    expect(base64ByteLength('QUJDRA==')).toBe(4);
  });
  it('sniffs the REAL image type from magic bytes, ignoring any claimed mime', () => {
    expect(sniffImageMime(new Uint8Array([0xff,0xd8,0xff,0,0,0,0,0,0,0,0,0]))).toBe('image/jpeg');
    expect(sniffImageMime(new Uint8Array([0x89,0x50,0x4e,0x47,0,0,0,0,0,0,0,0]))).toBe('image/png');
    expect(sniffImageMime(new Uint8Array([0x25,0x50,0x44,0x46,0,0,0,0,0,0,0,0]))).toBeNull(); // %PDF
    expect(sniffImageMime(new Uint8Array([1,2,3]))).toBeNull();                              // too short
  });
});
```

## 6.4 Integration tests for API endpoints

```js
// mgmt/backend/test/integration/auth.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../../src/auth.js';

const post = (body, headers = {}) => SELF.fetch('https://api.test/', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

async function seedLogin(name, password, role) {
  await env.DB_CORE.prepare(
    'INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)'
  ).bind(name, '9000000001', `${name}@t.test`, await hashPassword(password), role, new Date().toISOString()).run();
}

async function tokenFor(name, password) {
  const res = await post({ action: 'login', name, password, rememberMe: false });
  const body = await res.json();
  expect(body.success, JSON.stringify(body)).toBe(true);
  return body.token;
}

beforeEach(async () => {
  await env.DB_CORE.prepare('DELETE FROM login_users').run();
  await seedLogin('USER0001', 'superadmin-pw-123', 'Superadmin');
  await seedLogin('USER0002', 'admin-pw-1234567',  'Admin');
  await seedLogin('USER0003', 'subadmin-pw-12345', 'Subadmin');
});

describe('POST /login', () => {
  it('issues a token and returns the role', async () => {
    const res = await post({ action: 'login', name: 'USER0001', password: 'superadmin-pw-123' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, role: 'Superadmin' });
  });

  it('returns the SAME generic message for a wrong password and an unknown user', async () => {
    const a = await (await post({ action: 'login', name: 'USER0001', password: 'wrong' })).json();
    const b = await (await post({ action: 'login', name: 'NOBODY',   password: 'wrong' })).json();
    expect(a.message).toBe(b.message);              // no user enumeration
    expect(a.success).toBe(false);
  });

  it('locks out after 5 failures and the lockout is keyed on identifier+IP', async () => {
    const ipA = { 'CF-Connecting-IP': '203.0.113.9' };
    const ipB = { 'CF-Connecting-IP': '203.0.113.10' };
    for (let i = 0; i < 5; i++) await post({ action: 'login', name: 'USER0001', password: 'x' }, ipA);
    const locked = await (await post({ action: 'login', name: 'USER0001', password: 'superadmin-pw-123' }, ipA)).json();
    expect(locked).toMatchObject({ success: false, lockedOut: true });
    // The victim, from their OWN ip, must still be able to log in (account-lockout DoS).
    const ok = await (await post({ action: 'login', name: 'USER0001', password: 'superadmin-pw-123' }, ipB)).json();
    expect(ok.success).toBe(true);
  });

  it('records every attempt in the audit DB', async () => {
    await post({ action: 'login', name: 'USER0001', password: 'nope' }, { 'CF-Connecting-IP': '198.51.100.1' });
    const row = await env.DB_AUDIT.prepare(
      'SELECT identifier, success, reason, ip FROM login_attempts ORDER BY id DESC LIMIT 1').first();
    expect(row).toMatchObject({ identifier: 'USER0001', success: 0, reason: 'bad_password', ip: '198.51.100.1' });
  });

  it('never stores or echoes the password', async () => {
    await post({ action: 'login', name: 'USER0001', password: 'superadmin-pw-123' });
    const { results } = await env.DB_AUDIT.prepare('SELECT * FROM login_attempts').all();
    expect(JSON.stringify(results)).not.toContain('superadmin-pw-123');
  });
});

describe('session lifecycle', () => {
  it('rejects every authenticated action without a token (401)', async () => {
    for (const action of ['getHome', 'getUsers', 'saveRecord', 'exportBackup']) {
      const res = await post({ action, year: 2026 });
      expect(res.status, action).toBe(401);
      await expect(res.json()).resolves.toMatchObject({ authError: true });
    }
  });

  it('enforces the CURRENT role, not the one snapshotted at login', async () => {
    const token = await tokenFor('USER0001', 'superadmin-pw-123');
    await expect((await post({ action: 'exportBackup', token })).status).toBe(200);
    // Demote them in the DB; the very next request must lose Superadmin rights.
    await env.DB_CORE.prepare("UPDATE login_users SET role = 'Subadmin' WHERE name = 'USER0001'").run();
    const res = await post({ action: 'exportBackup', token });
    expect(res.status).toBe(403);
  });

  it('kills the session when the login row is deleted', async () => {
    const token = await tokenFor('USER0002', 'admin-pw-1234567');
    await env.DB_CORE.prepare("DELETE FROM login_users WHERE name = 'USER0002'").run();
    expect((await post({ action: 'getHome', token, year: 2026 })).status).toBe(401);
  });

  it('honours a remote revocation', async () => {
    const token = await tokenFor('USER0002', 'admin-pw-1234567');
    await env.DB_AUDIT.prepare("UPDATE user_sessions SET revoked_at = ? WHERE name = 'USER0002'")
      .bind(new Date().toISOString()).run();
    expect((await post({ action: 'getHome', token, year: 2026 })).status).toBe(401);
  });
});
```

```js
// mgmt/backend/test/integration/authorization.test.js — the C-1 / C-2 / H-1 regression suite
describe('broken access control regressions', () => {
  it('an Admin CANNOT change a role through the generic updateRecord (C-1)', async () => {
    const token = await tokenFor('USER0002', 'admin-pw-1234567');
    const target = await env.DB_CORE.prepare("SELECT id FROM login_users WHERE name = 'USER0002'").first();
    const res = await post({ action: 'updateRecord', token, sheet: 'LOGIN',
                             rowIndex: target.id, payload: { Role: 'Superadmin' } });
    expect(res.status).toBe(403);
    const after = await env.DB_CORE.prepare("SELECT role FROM login_users WHERE id = ?").bind(target.id).first();
    expect(after.role).toBe('Admin');
  });

  it('an Admin CANNOT forge a consent through the generic updateRecord (C-1)', async () => {
    const token = await tokenFor('USER0002', 'admin-pw-1234567');
    await env.DB_LOANS_EXPENSES.prepare(
      "INSERT INTO loan_consents (id, consent_id, loan_id, person_id, role, token, status) VALUES (1,'CN1','LN1','USER0009','guarantor','tok','pending')").run();
    const res = await post({ action: 'updateRecord', token, sheet: 'loan_consents',
                             rowIndex: 1, payload: { status: 'accepted' } });
    expect(res.status).toBe(403);
    const row = await env.DB_LOANS_EXPENSES.prepare('SELECT status FROM loan_consents WHERE id = 1').first();
    expect(row.status).toBe('pending');
  });

  it('a Subadmin CANNOT overwrite a consent PDF by choosing mode+recordId (C-2)', async () => {
    const token = await tokenFor('USER0003', 'subadmin-pw-12345');
    const res = await post({ action: 'convertDocxToPdf', token, mode: 'auto', force: true,
                             docType: 'consent_loaner', year: 2026,
                             recordId: 'consent_loaner-2026-CN-victim',
                             base64: 'UEsDBAAAAAA=', fileName: 'x.docx' });
    expect([400, 403]).toContain(res.status);
  });

  it('a Subadmin CANNOT read another member’s full profile (H-1)', async () => {
    const token = await tokenFor('USER0003', 'subadmin-pw-12345');
    const res = await post({ action: 'getUserProfile', token, userId: 'USER0001' });
    expect(res.status).toBe(403);
  });

  it('getLoanConsents never returns a token or an otp (C-3)', async () => {
    const token = await tokenFor('USER0001', 'superadmin-pw-123');
    await env.DB_LOANS_EXPENSES.prepare(
      "INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status, otp) VALUES ('CN1','LN1','USER0009','guarantor','SECRET-TOKEN','pending','123456')").run();
    const body = await (await post({ action: 'getLoanConsents', token, loanId: 'LN1' })).json();
    const s = JSON.stringify(body);
    expect(s).not.toContain('SECRET-TOKEN');
    expect(s).not.toContain('123456');
  });
});
```

```js
// mgmt/backend/test/integration/consent.test.js — the legal-document flow
describe('consent OTP flow', () => {
  it('respondConsent is refused without the session-bound verifyToken', async () => {
    const res = await post({ action: 'respondConsent', token: consentToken, decision: 'accepted',
                             geoLat: 24.1, geoLng: 86.3, photoBase64: PHOTO, signatureBase64: SIG });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ message: expect.stringMatching(/verify with the WhatsApp OTP/i) });
  });

  it('a SECOND visitor cannot ride on the first visitor’s verification', async () => {
    await post({ action: 'requestConsentOtp', token: consentToken });
    const otp = (await env.DB_LOANS_EXPENSES.prepare('SELECT otp FROM loan_consents WHERE token = ?').bind(consentToken).first()).otp;
    const { verifyToken } = await (await post({ action: 'verifyConsentOtp', token: consentToken, otp })).json();
    // Visitor A can act…
    // …visitor B, with the link but no verifyToken, cannot.
    const res = await post({ action: 'respondConsent', token: consentToken, decision: 'declined', declineRemarks: 'x' });
    expect(res.status).toBe(400);
    expect(verifyToken).toBeTruthy();
  });

  it('caps OTP verification at 5 attempts', async () => {
    await post({ action: 'requestConsentOtp', token: consentToken });
    for (let i = 0; i < 5; i++) await post({ action: 'verifyConsentOtp', token: consentToken, otp: '000000' });
    const body = await (await post({ action: 'verifyConsentOtp', token: consentToken, otp: '000000' })).json();
    expect(body.message).toMatch(/too many times/i);
  });

  it('expires an OTP after 10 minutes', async () => { /* advance the clock via vi.setSystemTime */ });
  it('caps OTP requests at 5 per hour', async () => { /* … */ });
  it('enforces the 20-minute verify→respond window', async () => { /* … */ });
  it('locks the decision once recorded (no accept-then-decline)', async () => { /* … */ });
  it('refuses a loaner’s Accept until all three guarantors have accepted', async () => { /* … */ });
  it('requires geo + photo + signature to Accept, and remarks to Decline', async () => { /* … */ });
  it('stores the CF edge IP, not the client-supplied clientIp', async () => { /* … */ });
});
```

```js
// mgmt/backend/test/integration/crud-yearlock.test.js
describe('year lock / year access', () => {
  it('refuses an edit when the STORED year is locked, even if payload.Year is unlocked', async () => {
    // The exact IDOR that crud.js:151 was hardened against — pin it.
    await env.DB_CORE.prepare('INSERT INTO locked_years (year, lockedby, lockedat) VALUES (2025, "x", "y")').run();
    await env.DB_COLLECTIONS.prepare(
      'INSERT INTO collections (id, year, sl_no, name, amount) VALUES (1, 2025, 1, "USER0009", 100)').run();
    const token = await tokenFor('USER0001', 'superadmin-pw-123');
    const res = await post({ action: 'updateRecord', token, sheet: 'COLLECTIONS', rowIndex: 1,
                             payload: { Year: 2026, Name: 'USER0009', Amount: 999 } });
    expect(res.status).toBe(403);
    const row = await env.DB_COLLECTIONS.prepare('SELECT amount FROM collections WHERE id = 1').first();
    expect(row.amount).toBe(100);
  });

  it('refuses moving a record INTO a locked year', async () => { /* … */ });
  it('refuses the same via enqueueCollectionJob', async () => { /* … */ });
  it('a delete whose year lookup FAILS must not proceed', async () => { /* … */ });
  it('purges generated_files rows when a collection is edited or deleted', async () => { /* … */ });
});
```

```js
// mgmt/backend/test/integration/backup.test.js — the highest-risk code in the repo
describe('backup / restore', () => {
  it('round-trips tables whose columns are SQLite reserved words', async () => {
    // `order` (custom_announcements), `key` (portal_settings), `from`
    // (group_messages/person_messages) — an unquoted identifier here once wiped
    // all four tables on restore.
    await env.DB_CORE.prepare('INSERT INTO portal_settings ("key", value) VALUES (?, ?)').bind('k1', 'v1').run();
    await env.DB_MISC.prepare('INSERT INTO custom_announcements (id_code, year, "order") VALUES (?,?,?)').bind('CA1', 2026, 3).run();
    const token = await tokenFor('USER0001', 'superadmin-pw-123');
    const { backup } = await (await post({ action: 'exportBackup', token })).json();
    await env.DB_CORE.prepare('DELETE FROM portal_settings').run();
    const res = await (await post({ action: 'restoreBackup', token, backup, confirm: 'RESTORE' })).json();
    expect(res.success).toBe(true);
    expect(res.report.errors).toEqual([]);
    const back = await env.DB_CORE.prepare('SELECT value FROM portal_settings WHERE "key" = ?').bind('k1').first();
    expect(back.value).toBe('v1');
  });

  it('does NOT wipe a live table when the backup has 0 rows for it', async () => {
    const token = await tokenFor('USER0001', 'superadmin-pw-123');
    await env.DB_CORE.prepare('INSERT INTO portal_settings ("key", value) VALUES (?,?)').bind('keep', 'me').run();
    const res = await (await post({ action: 'restoreBackup', token, confirm: 'RESTORE',
      backup: { formatVersion: 1, data: { DB_CORE: { portal_settings: [] } } } })).json();
    expect(res.report.emptyTables).toHaveProperty('DB_CORE.portal_settings');
    const still = await env.DB_CORE.prepare('SELECT value FROM portal_settings WHERE "key" = ?').bind('keep').first();
    expect(still.value).toBe('me');            // the wipe-then-check bug
  });

  it('refuses without the typed confirmation', async () => {
    const token = await tokenFor('USER0001', 'superadmin-pw-123');
    expect((await post({ action: 'restoreBackup', token, backup: { data: {} }, confirm: 'yes' })).status).toBe(400);
  });

  it('refuses a backup from a NEWER format version', async () => { /* … */ });
  it('is Superadmin-only', async () => { /* … */ });
  it('aborts the whole export if any table read fails (no half-empty backup)', async () => { /* … */ });
});
```

```js
// mgmt/backend/test/integration/whatsapp-queue.test.js
describe('WhatsApp queue', () => {
  it('never serves the same row to two concurrent polls', async () => {
    for (let i = 0; i < 20; i++) await queueOne(`MSG${i}`);
    const [a, b] = await Promise.all([pollAsSender(), pollAsSender()]);
    const ids = [...a.map(m => m.message_id), ...b.map(m => m.message_id)];
    expect(new Set(ids).size).toBe(ids.length);       // zero overlap
  });

  it('re-queues a claim that has gone stale', async () => { /* advance clock past CLAIM_STALE_MS */ });
  it('auto-fails a row after MAX_ATTEMPTS', async () => { /* … */ });
  it("treats 'sent' as terminal — cannot be flipped back to failed", async () => { /* … */ });
  it('coerces numeric-affinity recipients to clean strings', async () => {
    // The bug that crashed the external sender with "to.includes is not a function".
    await env.DB_WHATSAPP_INDEX.prepare(
      'INSERT INTO person_messages (message_id, mobileno, message, status) VALUES (?,?,?,?)'
    ).bind('MSGX', 917282032146, 'hi', 'pending').run();
    const [msg] = await pollAsSender();
    expect(typeof msg.mobileno).toBe('string');
    expect(msg.mobileno).toBe('917282032146');
  });
  it('rejects a wrong / missing apiKey with 403', async () => { /* … */ });
});
```

```js
// Public/backend/test/integration/portal.test.js
describe('public portal', () => {
  it('never exposes a non-committee member’s mobile, email or whatsapp', async () => {
    await seedUser('USER0001', { mobile: 9111111111, email: 'a@b.c', whatsapp: 9222222222 });  // not on committee
    await seedUser('USER0002', { mobile: 9333333333 });
    await seedCommittee(2026, 'USER0002');
    const body = await (await SELF.fetch('https://pub.test/?action=portalData')).json();
    const json = JSON.stringify(body);
    expect(json).not.toContain('9111111111');   // plain contributor's mobile
    expect(json).not.toContain('a@b.c');        // no email, ever
    expect(json).not.toContain('9222222222');   // no whatsapp, ever
    expect(json).toContain('9333333333');       // committee mobile IS public (by design)
  });

  it('never exposes consent tokens, otps, geo, ip or photo urls', async () => {
    await seedConsent({ token: 'PUB-SECRET', otp: '424242', ip_address: '1.2.3.4',
                        geo_lat: 24.1, photo_url: 'https://x/p.jpg' });
    const json = JSON.stringify(await (await SELF.fetch('https://pub.test/?action=portalData')).json());
    for (const secret of ['PUB-SECRET', '424242', '1.2.3.4', '24.1', 'p.jpg']) {
      expect(json, `leaked ${secret}`).not.toContain(secret);
    }
  });

  it('drops loan and guarantor signatures', async () => { /* signature, loan_documents, guarantor_signature */ });

  it('answers 304 when the client already holds the current version', async () => {
    const v = (await (await SELF.fetch('https://pub.test/?action=dataVersion')).json()).v;
    const etag = `W/"portalData-v${v}"`;
    const res = await SELF.fetch('https://pub.test/?action=portalData', { headers: { 'If-None-Match': etag } });
    expect(res.status).toBe(304);
  });

  it('serves a NEW payload after a data-version bump', async () => { /* … */ });
  it('only serves popups explicitly tagged Public and inside their window', async () => { /* … */ });
  it('rate-limits a flood from one IP with 429', async () => { /* … */ });
  it('falls back to the stale snapshot when D1 fails, and marks it stale:true', async () => { /* … */ });
});
```

## 6.5 Edge cases currently untested (and mostly unhandled)

| Edge case | Where | Current behaviour |
|---|---|---|
| A `.docx` template larger than 25 MB | `docxTemplates.js:107` | No size check (H-6); KV cache (P-4) would silently fail |
| `year = 'All'` reaching a write path | `crud.js:127` `payload.Year` | `parseInt('All')` → `NaN` → `sl_no` becomes `NaN`, stored as NULL |
| Negative or non-numeric `Amount` | `crud.js:110` | Only `isNaN` is checked; `-500` is accepted |
| `rowIndex` = `0`, `-1`, `'1 OR 1=1'` | every `rowIndex` handler | Bound as a parameter (safe from injection) but `0` silently matches nothing and returns `{success:true}` |
| Duplicate `USER####` from concurrent adds | `crud.js:126` | Both succeed; two people share an id (H-9) |
| A loan with 0 or 4 guarantors | `loans.js:127` | 3 enforced at save, but `replaceGuarantor` can leave 4 non-replaced rows |
| A consent responded to twice concurrently | `loans.js:530` | `status !== 'pending'` is checked, then updated — a read-then-write race |
| Festival dates unset for the loan's year | `consentPlaceholders.js:80` | Renders blank (correct) but nothing asserts it |
| `announcement_links.year` stored as a string | `announcements.js:246` | `WHERE year = ?` silently matches 0 rows (M-18) |
| An empty `popups.slides` array | `popups.js:194` | Logged as a warning, popup silently never shows |
| A popup window spanning a DST/timezone change | `popups.js:23` | Handled via explicit-UTC normalisation; untested |
| Two `getPendingMessages` polls in the same millisecond | `whatsapp.js:206` | `claimToken` includes a UUID — correct, untested |
| A KV outage | `index.js:139`, `loans.js:397`, `errorLog.js:32` | All three rate limiters fail **open**; logged but untested |
| A D1 outage mid-backup | `backup.js:100` | Correctly re-throws (except "no such table"); untested |
| `respondConsent` with a 60 MB photo | `loans.js:28` | Worker OOM (H-6) |
| Unicode / emoji in a WhatsApp template | `whatsapp.js:352` | Should work; nothing verifies the `{Token}` regex against Devanagari |
| A Hindi name in a Drive filename | `r2.js:74` `safeName` | `[^\w.\-]` strips all Devanagari → key becomes `file` |
| Clock skew between the Worker (UTC) and an IST browser | `popups.js:23`, `Home.jsx:47` | The known source of the 5.5 h popup bug |
| A collection edited while its PDF job is `processing` | `crud.js:207` + `collectionQueue.js:270` | Index purged, then the in-flight job re-inserts the STALE pdf |

That last one is a **real unhandled race**: `updateRecordByIdx` calls `purgeGeneratedFilesForCollection`, but a `collection_jobs` row already claimed for that record will `recordGeneratedFile()` afterwards with the pre-edit document. Fix by cancelling pending jobs for the record on edit:

```js
// crud.js — in updateRecordByIdx, alongside purgeGeneratedFilesForCollection
if (table === 'collections') {
  await purgeGeneratedFilesForCollection(env, payload.Year, rowIndex);
  // A job already queued for this record holds the PRE-EDIT document bytes and
  // would re-index the stale PDF right after we purged it. Park it.
  try {
    await env.DB_MISC.prepare(
      `UPDATE collection_jobs SET status = 'failed', last_error = 'superseded by an edit', finished_at = ?
        WHERE row_index = ? AND status IN ('pending', 'processing')`
    ).bind(new Date().toISOString(), rowIndex).run();
  } catch (e) { /* non-fatal */ }
}
```

## 6.6 Minimum CI

```yaml
# .github/workflows/ci.yml
name: CI
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - name: mgmt backend tests
        run: cd mgmt/backend && npm ci && npm test
      - name: public backend tests
        run: cd Public/backend && npm ci && npm test
      - name: frontend build (catches import/type breakage)
        run: cd mgmt/frontend && npm ci && npm run build
      - name: audit dependencies
        run: cd mgmt/frontend && npm audit --audit-level=high
      - name: no bare user-facing throws in request paths
        run: |
          ! grep -rn "throw new Error(" mgmt/backend/src \
              --exclude=drive.js --exclude=config.js --exclude=backup.js
```



---

# 7. LOW

| # | File:line | Issue | Fix |
|---|---|---|---|
| L-1 | `mgmt/backend/src/index.js:1` | `requireStaffRole` imported, never used | Remove from the import list |
| L-2 | `mgmt/backend/src/whatsapp.js:339` | `renderTemplate` exported, no callers | Delete; keep only `renderTemplateChecked` |
| L-3 | `mgmt/backend/src/templates.js:238` | `ensureSeedTemplate` has no callers | Delete or wire it into a documented bootstrap action |
| L-4 | `mgmt/backend/src/dropdownLists.js:65` | `DROPDOWN_LIST_SEED` exported, unused | Move to `db/seed/` as SQL |
| L-5 | `mgmt/frontend/src/api.js:239` | `api.uploadFile` has no callers | Delete with the backend action (H-7) |
| L-6 | `mgmt/backend/src/crud.js:83` | `filterByYear` still used by 4 call sites that could use `getSheetDataByYear` | Migrate and delete |
| L-7 | `mgmt/backend/src/r2.js:113` | `getFromR2` returns `contentType`, never read | Simplify the return |
| L-8 | `mgmt/backend/src/consentPlaceholders.js:36` | `DOCUMENTED_GUARANTOR_SLOTS` exported, used only internally | Un-export |
| L-9 | `mgmt/frontend/src/views/ConsentPage.jsx:157` | `consent_vt_${token}` template literal duplicated (inline in the `useState` initialiser and as `verifyStoreKey`) | Hoist the key above the `useState` |
| L-10 | `mgmt/frontend/src/views/Home.jsx:24` | `autoGenerateDocType` duplicates `whatsapp.js:625` `resolveCollectionDocType` | Derive both from one shared table |
| L-11 | `mgmt/frontend/src/receiptTemplate.js` + `views/ConsentPage.jsx:31` | Two placeholder substituters with a comment saying they must stay in sync | Import the one from `receiptTemplate.js` |
| L-12 | `mgmt/backend/src/settings.js:36` | `WEEKDAY_HI` is a bare array indexed by `d.getDay()` — but `d.getDay()` is **local** while the label is formatted in `Asia/Kolkata` | Derive the index from the IST parts too, or the Hindi and English day names can disagree by one |
| L-13 | `mgmt/backend/src/views.js:5` | `parseAmt` is re-declared in 6 files (`views.js`, `loans.js:20`, `templates.js:234`, `docxTemplates.js:406`, `script.js:2`, `Home.jsx`) | Extract to a shared `money.js` |
| L-14 | `mgmt/backend/src/index.js:205` | A stale comment block ("The error_log table has no columns for actor/device/IP…") sits above `summarizePayload`, which it does not describe | Move it above `buildLogContext` |
| L-15 | `mgmt/backend/src/index.js:566` | Comment still references `DRIVE_SA_EMAIL`/`DRIVE_SA_PRIVATE_KEY`, which `wrangler.toml:41` explicitly says are read by no code | Delete the stale comment |
| L-16 | `mgmt/backend/src/account.js:216` | `getDriveAccessToken` caches the token in KV under a fixed key with no namespacing | Prefix `drive:` for consistency with `pub:`/`rl:`/`mgmtcache:` |
| L-17 | `Public/frontend/script.js:762` | `window.onload = app.init` clobbers any other handler | Use `addEventListener('load', …)` |
| L-18 | `Public/frontend/script.js:141` | `res.collections.forEach` etc. assume the keys exist; the stale-snapshot path could omit one | `(res.collections \|\| []).forEach` |
| L-19 | `Public/frontend/script.js:24` | `escapeAttr` is just an alias for `escapeHtml` — misleading, since attribute and text contexts differ | Either implement it properly or drop the alias |
| L-20 | `mgmt/frontend/src/views/*` (11 files) | `key={i}` / `key={idx}` array-index keys | Use the stable `__rowIndex` / business id (see P-1) |
| L-21 | `mgmt/frontend/index.html:73` | `GTM-M2JP98W5` hardcoded with a "replace with your real container ID" comment | Move to `VITE_GTM_ID` |

---

# 8. PRIORITY-RANKED ACTION LIST

### Stop-ship — fix before the next deploy (days)

| # | Action | Finding | Effort |
|---|---|---|---|
| 1 | Whitelist the tables reachable via `saveRecord`/`updateRecord`/`deleteRecord`; make `edit`/`delete` table-scoped | **C-1** | 2 h |
| 2 | Stop trusting `req.mode` / `req.force` in `convertDocxToPdf`; forbid consent doc types outside the token-gated path; validate `recordId` against `docType` | **C-2** | 3 h |
| 3 | Remove `token` and `otp` from `getLoanConsents` / `getConsentsForReview`; raise both to Admin+; blank `otp` on verify | **C-3** | 1 h |
| 4 | Replace every `Math.random()` credential with `crypto.getRandomValues` (OTP, consent token, announce token) | **C-4** | 1 h |
| 5 | Role-gate `getUserProfile` / `getUserHistory` / `getUsers`; drop them from `CACHEABLE_ACTIONS`; add `getUsersForPicker` | **H-1** | 3 h |
| 6 | Fix `m.Role` → `m['View Role']` in `errorLog.js` (+ the public frontend) so error escalation works at all | **H-2** | 15 min |
| 7 | Split the Public Worker onto its own KV namespace; key mgmt sessions by token hash | **H-4** | 2 h |
| 8 | Cap `maxBytes` on every base64 entry point (consent photo/signature, `uploadFile`, docx, queue payload) | **H-6** | 1 h |
| 9 | Delete the `uploadFile` action (or Superadmin + sniff + private) | **H-7** | 30 min |
| 10 | Add the security headers, especially `Referrer-Policy: no-referrer` (the consent token is in the URL) | **H-14** | 1 h |

### This sprint (1–2 weeks)

| # | Action | Finding | Effort |
|---|---|---|---|
| 11 | Convert all 107 user-facing `throw new Error` to `ValidationError`; add the CI grep | **H-3** | 4 h |
| 12 | Make `saveLoanTransaction` / `deleteLoanTransaction` single batches; delete orphaned consents | **H-8** | 2 h |
| 13 | Allocate `sl_no` inside the INSERT; add the uniqueness indexes | **H-9** | 2 h |
| 14 | Apply the missing-index migration (`users.id_code`, `loan_consents.consent_id`, `error_log` dedup, …) | **H-10** | 1 h |
| 15 | Batch the `getUserProfile` and `getPersonDownloads` N+1 loops | **H-11** | 3 h |
| 16 | Default "remember me" to off; shorten the long session to 7 days; plan the cookie migration | **H-12** | 1 h |
| 17 | Delete `getClientIp` / the ipify call | **H-13** | 30 min |
| 18 | Revoke other sessions on password change / forced reset | **H-15** | 1 h |
| 19 | Key the announce-PIN lockout on token+IP; require numeric PINs; stop echoing the PIN | **H-17** | 1 h |
| 20 | Make `markAnnounced` an atomic increment; coerce the year in `reannounceAll` | **H-18** | 1 h |
| 21 | **Stand up the test harness** (`vitest` + `@cloudflare/vitest-pool-workers`) and land the auth/authorization/consent/backup suites | **H-19** | 3 days |
| 22 | Add the CI workflow | **H-19** | 2 h |
| 23 | Add the retention sweep for `collection_jobs.filled_base64`, `activity_log`, `login_attempts`, message tables | **M-38** | 3 h |
| 24 | Role-gate the template-read actions and `getRecordsForDocType` / `get*Data` | **M-1..M-3** | 1 h |
| 25 | Throttle `processCollectionQueue` | **M-4** | 30 min |

### Next (2–6 weeks)

| # | Action | Finding | Effort |
|---|---|---|---|
| 26 | Paginate the public portal payload; split `portalData` into `summary`/`collections`/`person`; add the snapshot size guard | **H-5** | 1 week |
| 27 | Paginate + memoise + virtualise the Home collection list; fix all index keys | **P-1, P-2** | 3 days |
| 28 | Introduce `zod` schemas at the router boundary | **Q-1** | 3 days |
| 29 | Cache docx template bytes in KV; add Drive fetch timeouts | **P-4, P-5** | 1 day |
| 30 | Move bulk PDF generation server-side onto `collection_jobs` (or bounded concurrency) | **P-3** | 3 days |
| 31 | Make `restoreBackup` incremental per binding; require an acknowledged fresh snapshot | **H-16** | 2 days |
| 32 | Migrate the `REAL`-affinity identity columns to `INTEGER`/`TEXT` and delete the coercion workarounds | **M-33** | 3 days |
| 33 | Add FKs, `NOT NULL`s and `CHECK` constraints | **M-34, M-35** | 2 days |
| 34 | Fix the seven full-table USERS scans in the consent flow | **M-14** | 2 days |
| 35 | Pause the three polling loops when the tab is hidden | **P-8** | 2 h |
| 36 | Public Worker health check + config validation | **M-36, M-37** | 4 h |
| 37 | Extract the shared code that is currently comment-enforced (aliases, `parseStoredDate`, `isTruthyFlag`, `escapeHtml`, `driveUrl`) into one package | **Q-3, Q-4, M-31** | 3 days |
| 38 | Extract the 600-line router into a module-level handler map | **Q-6** | 1 day |
| 39 | Add a `staging` environment with its own D1/KV ids | **Q-7** | 1 day |
| 40 | Sweep the Low list; replace `alert`/`confirm` with the Modal | **§7, Q-11** | 2 days |

---

# 9. PRODUCTION-READINESS SCORE

## **4.5 / 10**

| Dimension | Score | Notes |
|---|---|---|
| **Security** | 3 / 10 | Two live privilege-escalation paths (C-1, C-2), consent forgery via leaked credentials (C-3), non-CSPRNG OTPs (C-4), IDOR on all member PII (H-1), a public Worker holding the session store (H-4), no CSP or `Referrer-Policy` while the consent token sits in the URL (H-14). Password hashing, session revocation, timing-safe comparisons, CORS fail-closed and per-IP limiting are all genuinely well done — which makes the remaining holes more surprising, not less serious. |
| **Correctness** | 5 / 10 | A great deal of real bug-fixing is visible and documented. But `reportErrorToWhatsApp` has never worked (H-2), every validation message surfaces as a 500 (H-3), loans can be written non-atomically (H-8), receipt numbers can collide (H-9), and `reannounceAll` can silently no-op (H-18). |
| **Reliability / ops** | 5 / 10 | Strong: a real readiness probe, structured logging with de-dup, a KV last-known-good snapshot, a D1 read budget, claim-and-lease queues, graceful R2→Drive fallback. Weak: no retention (unbounded `filled_base64` in D1), no public health check, three fail-open limiters with no alerting, and a restore path that can die mid-swap. |
| **Performance / scale** | 4 / 10 | The version-keyed ETag/edge-cache design is genuinely good. Against it: an unpaginated multi-megabyte public payload, an unpaginated + unvirtualised admin list, a missing index on the single hottest lookup (`users.id_code`), N+1 loops in the profile and download paths, and ~9 full USERS/LOANS scans across the consent flow. This will fall over at the stated 32k-member scale. |
| **Testing** | 0 / 10 | Nothing. No runner, no test, no CI. |
| **Code quality** | 6 / 10 | Exceptionally well-commented, sensible module boundaries, shared helpers extracted where it matters. Against it: a 600-line router built per-request, no schema validation, four inconsistent response shapes, four copies of `isTruthyFlag` (which already disagree), and a dozen invariants enforced only by comments. |
| **Config / secrets** | 7 / 10 | Secrets correctly kept out of the repo, `.gitignore` explicitly excludes the PII dumps that GitGuardian previously flagged, stale credential names documented as dead. Against it: one environment only, an unvalidated `VITE_API_URL`, and a hardcoded API URL + GTM id in the public frontend. |

### What "production-ready" would take

The four Criticals plus items 5–10 are roughly **two focused days** of work and would move this to ~6.5/10 — defensible for a committee-scale deployment. Getting to 8+ requires the test harness (item 21) and the pagination work (items 26–27); without tests, every fix in this document is one careless commit away from regressing, and the codebase's own comment history proves that is exactly what keeps happening.

### The honest summary

This does not read like a codebase that was never reviewed — it reads like one that has been reviewed *repeatedly and reactively*, fixing each production incident as it surfaced and writing an excellent comment about it. What is missing is the layer that makes those fixes stick: authorization expressed as data rather than as scattered `require*` calls, request schemas, and tests. Three of the four Critical findings (C-1, C-2, C-3) are the *same* underlying mistake — trusting a client-supplied value (`sheet`, `mode`, `SELECT *`) to select an authorization outcome — and all three sit right next to comments describing an earlier, narrower version of the same bug being fixed.

