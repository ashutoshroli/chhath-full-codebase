# Analysis — Loan Consent Preview Page Templates (loaner + guarantor)

## Goal (from user)
Seed/replace the STORED consent page template text for BOTH loan consent types with
the user's exact bilingual (Hindi + English) content, via a DB migration, while
keeping the EXISTING Accept / declaration-tick / Decline flow on the public preview
page working. The user reset the DB earlier, so the migration must establish the
correct current text regardless of prior row state.

## Which type keys the preview page renders  (VERIFIED)
The public preview page is the SvelteKit route
`mgmt/frontend-svelte/src/routes/consent/[token]/+page.svelte`. It calls
`api.getConsentByToken(token)`, which maps to
`mgmt/backend/src/loans.js` `getConsentByToken()` (~line 706):

```js
const tplText = (await getConsentPageTemplate(
  env, rowObj.role === 'loaner' ? 'loaner_consent' : 'guarantor_consent'
)).text;
```

So the token-render (preview) path uses type keys **`loaner_consent`** and
**`guarantor_consent`** in the `consent_page_templates` table (TEMPLATES d1 db,
binding `DB_TEMPLATES`).

The `consent_personal_loaner` / `consent_personal_guarantor` types found near
loans.js ~1297 are UNRELATED: they are WhatsApp/email *message* templates
(`loanTemplateContext(env).pick(tplType)`) used by `resendConsent()` to compose the
invitation message — NOT the preview document. **Scope: seed `loaner_consent` and
`guarantor_consent` only.** (First user block = loaner_consent; second block =
guarantor_consent.)

## Table / storage  (VERIFIED)
`consent_page_templates(id INTEGER PK AUTOINCREMENT, type TEXT, text TEXT, updated_at TEXT)`
in `mgmt/db/schema/templates.sql`, TEMPLATES d1 db. There is **no UNIQUE constraint
on `type`**, so an `INSERT ... ON CONFLICT(type)` upsert is not available. CRUD in
`settings.js` (`getConsentPageTemplate` / `updateConsentPageTemplate`) keys rows by
`type` and treats one row per type as the invariant.

Real D1 db name from `mgmt/backend/wrangler.toml`: **`chhath-templates`**.

## How the page substitutes tokens  (VERIFIED)
`+page.svelte` `substitutePlaceholders()`:
```js
(text||'').replace(/\[([A-Z0-9_]+)\]/g, (m,key)=>
  hasOwnProperty(placeholders,key) ? String(placeholders[key]) : m)
```
then `marked.parse()` → `DOMPurify.sanitize()`.
- `[TOKEN]` (unquoted brackets, `A-Z0-9_` only) is replaced with the placeholder value.
- The user writes tokens as `"[TOKEN]"`; the quotes are literal and stay, the inner
  `[TOKEN]` is replaced. Fine.
- **Unknown tokens render as literal `[TOKEN]` text** (the fallback returns `m`).
  This is exactly why the 4 missing tokens must be added — otherwise
  `[LOAN_CONSENT_DATETIME]`, `[LOAN_STATUS]`, `[CONSENT_DATETIME]`,
  `[CONSENT_STATUS]` show up as ugly literal brackets on the final record.
- The document's `☐` checkboxes and the `[ ACCEPT & CONFIRM LOAN ]` /
  `[ ACCEPT CONSENT ]` / `[ DECLINE CONSENT ]` markers contain spaces, so they do NOT
  match the placeholder regex and render as **plain descriptive text**. They are NOT
  interactive and must NOT be wired up.

## Existing Accept / tick / Decline flow — KEEP AS-IS  (VERIFIED)
The real controls in `+page.svelte` are separate hard-coded UI, independent of the
document body text:
1. A declaration checkbox (`bind:checked={agreed}`) gating "Send OTP".
2. OTP verify via WhatsApp.
3. Then `Accept / स्वीकार करें` (photo + geo + signature → `submitAccept`) and
   `Decline / अस्वीकार करें` (reason → `submitDecline`).
4. `data.lockedReason` locks Accept for a loaner until all guarantors accepted.

The user's requirement ("abhi wale me accept or tick wala hai hi to uske hisab se
dono ko update karo") = keep this existing tick/accept/decline flow; only the stored
document TEXT changes. **No second UI is created.** The longer new text simply flows
through `{@html html}` in the existing `.consent-doc` block. No Svelte code change is
required for the template swap to work; a build check confirms nothing regresses.

