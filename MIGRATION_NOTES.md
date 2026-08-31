# Chhath Mgmt Portal — Apps Script → Cloudflare Migration Notes

## Status: Step 1 (Inventory) complete — reviewing before Step 2 (schema) begins

Verified: every `action` in `mgmt/backend/Code.js`'s `handlers` map (95 actions) has a
matching call in `mgmt/frontend/src/api.js`, and vice versa. **Zero dead code, zero
orphan frontend calls.** No routes need to be dropped.

Sheet coverage: all 33 tabs in the xlsx export are accounted for below. **Zero silent
drops.**

---

## 1. Sheet → D1 database mapping

| # | D1 Database | Sheets (tab name in xlsx) → new table name |
|---|---|---|
| 1 | **core** | `Users`→`users`, `Commitee Members`→`committee_members` *(typo fixed, was "Commitee")*, `LOGIN`→`login_users`, `DROPDOWN_LISTS`→`dropdown_lists`, `PORTAL_SETTINGS`→`portal_settings`, `MANUAL YEARS`→`manual_years`, `LOCKED YEARS`→`locked_years`, `FESTIVAL_DATES`→`festival_dates` |
| 2 | **collections** | `Collections`→`collections` (biggest, fastest-growing, isolated per spec) |
| 3 | **loans_expenses** | `Loans`→`loans`, `Loan Guarantor`→`loan_guarantors`, `LOAN_CONSENTS`→`loan_consents`, `LOAN_MESSAGE_TEMPLATES`→`loan_message_templates`, `EXPENSES`→`expenses` |
| 4 | **templates** | `DOCX_TEMPLATES`→`docx_templates`, `DOC_PDF_TEMPLATES`→`doc_pdf_templates`, `CERTIFICATE_TEMPLATES`→`certificate_templates`, `RECEIPT_TEMPLATES`→`receipt_templates`, `CONSENT_PAGE_TEMPLATES`→`consent_page_templates`, `PDF_TEMPLATES`→`pdf_templates`, `SAMAAN_TEMPLATES`→`samaan_templates` |
| 5 | **file_index** | `GENERATED_FILES`→`generated_files` |
| 6 | **whatsapp_index** | `WHATSAPP_GROUPS`→`whatsapp_groups`, `GROUP_MESSAGE_TEMPLATES`→`group_message_templates`, `PERSON_MESSAGE_TEMPLATES`→`person_message_templates`, `GROUP_MESSAGES`→`group_messages`, `PERSON_MESSAGES`→`person_messages` |
| 7 | **logs** | `ERROR_LOG`→`error_log`, `ACTIVITY LOG`→`activity_log`. **`SESSIONS` → moved to Workers KV, not D1** (see note below) |
| 8 | **misc** | `CUSTOM_ANNOUNCEMENTS`→`custom_announcements`, `ANNOUNCEMENT_LINKS`→`announcement_links`, `POPUPS`→`popups`, `POPUP_SLIDES`→`popup_slides` |

**Note on SESSIONS → KV:** Sessions are pure token→{name,role,expiresAt} lookups with a
TTL and no relational joins or reporting need. KV's native `expirationTtl` replaces the
manual `ExpiresAt` cleanup logic in `verifyToken()`/`doLogout()`, and avoids a D1
read/write on literally every authenticated request. Key: `session:{token}`, value:
JSON `{name, role, expiresAt}`, `expirationTtl` set to seconds-until-expiry.

**Note on row identity:** Apps Script uses the physical spreadsheet row number as the
record id (`__rowIndex`, returned in every list response and passed back into
`updateRecord`/`deleteRecord`/etc.). D1 tables use an autoincrement integer `id`
instead — but **the Worker will keep serving that same value back under the same JSON
key name `__rowIndex`**, so `updateRecord`/`deleteRecord`/etc. keep working unchanged
from the frontend's point of view. This means **zero frontend files need to change**
for this identity swap, satisfying the "minimal frontend changes" non-negotiable. It's
a naming shim only — documented here so it isn't mysterious later.

---

## 2. Route inventory (action → logic → D1 db(s)/KV touched)

### Auth / session / profile
| Action | DB(s) | Notes |
|---|---|---|
| login | core, KV | reads `login_users`, writes session to KV |
| logout | KV | deletes session key |
| updateOwnProfile | core | |
| changePassword | core | |
| getUserProfile / getUserHistory | core, collections, loans_expenses | joins across 3 DBs — Worker does 3 fetches, merges in JS (same as Apps Script) |

### Login Management (Superadmin)
getLoginUsers / addLoginUser / updateLoginUser / deleteLoginUser → **core** (`login_users`)

### Generic record CRUD (covers Users, Collections, Committee, Expenses, Loans base row)
saveRecord / updateRecord / deleteRecord → routed by `sheet` param to the right DB/table
via a lookup table in the Worker (`core.users`, `collections.collections`,
`core.committee_members`, `loans_expenses.expenses`, `loans_expenses.loans`). One
generic handler, not five bespoke ones — matches how `Code.js` already does it.

### Years
getYears, getLockedYears, lockYear, unlockYear, addYear → **core** (`manual_years`,
`locked_years`) + reads across collections/loans_expenses for year discovery

### Home / dashboard
getHome, getCommittee, getExpenses, getLoans, getYearContributors → **collections**,
**loans_expenses**, **core** (read-only aggregation, no writes)

### Loans + consent + guarantor flow
saveLoan, deleteLoan, getLoanConsents, resendConsent, replaceGuarantor,
markLoanDisbursed, getConsentsForReview, setConsentVerification,
getConsentByToken/requestConsentOtp/verifyConsentOtp/respondConsent (public, token-auth),
getLoanTemplates/addLoanTemplate/updateLoanTemplate/deleteLoanTemplate →
**loans_expenses** (`loans`, `loan_guarantors`, `loan_consents`,
`loan_message_templates`)

### WhatsApp queue + templates
getPersonTemplates/addPersonTemplate/updatePersonTemplate/deletePersonTemplate,
getGroupTemplates/(add/update/delete)GroupTemplate, getWhatsappGroups/(add/update/delete)WhatsappGroup,
getMessageLog, getPendingMessages (apiKey auth, not session), updateMessageStatus
(apiKey auth), resendMessage, queueCollectionMessages →
**whatsapp_index** (all 5 tables)

### Dropdown lists
getDropdownList, getAllDropdownLists, add/update/deleteDropdownListItem → **core**