## Placeholder token gap  (VERIFIED against consentPlaceholders.js)
`buildConsentPlaceholders()` currently emits: LOANER_NAME, GUARANTOR_NAME,
LOAN_AMOUNT, MONTHLY_INTEREST_RATE, MINIMUM_TENURE_MONTHS, FINAL_REPAYMENT_DATE,
FINAL_REPAYMENT_DAY_NAME, FUND_YEAR, LOAN_CONSENT_ID, CONSENT_ID,
DIWALI_NEXT_DAY_DATE/_DAY_NAME, NAHAY_KHAY_DATE/_DAY_NAME,
CHHATH_MORNING_ARGHYA_DATE/_DAY_NAME, ACCEPTED_COUNT, PENDING_COUNT, DECLINED_COUNT,
GUARANTOR_1..3_NAME, GUARANTOR_1..3_STATUS.

The new templates additionally reference these **4 NOT-emitted tokens**:

| Token | Where | Source (loan_consents / loan) |
|-------|-------|-------------------------------|
| `[LOAN_CONSENT_DATETIME]` | Loaner §14 Final Consent Record | the **loaner** consent row's `responded_at` (fallback `created_at`) |
| `[LOAN_STATUS]` | Loaner §14 | the **loaner** consent row's status via `statusLabel()` |
| `[CONSENT_DATETIME]` | Guarantor Consent Record | the **target** consent's `responded_at` (fallback `created_at`) |
| `[CONSENT_STATUS]` | Guarantor Consent Record | the **target** consent's status via `statusLabel()` |

`loan_consents` has `created_at TEXT` and `responded_at TEXT` (verified in
`loans_expenses.sql`). `responded_at` is `''` until a decision is recorded, so use
`responded_at || created_at` so a pending record still shows a timestamp.

Wiring rules (to keep both builders in sync):
- `LOAN_CONSENT_DATETIME` and `LOAN_STATUS` derive from `loanerConsent` (already
  found via `consents.find(c => c.role === 'loaner')`), so they are **loan-level** and
  belong in the base map (safe for `consentPlaceholderFactory`).
- `CONSENT_DATETIME` and `CONSENT_STATUS` derive from `targetConsent`, so they are
  **per-consent** and must be re-computed in the `consentPlaceholderFactory`
  per-consent closure (alongside CONSENT_ID / GUARANTOR_NAME) — mirroring how
  CONSENT_ID is already handled. When `targetConsent` is null (base call), emit `''`.
- Reuse the module's existing `statusLabel(status, consentRow)` for the *_STATUS
  tokens so verification/decline remarks render identically to GUARANTOR_n_STATUS.

## Migration approach  (guard-test compliant)
Guard tests that constrain a new migration:
- `migration-target-databases.test.mjs`: every executable migration must name a real
  db (`wrangler d1 execute chhath-templates ...` in the header); `files.length >= 45`
  (adding one keeps this true); the inert-set list and multi-db-set list are pinned —
  my migration must be **runnable** (single db, executable SQL), not inert/multi-db.
- `pr35-migration-ledger.test.mjs`: asserts `all.length >= 49`, `kinds['multi-db']===2`,
  `kinds.inert===6`. A single-db executable migration keeps these exact counts.
- `migration-matrix.test.mjs`: EVERY file in a non-delegated folder must be added to
  `DECLARED`; the declared file is then **applied twice against `templates.sql`** and
  must be idempotent (no error on 2nd run). Folder `2026-09-05` is DELEGATED to
  `h10-m38-...test.mjs` — to avoid touching h10's pinned list, put the new migration
  in a **NEW folder** `2026-09-18` and register it in `migration-matrix` `DECLARED` as
  `{ schema: 'templates.sql' }`.

Idempotency + "correct text regardless of prior state": because there is no UNIQUE
index on `type`, use **DELETE-by-type then INSERT** per type:
```sql
DELETE FROM consent_page_templates WHERE type = 'loaner_consent';
INSERT INTO consent_page_templates (type, text, updated_at)
VALUES ('loaner_consent', '<exact bilingual text>', '<iso timestamp>');
-- repeat for guarantor_consent
```
This is idempotent (re-running yields exactly one row per type with the intended
text), self-healing after the DB reset, and collapses any stale duplicate rows.
Store text with a literal single-quote escape (`''`) for SQL; the user's text uses
double-quotes around tokens, which need no escaping. **No `BEGIN/COMMIT/SAVEPOINT`**
(D1 rejects explicit transactions in `--file`). Every `[TOKEN]` is preserved
verbatim so `substitutePlaceholders` can replace it.

## Deploy note (for the user)
1. Deploy the mgmt Worker (placeholder code change in `consentPlaceholders.js`).
2. Apply the migration to the TEMPLATES d1 db (this is what puts the correct consent
   text live after the reset):
   ```
   npx wrangler d1 execute chhath-templates --remote \
     --file mgmt/db/migration/2026-09-18/01-loan-consent-preview-templates.sql
   ```
   (Test locally first with `--local` before `--remote`.)
3. The Svelte consent page needs no code change for the text swap; redeploy the
   frontend only if the build output changed.