### Festival dates / portal settings / consent page templates
getFestivalDates, saveFestivalDates, getPortalSetting, setPortalSetting,
getConsentPageTemplate, updateConsentPageTemplate → **core** / **templates**
(consent_page_templates lives in `templates` db per spec's db #4)

### Receipt / Certificate / Samaan templates (same engine ×3)
get/save/copy/delete(Receipt|Certificate|Samaan)Template, get(Receipt|Certificate|Samaan)Data
→ **templates**

### DOCX templates + PDF conversion
getDocxTemplates, getDocxTemplate, getDocxTemplateForDoc, getDocxTemplatePublic (public),
uploadDocxTemplate, copyDocxTemplate, deleteDocxTemplate → **templates**
(`docx_templates`, binary itself lives on Drive — unchanged, only the pointer row moves to D1)
convertDocxToPdf / convertDocxToPdfPublic → reads **templates**, writes **file_index**
(`generated_files`), calls Drive REST API — **flagged below, needs real service-account creds to verify**

### Bulk generate / download center
getRecordsForDocType, getGeneratedFilesForYear → **file_index** + **collections**/**core**
searchUsersByVillageAndName, getPersonDownloads → **core** + **file_index**

### Popups
getPopups, getPopupWithSlides, savePopup, deletePopup, savePopupSlides,
uploadPopupImage, getActivePopups → **misc** (`popups`, `popup_slides`)

### Error log
logError (public), reportErrorToWhatsApp (public), getErrorLog → **logs** (`error_log`)

### Announcement Portal (built most recently — highest priority to get right)
generateAnnouncementLink, getAnnouncementLinks, revokeAnnouncementLink,
getCustomAnnouncements, add/update/deleteCustomAnnouncement (Superadmin) →
**misc** (`announcement_links`, `custom_announcements`)
verifyAnnouncementPin, getAnnouncementQueue, markAnnounced, reannounceAll (public,
PIN-derived token auth) → **misc** + reads **collections** (announced/priority flags live
on the Collections rows themselves) + KV for the `ANNOUNCE_SESSIONS` fallback pattern
(kept as KV, same reasoning as SESSIONS above)

### Misc/one-time
ensureColumns, bulkFillHindi → schema-setup / data-fix scripts, **not ongoing routes** —
recommend running these once as a migration script rather than porting as live Worker
routes (they exist in Apps Script to backfill bilingual columns onto a live Sheet; D1
schema already has the columns from day one, so there's nothing to backfill). **Proposed:
drop as live routes, keep as a one-off migration script.** Flagging for your confirmation
before I remove them from the Worker.
uploadFile → generic file upload to Drive, unrelated to any D1 db — stays as a thin
Worker route that proxies to Drive REST API.

---

## 3. Flags / open questions before I write code

1. **ensureColumns / bulkFillHindi** — proposing to drop as live routes (see above). OK?
2. **Docx→PDF via Drive REST API** — I can write the Worker route and request shape,
   but the actual Drive service-account OAuth exchange needs a real credential to test
   against. I'll implement it against the Drive v3 API spec and flag the exact env vars
   needed (`DRIVE_SA_EMAIL`, `DRIVE_SA_PRIVATE_KEY`, target folder ID) — you'll need to
   verify the first real conversion manually.
3. **R2→Drive yearly rollover cron** — same caveat: the Drive-write leg needs the same
   service-account credential. I'll write the cron trigger, R2 deletion, and D1
   `storage` column update in full; the Drive upload call will be flagged with a TODO.
4. **Public's D1 scope** — checked `Public/backend/Code.js`'s `getAllPortalData()`
   directly (not just script.js) and it reads **8 sheets**, wider than the task doc's
   "Public reads Collections" assumption: `USERS`, `COMMITEE MEMBERS`, `COLLECTIONS`,
   `EXPENSES`, `LOANS`, `LOAN GUARANTOR`, `GENERATED_FILES`, `LOAN_CONSENTS`. So Public
   needs **read-only** bindings to 4 of the 8 new DBs — **core**, **collections**,
   **loans_expenses**, **file_index** — but still nothing from **templates**,
   **whatsapp_index**, **logs**, or **misc**, which stay mgmt-internal only. (Also
   noting: `Public/backend/Code.js` is itself still Apps Script + Sheets today, not
   Supabase as the task brief assumed — doesn't change scope, since Public's backend is
   out of scope either way, just flagging the discrepancy in case it matters to you.)

---

## Status update — Steps 2–5 complete, Step 6 (loans/consent + templates) partial

### What's fully done and ready to deploy
- **D1 schemas** (`d1/*/schema.sql` × 8) — generated from your live xlsx export,
  every column typed, indexes added on columns Code.js actually filters/joins on.
- **Migration data** (`migration/*.sql` × 8) — real INSERT statements from your live
  data (2,679 rows total across all 8 DBs). Run with
  `wrangler d1 execute <db-name> --remote --file=./migration/<db>.sql` after running
  the matching `schema.sql` first.
- **mgmt-worker** — auth/session (KV-backed), generic CRUD engine, years/locking,
  login management, own-profile/password, dropdown lists, festival dates, portal
  settings, consent page templates (CRUD only — legal text itself already migrated
  via `migration/templates.sql`), popups, error log, WhatsApp templates/groups/queue
  + collection/user message auto-triggers, and the **full Announcement Portal**
  (links, PIN sessions via KV, queue building, mark-announced, reannounce, custom
  announcements) — ported carefully since that's your most recent work.
- **public-worker** — separate deployment, read-only, scoped to exactly the 4 DBs
  Public actually reads (core/collections/loans_expenses/file_index).
- **Frontend** — genuinely zero code changes. Both `api.js` and `script.js` already
  read the backend URL from an env var (`VITE_API_URL` / `API_URL`) — see
  `frontend-diff/DIFF_NOTES.md`.

### Not yet ported (flagged in `mgmt-worker/src/index.js` as `notImplemented`)
These will throw a clear "not yet ported" error if called — nothing fails silently:

1. **Loan consent system** (`saveLoan`, `deleteLoan`, `getConsentByToken`,
   `requestConsentOtp`, `verifyConsentOtp`, `respondConsent`, `getLoanConsents`,
   `resendConsent`, `replaceGuarantor`, `markLoanDisbursed`, `getConsentsForReview`,
   `setConsentVerification`) — Code.js lines ~1945–2954. This is the single most
   intricate piece (OTP flow, photo/signature upload, guarantor replacement,
   geolocation capture) and the one I'd most want to walk through with you rather
   than guess at silently, given it touches money and legal consent records.
2. **Receipt/Certificate/Samaan templates + DOCX templates + docx→pdf conversion**
   — Code.js lines ~3178–3947. Schema + data already migrated
   (`d1/templates/schema.sql`, `migration/templates.sql`), so this is "just" Worker
   route logic — the docx→pdf leg additionally needs your real Drive service-account
   credential to test (see `account.js`'s `getDriveAccessToken()` TODO).
3. **Bulk "Generate PDFs" + Download Center** (`getRecordsForDocType`,
   `getGeneratedFilesForYear`, `searchUsersByVillageAndName`, `getPersonDownloads`)
   — depends on #2 being done first.
4. **Loan message templates** (`getLoanTemplates`/add/update/delete) — small, same
   pattern as `whatsapp.js`'s template CRUD, quick to add.
5. **`bulkFillHindi`** — flagging for your call: is there real backfill work left,
   or is this fully superseded by D1 having the columns from day one like
   `ensureColumns`?

### Package layout
```
MIGRATION_NOTES.md          (this file)
d1/<db>/schema.sql           × 8
migration/<db>.sql           × 8  (real data, ready to run)
mgmt-worker/                 (deploy as its own Worker)
public-worker/               (deploy as its own Worker — separate, read-only)
frontend-diff/DIFF_NOTES.md
```

---

## Status update #2 — Loan consent system now ported (was item 1 in the "not yet ported" list)

`mgmt-worker/src/loans.js` now has the full flow: `saveLoanTransaction`,
`deleteLoanTransaction`, `createLoanConsents` (WhatsApp group + personal
notifications), `recomputeLoanStatus`, the public token-based
`getConsentByToken`/`requestConsentOtp`/`verifyConsentOtp`/`respondConsent`
(including photo/signature Drive upload + geolocation capture), the Admin review
queue (`getConsentsForReview`, `setConsentVerification`), `resendConsent`,
`replaceGuarantor`, `markLoanDisbursed`, and loan message template CRUD. Wired into
`index.js` in place of the earlier `notImplemented` stubs.

Two things worth knowing:
- `loans` table needed two columns (`cash_amount`, `online_amount`) that weren't in
  your live xlsx export but that `markLoanDisbursed` writes to — added to
  `d1/loans_expenses/schema.sql`. Nullable, so the existing migration data (which has
  neither) inserts cleanly.
- All JS files across both Workers pass a Node ESM syntax check, but this is a
  **syntax check only** — I have no way to actually run this against live D1/KV/Drive
  in this sandbox (no network access here), so please treat first deploy as a real
  test pass, especially the money-and-consent-sensitive paths (OTP, photo/signature
  upload, guarantor replace, disbursement).

### Still not ported
1. **`bulkFillHindi`** — the only thing left. Still flagging whether you need this
   ported at all, or whether it's fully superseded by D1 having every bilingual
   column from day one (same reasoning as `ensureColumns`, already dropped).

Everything else — Receipt/Certificate/Samaan templates, DOCX templates, docx→pdf
conversion (`templates.js`, `docxTemplates.js`, `drive.js`), Bulk "Generate PDFs",
and the Download Center — is now ported. That's all 95 original actions accounted
for except this one one-time backfill utility.

### About the docx→pdf path specifically
This one's worth extra caution before you trust it in production:
- It's a 3-step Drive REST dance (upload-with-convert → export-as-PDF →
  upload-the-PDF-bytes) replacing what was a single `Drive.Files.create(...,
  {convert:true})` + `getAs(PDF)` call in Apps Script's Advanced Drive Service.
  I translated it faithfully but **have not run it once** — no network access in
  this sandbox to hit the real Drive API.
- Needs `DRIVE_SA_EMAIL`, `DRIVE_SA_PRIVATE_KEY`, `DRIVE_ROOT_FOLDER_ID` as Worker
  secrets before anything in `docxTemplates.js` or `drive.js` will work at all.
- Suggest testing `uploadDocxTemplate` → `getDocxTemplate` → `convertDocxToPdf`
  in that order on a throwaway doc_type/year first, since a failure partway
  through leaves an orphaned Google Doc in Drive (harmless, but worth knowing —
  `trashFile()` cleans it up on the happy path and on export/upload failures, but
  not if the very first upload-with-convert step itself fails after keeping a
  server-side reference we never used).

### Package layout (unchanged)
```
MIGRATION_NOTES.md
d1/<db>/schema.sql           × 8
migration/<db>.sql           × 8
mgmt-worker/                 (deploy as its own Worker)
public-worker/               (deploy as its own Worker — separate, read-only)
frontend-diff/DIFF_NOTES.md
```

All 95 original Code.js actions are now either ported or explicitly flagged
(`bulkFillHindi` only). Next real step is deploying and testing against your actual
Cloudflare account, D1 databases, KV namespace, and Drive service account — nothing
in this sandbox could exercise those.

---

## Bug fix — Receipt showing ₹0 for Kaam (work) contributions

**Root cause:** Your live `RECEIPT_TEMPLATES` text (confirmed by reading it straight
out of your xlsx export) has an unconditional line: `**Amount Received:** ₹[AMOUNT]`.
Kaam entries genuinely have no Amount (`Home.jsx`'s form sends `Amount: ''` for
non-money contributions), and `Certificate Or Receipt` **defaults to `'Receipt'`**
on every new entry (`Home.jsx` line 46) — so any Kaam entry the person doesn't
manually flip to "Certificate" silently gets the Receipt template with a blank/zero
Amount line. Confirmed this is a pre-existing issue in the live template content
itself, not something the migration introduced — but I ported it faithfully so it
would've carried straight into D1 unless fixed.

**Fixed in three places:**
1. `migration/templates.sql` — the actual `receipt_templates` row that will land in
   your D1 `templates` database now wraps the Amount line in `{{#IF AMOUNT}}`, and
   adds a `{{#IF DETAIL}}` fallback line ("Work/Contribution Detail") so a
   Kaam-as-Receipt entry still shows something meaningful instead of a dangling
   "Amount Received: ₹".
2. `mgmt-worker/src/templates.js` — the code-level sample template (only used to
   seed a brand-new empty `templates` DB) gets the same fix, for consistency.
3. `templates.js` and `docxTemplates.js`'s `formatAmt()` — hardened to check the
   *parsed* number (`> 0`) rather than raw truthiness, so a literal `"0"` string
   (not just a blank value) is also treated as "no amount" and hides the
   `{{#IF AMOUNT}}` block correctly.

**Left alone on purpose:** `Home.jsx`'s default `'Certificate Or Receipt': 'Receipt'`
and the routing logic that picks it — changing that would be a real frontend edit,
and the display-level fix above already makes the Receipt template safe regardless
of which one gets chosen. If you'd rather Kaam entries default to "Certificate"
instead, or want the person entering data to be forced to choose instead of
defaulting, say so and I'll make that frontend change too — it wasn't required to
fix the reported bug, so I left `Home.jsx` untouched per the "zero frontend
changes" approach used throughout this migration.

---

## Bug fix — Receipt/Certificate/Samaan preview showing User ID instead of Name

**This one exists in your original Code.js too** (confirmed at lines 3303, 3438,
3567) — I ported it faithfully, bug included, until you flagged it.

**Root cause:** `Collections.Name` doesn't store the contributor's actual name — it
stores their **User ID** (confirmed in `Home.jsx`'s contributor picker:
`onChange={id => setForm({ ...form, Name: id })}`). The original code did
`users.find(x => x.Name === entry.Name)` — comparing `USERS.Name` (real name) to
`entry.Name` (an ID) — which never matches. So it's actually a bigger bug than just
the Name field: the resolved user object was always `{}`, meaning **Designation,
Father's Name, Village, and Mobile were also silently blank** on every
Receipt/Certificate/Samaan preview and PDF, not just Name.

I checked every other file in the port for the same mistake — everywhere else
(`loans.js`, `whatsapp.js`, `announcements.js`, `account.js`, `views.js`) I'd
already keyed lookups by ID correctly. It was isolated to `templates.js`'s shared
`resolveEntry()` (used by Receipt/Certificate/Samaan) and 4 more spots in
`docxTemplates.js` (Bulk Generate + Download Center) where the user lookup itself
was fine but the `NAME:` placeholder still pulled the raw ID instead of the
resolved name.

**Fixed, 8 spots total:**
- `templates.js` — `resolveEntry()`'s lookup now matches `x.ID === entry.Name`
  instead of `x.Name === entry.Name`, so Designation/Father's Name/Village/Mobile
  resolve correctly again. All 3 `NAME:` placeholders (receipt/certificate/samaan)
  now use `u.Name || entry.Name || ''` — falls back to the raw ID only if the user
  record genuinely can't be found, so nothing silently breaks.
- `docxTemplates.js` — same `u.Name || entry.Name || ''` fix across
  `getRecordsForDocType` (3 spots) and `getPersonDownloads` (1 spot, where the
  lookup was already correct — just the placeholder needed the same fix).

This was worth catching now rather than after your first real Superadmin-uploaded
`.docx` template goes out with blank Designation/Village fields on it.





