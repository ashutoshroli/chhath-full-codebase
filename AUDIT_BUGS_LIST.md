# Codebase Audit — Bugs List (koi fix nahi kiya gaya, sirf list)

Date: 2026-08-31 · Branch: `main` · Scope: pura repo (mgmt worker + mgmt frontend + Public worker + Public frontend + db schema/migration)

**Status: SIRF ANALYSIS. Koi file change nahi, koi build nahi.**

Scope ke 4 sawal:
1. PDF kahan-kahan se generate hota hai → Section 1
2. WhatsApp message kahan-kahan se jata hai → Section 2
3. docx→pdf placeholders — instructions page se kya missing hai → Section 3
4. Kaun-kaun error errorLog me nahi aata → Section 4

---

## 0. Do sabse bade structural facts (baaki sab bugs inhi se nikalte hain)

**Fact A — Repo me koi WhatsApp bhejne wala code hi nahi hai.**
`graph.facebook|twilio|aisensy|interakt|wa.me` — poore repo me zero match. Worker sirf D1 table (`person_messages` / `group_messages`) me `status='pending'` row INSERT karta hai. Actual sending ek bahar ka polling script (`manager.js`, `WHATSAPP_QUEUE_SETUP.md` me documented) karta hai jo repo me nahi hai.
→ Iska matlab: **Cloudflare Queue bhi nahi hai.** `mgmt/backend/wrangler.toml` + `Public/backend/wrangler.toml` me `[[queues.producers]]`, `[[queues.consumers]]`, `[triggers]`, `crons` — kuch nahi (verified: grep khali). `mgmt/backend/src/index.js` sirf `fetch` export karta hai — koi `queue()` ya `scheduled()` handler nahi.
→ Isliye: **retry nahi, backoff nahi, DLQ nahi, claim/lease nahi, idempotency nahi, staleness alert nahi.**

**Fact B — Repo me koi server-side PDF renderer nahi hai.**
Sirf 2 engine:
- **Engine A (asli PDF):** browser docxtemplater se `.docx` fill karta hai (`mgmt/frontend/src/docxFill.js`) → base64 Worker ko → Worker Google Drive ke 3-step conversion se PDF banata hai (`mgmt/backend/src/drive.js` `convertDocxBytesToPdf`) → PDF **sirf Google Drive** me rehta hai, link `drive.google.com/uc?export=download&id=…`. **R2 binding nahi hai.** CloudConvert / LibreOffice / Puppeteer / pdf-lib — kuch nahi.
- **Engine B (fallback):** `html2canvas` + `jsPDF` pura browser me, sirf `mgmt/frontend/src/components/ReceiptModal.jsx:69-74`. Output seedha `doc.save()` → **Drive me nahi jata, `generated_files` me index nahi hota, public portal pe kabhi nahi dikhega.**

---

## 1. PDF Generation — Inventory + Bugs

### 1.1 Inventory (6 paths)

| # | Path | Entry | Engine | Indexed? | Role gate |
|---|---|---|---|---|---|
| P1 | Collection save pe auto-PDF | `views/Home.jsx:123` → `autoGeneratePdf()` `:146-194` | A | ✅ | `requireAdminOrAbove` |
| P2 | Row ka "Download PDF" modal | `components/ReceiptModal.jsx:49-81` | A **ya** B | A=✅ / B=❌ | `requireSuperadmin` (bug B1) |
| P3 | Bulk Generate PDFs | `views/BulkGeneratePdfs.jsx:44-60` | A | ✅ | `requireSuperadmin` |
| P4 | Download Center | `views/DownloadCenter.jsx:11-32` | A | ✅ | `requireSuperadmin` |
| P5 | Yearly Report (report_en/hi/both) | `views/PdfExport.jsx:141-161` | A | ✅ (duplicate, bug B5) | `requireSuperadmin` |
| P6 | Public Consent PDF (no login) | `views/ConsentPage.jsx:385-432` | A | ✅ (galat id, bug B6) | **koi nahi** (bug B2) |

Consume side: `Public/backend/src/index.js:51` pura `generated_files` table anonymous ko deta hai; `Public/frontend/script.js:461-527` recordId string dobara bana kar Download link dikhata hai; `:141-198` QR verification.

### 1.2 `generated_files` schema (`mgmt/db/schema/file_index.sql:6-18`)
```
id INTEGER PK AUTOINCREMENT, doc_type TEXT, year REAL, record_id TEXT,
file_name TEXT, public_link TEXT, drive_path TEXT, generated_at TEXT
```
Column names code se match karte hain (koi mismatch nahi). **Lekin koi `UNIQUE` constraint nahi** — verified: `grep UNIQUE mgmt/db/schema/*.sql` → zero match, poore repo me.

### 1.3 PDF Bugs

**B1 — 🔴 CRITICAL — Admin/Subadmin kabhi Receipt/Certificate/Samaan PDF download nahi kar sakte**
`mgmt/backend/src/docxTemplates.js:131` → `if (user) { isAutoGenerate ? requireAdminOrAbove(user) : requireSuperadmin(user); }`
`ReceiptModal.jsx:61` → `api.convertDocxToPdf(docType, year, recordId, filledBase64, fileName)` — **6th arg `isAutoGenerate` pass hi nahi hota** (api.js:237 me woh 6th param hai). Home.jsx:170 pe `true` pass hota hai, ReceiptModal pe nahi.
`Home.jsx` me download icon pe **koi role check nahi** (grep: `role ===` / `Superadmin` — Home.jsx me zero match). To Admin/Subadmin button dekhte hain aur click pe `"Sirf Superadmin ye action kar sakta hai."` milta hai.
Aur zyada gandbad: agar us saal ka `.docx` template nahi hai to woh chupke se Engine B (jsPDF raster) chala deta hai — matlab **failure role + template dono pe depend karta hai**, predict karna mushkil.

**B2 — 🔴 CRITICAL — `convertDocxToPdfPublic` aur `getDocxTemplatePublic` bilkul unauthenticated hain**
`index.js` (verified):
```
getDocxTemplatePublic:  () => docx.getDocxTemplatePublic(env, req.docType, req.year)       // no withAuth
convertDocxToPdfPublic: () => docx.convertDocxToPdfPublic(env, ..., req.base64, ...)       // no withAuth
```
Aur `docxTemplates.js:131` ka `if (user)` → `user=null` pe **saare role check skip**. Koi bhi anonymous caller:
- (a) kisi bhi docType/year ka committee ka raw `.docx` template download kar sakta hai,
- (b) **arbitrary base64** committee ke Google Drive me push kar sakta hai (`drive.js` `setAnyoneReader` = `role:reader, type:anyone`),
- (c) `generated_files` me **arbitrary row INSERT** kar sakta hai — jise public portal green "✅ Verified Record" bana kar dikhata hai (`Public/frontend/script.js:168, 186-192`).

`docxTemplates.js:125-129` ka comment kehta hai "record_id + token-gated data flow already authorized the request upstream" — **ye galat hai, is handler tak koi token nahi aata.** Consent token verify hi nahi hota.

**B3 — 🔴 HIGH — PDF-index failure ka error_log row banta hai par report nahi ho sakta (schema mismatch)**
`docxTemplates.js:105`:
```sql
INSERT INTO error_log (source, page, message, stack, context, created_at) VALUES (?,?,?,?,?,?)
```
`error_id` aur `reported` **chhoot gaye** → dono NULL. Nateeja:
- `ErrorLog.jsx:38` → `key={r.error_id}` = duplicate `null` React keys
- `ErrorLog.jsx:46` → "Ref: undefined"
- `ErrorLog.jsx:50` → `report(null)` → `errorLog.js:18` `WHERE error_id = ?` kuch nahi milta → throw `'Error record nahi mila.'`
- `reported` NULL hone se `errorLog.js:32` ka `WHERE reported = 0` kabhi match nahi karega
→ Jo ek diagnostic "fix" add kiya gaya tha, woh **dikhta hai par escalate kabhi nahi ho sakta**.

**B4 — 🔴 HIGH — Duplicate index rows / duplicate Drive files (read-then-write race)**
`docxTemplates.js:136-139` `SELECT` karke check karta hai, phir baad me `INSERT` — bich me koi transaction nahi, DB me koi UNIQUE constraint nahi. Do concurrent request (Home auto-generate + Download Center "Generate Now", double-click, ya retry) — dono guard paas kar jate hain, dono convert karte hain (2 Drive PDF, 1 orphan), dono INSERT karte hain. Public portal ka `.find()` phir arbitrary row uthata hai.
→ `PDF_INDEX_DIAGNOSTIC.md` ka "Issue 2: duplicate key … Already handled!" **jhoot hai** — koi UNIQUE constraint schema me nahi hai.

**B5 — 🔴 HIGH — Report PDF har click pe naya duplicate row banata hai (unbounded growth)**
`PdfExport.jsx:153` → ``const recordId = `${docType}-${year}-${Date.now()}` ``
Timestamp-based recordId hone se `isFileGenerated` **kabhi match nahi karega**. Har click = naya Drive PDF + naya `generated_files` row (migration me already seeded: `report_en-2025-1787430285014`). Ye rows har anonymous visitor ko `portalData` me jate hain, aur unka QR `?record=report_en-…` pe point karta hai jo `Public/frontend/script.js:171-181` resolve nahi kar sakta → "Record Not Found".

**B6 — 🔴 HIGH — Guarantor consent PDF galat ID pe index hota hai → hamesha "Not Available"**
`ConsentPage.jsx:391` → `const consentRefId = placeholders.LOAN_CONSENT_ID || placeholders.CONSENT_ID;`
`loans.js` me guarantor ke liye `LOAN_CONSENT_ID` = **loaner ka** consent_id, aur `CONSENT_ID` = guarantor ka apna. `||` pehla non-empty uthata hai → **galat wala**.
PDF store/index hota hai: `consent_guarantor-<year>-<LOANER consent_id>`, filename `Consent-<LOANER id>.pdf`
Dhundha jata hai: `consent_guarantor-<year>-<GUARANTOR consent_id>` (`docxTemplates.js:369`, `Public/frontend/script.js:502`)
→ Kabhi match nahi, kabhi dikhta nahi, aur baad me ek duplicate PDF aur ban jata hai.
Extra instability: loaner ne consent na diya ho to `LOAN_CONSENT_ID` = `''` → **wahi guarantor ko different recordId** milta hai depending on timing.

**B7 — 🔴 HIGH — jsPDF fallback content kaat deta hai + kabhi index nahi hota**
`ReceiptModal.jsx:69-74` — ek hi `html2canvas` snapshot, ek **single** page pe `addImage(..., 0, 0, width, height)`. Koi pagination loop nahi. Preview container `minHeight: <page>mm` hai (`:106`), to ek A5/A4 se lamba receipt **bina warning kat jata hai**.
Output flat JPEG (text select/search nahi ho sakta), sirf `doc.save()`, Drive me nahi, `generated_files` me nahi → public portal pe hamesha "Not Available", WhatsApp me attach bhi nahi ho sakta.
Aur `if (!previewRef.current) return;` (line 69) `try` ke andar se return karta hai — **koi error user ko dikhta hi nahi**, button ruk jata hai bas.

**B8 — 🔴 HIGH — Same document ke liye filename/recordId do jagah alag banta hai**
`ReceiptModal.jsx:60` → `` `${label}-${placeholders[docNoKey]}.docx` `` jahan `label` = `"Material Receipt"` (space ke saath) → Drive me `Material Receipt-NCS-SAMAAN-2026-7.pdf`
`docxTemplates.js:229` (bulk) → `` `samaan-${SAMAAN_NO}` `` → `samaan-NCS-SAMAAN-2026-7.pdf`
Same `record_id`, **do different `file_name`/`drive_path`** — depend karta hai kisne generate kiya. Migration me already dikhta hai: `Receipt-NCS-2026-11.pdf` vs lowercase `receipt-…` neighbours. Drive-vs-DB reconciliation impossible.

**B9 — 🔴 HIGH — Template download bade template pe JS stack tod deta hai, aur user ko galat message milta hai**
`mgmt/backend/src/drive.js:78` → `btoa(String.fromCharCode(...new Uint8Array(buf)))`
Ye `.docx` ke **har byte ko function argument** bana deta hai. ~100 KB se bada template (matlab koi bhi template jisme logo/letterhead image hai) → `RangeError: Maximum call stack size exceeded`.
Aur **saare** callers `.catch(() => null)` karte hain — `Home.jsx:148`, `ReceiptModal.jsx:54`, `DownloadCenter.jsx:15`, `BulkGeneratePdfs.jsx:31`, `PdfExport.jsx:64` — to user ko dikhta hai **"is saal/type ka koi .docx template nahi hai, upload karo"** jabki template exist karta hai aur theek hai.

**B10 — 🔴 HIGH — Record edit karne pe PDF regenerate nahi hota, delete karne pe PDF hatta nahi**
`Home.jsx:105-123` edit pe bhi `autoGeneratePdf` chalata hai, par recordId same rehta hai → `docxTemplates.js:136-139` `{skipped: true, publicLink: <purana file>}` return karta hai. **Corrected amount/name PDF me kabhi nahi jata**, aur wahi purana stale link WhatsApp me attach hota hai aur public portal serve karta hai.
Ulta bhi: `crud.js` ka `deleteRecordByIdx` `generated_files` ya Drive ko touch hi nahi karta → **deleted contribution public portal pe abhi bhi downloadable "Verified Record" dikhta hai.** Poore repo me koi invalidation/reconciliation code nahi.

**B11 — 🔴 HIGH — Collection ka WhatsApp message ek fire-and-forget browser promise pe latka hai**
`Home.jsx:123-128`:
```js
autoGeneratePdf(...).then(fileLink => { if (isNewEntry) api.queueCollectionMessages(...) })
```
**await nahi** hai, aur `finally` (line 143) `setSaving(false)` kar deta hai — user ko lagta hai save ho gaya. Tab band, navigate away, ya flaky network (ye multi-second multi-request operation hai) → **na PDF, na index row, na WhatsApp message queue hua** — chupchap, aur `error_log` me kuch nahi kyunki koi `catch` fire hi nahi hota. `.then(...)` callback pe `.catch` bhi nahi — uske andar throw = unhandled rejection.

**B12 — 🟠 MEDIUM-HIGH — `indexFailed` flag 6 me se sirf 1 caller check karta hai**
`docxTemplates.js:151-168` `{success:true, indexFailed:true, error:'PDF generated but not indexed…'}` return karta hai.
Sirf `Home.jsx:173-180` check karta hai. Ignore karne wale: `ReceiptModal.jsx:61`, `DownloadCenter.jsx:23`, `BulkGeneratePdfs.jsx:49-53`, `PdfExport.jsx:155`, `ConsentPage.jsx:417`. Bulk to use **success** count karta hai (`done + 1`).

**B13 — 🟠 MEDIUM-HIGH — Public portal har visit pe pura file index leak karta hai**
`Public/backend/src/index.js:51` + `:101-104` → **saare** `generated_files` rows (har year, har docType — `consent_loaner`/`consent_guarantor` aur report PDFs bhi), `file_name` aur internal `drive_path` ke saath, `Access-Control-Allow-Origin: *`, no auth, no pagination, no cache headers.
Har `public_link` ek Drive file hai jo explicitly `role:reader, type:anyone` share hai → **saare loan consent documents enumerable + readable** kisi ke liye bhi. Aur payload B5 ki wajah se hamesha badhta rahega.

**B14 — 🟡 MEDIUM — Silent catch jo error ke bajaye GALAT document bana deta hai (QR)**
`.catch(() => '')` on QR generation: `BulkGeneratePdfs.jsx:46`, `DownloadCenter.jsx:21`, `ReceiptModal.jsx:47`, `ConsentPage.jsx:406`, `Home.jsx:166`.
Fail hone pe placeholder `''` ban jata hai, jo `docxFill.js:26-34` `atob('')` ko deta hai → **zero-length image buffer**. PDF permanently archive ho jata hai missing/corrupt QR ke saath → us document ka public "Verified Record" flow tut jata hai. Koi error, koi log, koi retry nahi.

**B15 — 🟡 MEDIUM — Backend silent failures Drive layer me**
- `drive.js` `trashFile` — sab kuch swallow (`catch (e) { /* non-fatal */ }`), aur `fetch` await bhi nahi hai → orphan intermediate Google Docs jama hote rehte hain, invisible.
- `drive.js` `setAnyoneReader` — **`res.ok` check hi nahi karta**. Permission grant fail ho jaye to bhi ek `public_link` jise koi khol nahi sakta, success maankar `generated_files` me likh diya jata hai.

**B16 — 🟡 MEDIUM — Bulk generation me koi throttle/backoff/retry nahi**
`BulkGeneratePdfs.jsx:44-60` serial loop, per record ~8-11 Drive subrequests (3× `getOrCreateFolder` + convert-upload + export + pdf-upload + `setAnyoneReader` + `trashFile`), plus OAuth refresh on KV miss. Per-request Workers limit (50/1000) safe hai, par **Drive ke per-user rate limit** ke against koi throttle nahi. Drive 429 = ek "failed" line ek in-memory UI log me jo refresh pe gayab.
Memory: `drive.js` ek waqt me incoming base64 string + uska `Uint8Array` decode + exported PDF `ArrayBuffer` + multipart `Blob` — roughly 4× document size, 128 MB isolate me.

**B17 — 🟡 MEDIUM — Devanagari font embedding bilkul nahi hai**
`mgmt/frontend/public/fonts/NotoSansDevanagari.ttf` sirf `styles.css` ke `@font-face` me referenced hai. Poore repo me `addFont` / `addFileToVFS` / `setFont` — **zero match**. jsPDF ko ye font kabhi nahi milta.
Engine B me Hindi sirf isliye chalta hai ki woh **rasterized** hai. Aur `ReceiptModal.jsx:70` pe `document.fonts.ready` ka await **nahi** hai — agar webfont snapshot se pehle load nahi hua, to **archived PDF ke andar Devanagari tofu (□□□) ban jata hai**.
Engine A me Hindi rendering pura Google Docs ke haath me hai — woh chupchap koi bhi missing font substitute kar deta hai. Report loops (`PdfExport.jsx:88-148`) me koi page-break control nahi, to lamba contributor list rows/tables arbitrarily split ho sakta hai.

**B18 — 🟡 MEDIUM — `a.download` dead code hai, download popup-blocked ho sakta hai**
`PdfExport.jsx:156-161`, `ReceiptModal.jsx:62-65`, `ConsentPage.jsx:418-421` — `a.download` set karte hain par `href` cross-origin `drive.google.com` hai; **cross-origin pe `download` attribute ignore hota hai**, file hamesha Drive ke apne naam se aati hai. Anchor DOM me append bhi nahi hota aur `.click()` kai `await` ke **baad** hota hai → Safari/strict popup blocker ise nigal sakta hai, user ko sirf spinner rukta dikhta hai.

**B19 — 🟡 LOW-MEDIUM — Auth surface inconsistent hai**
- `getDocxTemplate` → `requireSuperadmin` ✅
- `getDocxTemplateForDoc` → `withAuth` only, **koi role check nahi** → kisi bhi role ka logged-in user pura template bytes le sakta hai
- `getDocxTemplatePublic` → **koi auth nahi** (B2)
- `searchUsersByVillageAndName` → `withAuth` only, koi role check nahi
- `getPersonDownloads` → `requireStaffRole` → Subadmin har person ke Drive links dekh sakta hai
- `getGeneratedFilesForYear` → Superadmin only
Asli access control PDFs pe zero hai — har generated PDF world-readable Drive link hai.

**B20 — 🟢 LOW — Orphan files**
`uploadDocxTemplate` jaanbujhkar purani Drive file chhod deta hai; `deleteDocxTemplate` sirf DB row delete karta hai, Drive file kabhi trash nahi hoti. B4 ke duplicates aur B12 ke failed index writes bhi unreferenced PDFs chhodte hain. Koi reconciliation tool nahi.

**B21 — 🟢 LOW — Dead schema + stale config**
- `doc_pdf_templates` aur `pdf_templates` tables (`templates.sql`) create + migrate hote hain, **zero lines of code** unhe reference karte hain (hataye gaye pdfme designer ke leftovers).
- `wrangler.toml:11-12` abhi bhi service-account secrets (`DRIVE_SA_EMAIL`/`DRIVE_SA_PRIVATE_KEY`) document karta hai, jabki code ab OAuth refresh-token use karta hai (`account.js`). `MIGRATION_NOTES.md` bhi purani baat kehta hai.
- `year REAL` column (migration me literally `2026.0`) jabki code `parseInt(year)` bind karta hai — SQLite me numerically theek, par public portal ko `parseInt(r.year)` karna padta hai.

---

## 2. WhatsApp — Inventory + Bugs

### 2.1 Inventory (11 live enqueue sites + 1 dead)

Ek hi primitive: `queuePersonMessageDirect()` (`whatsapp.js:158-163`) person ke liye, aur inline `INSERT INTO group_messages` group ke liye — **3 duplicate copies**: `whatsapp.js:270`, `loans.js:133`, `loans.js:358`.

| # | Trigger | Route | Handler | Kya bhejta hai |
|---|---|---|---|---|
| W1 | Collection save (naya entry only) | `queueCollectionMessages` (`withAuth`) | `whatsapp.js:183-373` | 1 group msg **per active group** + 1 person msg contributor ko |
| W2 | Loan create | `saveLoan` (`withAuth`) | `loans.js:86-172` | 1 group + loaner + har guarantor = consent invitations |
| W3 | Consent OTP | `requestConsentOtp` — **no auth** (token = credential) | `loans.js:255-274` | OTP plaintext |
| W4 | Consent accepted | `respondConsent` — no auth | `loans.js:338-380` | group + loaner + "all guarantors accepted" |
| W5 | Consent verified / loan passed | `setConsentVerification` (`withAuth`) | `loans.js:423-468` | `consent_verified_personal`, `loan_passed_personal` |
| W6 | Resend consent link | `resendConsent` (`withAuth`) | `loans.js:470-499` | token rotate, **cap 5** (ye ek hi cap hai poore codebase me) |
| W7 | Replace guarantor | `replaceGuarantor` (`withAuth`) | `loans.js:501-554` | naye guarantor ko invite |
| W8 | Loan disbursement | `markLoanDisbursed` (`withAuth`) | `loans.js:556-586` | `disbursement` template |
| W9 | Error report | `reportErrorToWhatsApp` — **NO AUTH** | `errorLog.js:17-40` | har unique Superadmin number, `message_type='priority'` |
| W10 | Message log resend | `resendMessage` (`withAuth`+Superadmin) | `whatsapp.js:94-103` | status `failed` → `resending` |
| W11 | Queue polling | `getPendingMessages`/`updateMessageStatus` (`withApiKey`) | `whatsapp.js:87-116` | external script |
| — | `triggerUserMessages()` `whatsapp.js:375-386` | — | **DEAD CODE**, kahin import nahi | naye user ka welcome msg kabhi nahi jata |

`Public/backend/src/index.js` (111 lines) read-only hai aur `DB_WHATSAPP_INDEX` bind bhi nahi karta → public portal me koi WhatsApp path nahi (verified clean).

### 2.2 WhatsApp Bugs

**W-B1 — 🔴 CRITICAL — Har WhatsApp error_log write FAIL hota hai (galat columns), chupchap**
`whatsapp.js` ki 4 jagah (verified lines 256, 313, 328, 359):
```sql
INSERT INTO error_log (id, category, location, message, stack, context, timestamp) VALUES (?,?,?,?,?,?,?)
```
Asli table (`mgmt/db/schema/logs.sql:6-16`):
```
id INTEGER PK AUTOINCREMENT, error_id, source, page, message, stack, context, created_at, reported
```
`category`, `location`, `timestamp` — **ye columns exist hi nahi karte.** Aur `id` INTEGER AUTOINCREMENT PK me `'ERR…'` string bind ho raha hai. D1 `no such column: category` throw karta hai.
3 me se 3 call sites `.run().catch(() => {})` karte hain (256/313/328), aur 4th (359) ka apna failure sirf `console.error`.

| Line | Kya khota hai |
|---|---|
| 256 | "No active group template for contribution type N" |
| 313 | "No active person template found" |
| 328 | "Invalid or missing WhatsApp number for contributor X" |
| 359 | `triggerCollectionMessages` ka **asli exception** |

→ **100% WhatsApp queueing failures admin ko invisible hain.** Poora "comprehensive error logging" feature dead hai. Sirf `console.log` bachta hai = `wrangler tail` only.
→ `WHATSAPP_FIX_COMPLETE.md` aur `WHATSAPP_DEBUG_GUIDE.md` jo query suggest karte hain — `SELECT * FROM error_log WHERE category LIKE 'whatsapp%' ORDER BY timestamp DESC` — **woh columns hi nahi hain**. Operator khali result dekhega aur sochega "koi error nahi".

**W-B2 — 🔴 CRITICAL — Group message template add/update hamesha error deta hai**
`whatsapp.js:17` (addTemplate) aur `:32` (updateTemplate) `doc_sub_type` + `file_doc_type` likhte hain **dono** tables me. Par `group_message_templates` schema (verified):
```
id, template_id, text, active, created_at, message_type, contribution_type, file_link
```
`doc_sub_type` aur `file_doc_type` **group table me nahi hain** (sirf `person_message_templates` me hain).
→ `addGroupTemplate` / `updateGroupTemplate` Superadmin ke liye `D1_ERROR` return karte hain — WhatsApp Templates screen pe hard functional break. Yehi reason hai ki deployment pe "0 active group templates for type 1" ho sakta hai.

**W-B3 — 🔴 HIGH — Message do baar ja sakta hai (no claim/lease, no idempotency)**
`getPendingMessages` (`whatsapp.js:87-92`) **saari** `status IN ('pending','resending')` rows return karta hai aur unhe in-flight mark **nahi** karta. Koi bhi doosra/overlapping poll cycle — ya jo send poll interval se lamba chale — wahi rows dobara serve karega.
DB side pe kuch nahi rokta: `UNIQUE(message_id)` nahi, `claimed_at` nahi, attempt counter nahi.
`updateMessageStatus` (`:105-116`) me **koi state guard nahi** — already-`sent` row ko `failed` pe wapas flip kar sakta hai, uske baad `resendMessage` ek doosra send legitimize kar deta hai.
Migration ka asli `remarks` data — "Device not available (retry 3) | Sent using default mobile no", "Resend attempt 1" — dikhata hai ki external sender **false negatives produce karta hai**. Ye observed path hai, theoretical nahi.

**W-B4 — 🔴 HIGH — Browser orchestrator hone se message chupchap drop hote hain**
Collection message enqueue **sirf** tab hota hai jab client save ke baad ek doosra round trip kare (`Home.jsx:120-134`), fire-and-forget, `.catch(err => console.warn(...))`. Tab band / network gaya / session expire / koi 4xx-5xx — **collection save ho gaya, message kabhi queue nahi hua, server pe koi record nahi, error_log me kuch nahi.** Backend me koi reconciliation sweep nahi (cron hi nahi hai) jo "message-less collections" detect kare.

**W-B5 — 🔴 HIGH — `status` hamesha ke liye `pending` reh sakta hai, kisi ko pata nahi chalega**
Worker me kuch bhi `pending → sent/failed` transition nahi karta; sirf external script karta hai. Agar `WHATSAPP_QUEUE_API_KEY` ek side rotate ho jaye (`auth.js:100-105` `!==` se compare karta hai, fail-closed), script ka URL stale ho, ya host down ho — rows infinitely `pending` jama hote rahenge.
**Koi staleness threshold nahi, koi alert nahi, koi cron sweeper nahi, koi DLQ nahi.**
Aur `getPendingMessages` pe **koi `LIMIT` nahi** + `crud.js` ka `SELECT * FROM <table> ORDER BY id ASC` full-table scan — poller ka payload aur scan unbounded badhta rahega.
`'resending'` (jo `:101` set karta hai) me atki row **har poll pe hamesha re-serve** hoti rahegi, kyunki `updateMessageStatus` sirf `sent|failed` accept karta hai.

**W-B6 — 🔴 HIGH — `reportErrorToWhatsApp` ek unauthenticated WhatsApp-blast endpoint hai**
`index.js` (verified — neighbouring mutating actions ke ulta):
```
logError:              () => logError(env, req.source, req.page, ...)        // no withAuth
reportErrorToWhatsApp: () => reportErrorToWhatsApp(env, req.errorId)        // no withAuth, no withApiKey
```
Koi bhi anonymous caller pehle `logError` se ek `errorId` mint kar sakta hai, phir **har Superadmin ko `'priority'` WhatsApp** trigger kar sakta hai (`errorLog.js:31-38`) — fresh IDs ke saath repeatedly. Worker me **kahin koi rate limiting nahi**. Ye sending device ke liye spam/ban vector hai.

**W-B7 — 🔴 HIGH — Phone numbers E.164 nahi hain, aur 3 different mutually inconsistent tarikon se normalize hote hain**
| Jagah | Kya karta hai | Kaun use karta hai |
|---|---|---|
| `whatsapp.js:277`, `:378` | `'91' + digits`, **`+` ke bina**, sirf exactly 10 digits pe | W1 |
| `loans.js:15-19` `whatsappNumberOf` | **bare 10 digits, koi country code nahi** | W2–W8 (matlab **zyadatar** sends) |
| `errorLog.js:36` | **raw `u.WhatsApp \|\| u.Mobile`**, zero validation | W9 |
| `settings.js:56-59` `withCC` | ye ek hi semi-correct hai — **sirf `from` field ke liye**, recipient ke liye kabhi nahi |

Upar se column `mobileno REAL` aur `"from" REAL` hai (verified schema) — **phone numbers float me store hote hain** (`917282032146.0`). `+` ya leading zero survive hi nahi kar sakta. Migration data me same column me `7282032146` aur `917282032146` dono hain. `getMessageLog` UI ko JS number `recipient` bana kar deta hai.
Jo number in regex ko fail karta hai (already `91`/`+91`/space/dash ke saath) woh **chupchap skip** ho jata hai.

**W-B8 — 🟠 MEDIUM-HIGH — Unreplaced `{Placeholder}` verbatim user ko deliver ho jate hain**
`renderTemplate` (`whatsapp.js:120-126`) sirf woh keys substitute karta hai jo caller pass karta hai, coverage validate **nahi** karta. Unknown tokens sent text me survive kar jate hain.
**Migration data me `status='sent'` rows me asli count** (verified):
```
7 {Village}   7 {FatherName}   6 {VillageHindi}   6 {FatherNameHindi}
4 {Year}      4 {PaymentMethod} 4 {Name}          4 {Amount}
3 {NameHindi} 3 {Detail}        2 {Guarantor1/2/3} 1 {LoanerName(Hindi)}
```
Do structural causes:
(a) `triggerCollectionMessages` ka `placeholderData` (`whatsapp.js:210-222`) `Village/FatherName/...` ke liye khali reh jata hai jab contributor mila nahi (`contributor` null) ya `Is Resell` hai;
(b) `notifyConsentAccepted`/`notifyConsentVerified` (`loans.js:347-353`, `:436-442`) bahut chhota `data` object banate hain `createLoanConsents` ke `baseData` (`loans.js:108-119`) ke muqable, jabki wahi operator-authored templates reuse karte hain jo poora set assume karte hain.

**W-B9 — 🟠 MEDIUM-HIGH — 15 swallowed failure paths, ek bhi error_log tak nahi pahunchta**
Sab bare `catch { console.error(...) }` (Workers me `console.error` ephemeral tail-log hai):
`loans.js:64-68` (pura consent creation incl. saare invitations), `loans.js:138` (group invite), `:153` (loaner invite), `:171` (guarantor invites), `:379` (`notifyConsentAccepted`), `:467` (`notifyConsentVerified`), `:583` (disbursement), `whatsapp.js:353-372` (`triggerCollectionMessages` — jiska apna log write W-B1 hai), `whatsapp.js:384-385` (`triggerUserMessages`), plus `.catch(() => {})` at `whatsapp.js:264`, `:321`, `:338`.
Frontend: `Home.jsx:126`, `:133` (`console.warn`), `Home.jsx:148` (`.catch(() => null)`).
→ **Sawal ka seedha jawab: is codebase me literally HAR WhatsApp failure path bina durable error_log row ke swallow hota hai** — ya code try hi nahi karta (loans.js), ya attempt khud broken hai (W-B1).

Extra: `loans.js:60-63` — `createLoanConsents` fail ho to `console.error` karke `return { success: true, loanId }`. **Loan save ho jata hai bina kisi consent record aur bina WhatsApp link ke, aur admin ko "success" dikhta hai.**

**W-B10 — 🟡 MEDIUM — `reportErrorToWhatsApp` messages queue karne se PEHLE `reported=1` mark kar deta hai**
`errorLog.js:32-37` — conditional `UPDATE … WHERE reported = 0` (ye guard khud correct hai) `queuePersonMessageDirect` loop se **pehle** chalta hai. Agar koi insert throw kare, error permanently "reported" flag ho jata hai aur **dobara kabhi bhej nahi sakte**, kahin kuch likha bhi nahi jata.
Aur `errorLog.js:20` `row.reported === 1 || row.reported === true` D1 ke TEXT-affinity `'1'` se kabhi match nahi karta → woh cheap early-exit dead code hai, function hamesha pehle pura USERS + COMMITEE scan karta hai.

**W-B11 — 🟡 MEDIUM — Koi rate limit / fan-out bound nahi; D1 subrequest budget waste**
`triggerCollectionMessages` ~5 full-table `SELECT *` scans karta hai (`USERS`, `WHATSAPP_GROUPS`, `GROUP_MESSAGE_TEMPLATES`, `PERSON_MESSAGE_TEMPLATES`) + per active group 1 INSERT + up to 3 error-log attempts.
`createLoanConsents` `LOAN_MESSAGE_TEMPLATES` ko **3 alag baar** read karta hai (`loans.js:129`, `:143`, `:157`) aur `otpConsentSenderNumber(env)` — ek aur D1 read — **guarantor loop ke andar** call karta hai (`:168`) aur phir `:149` pe bhi.
Koi throttle nahi, koi chunking nahi, active groups pe koi cap nahi — group fan-out `whatsapp_groups` rows ke saath linearly badhta hai, **user-facing save ke request path pe**.

**W-B12 — 🟡 MEDIUM — `whatsappDiagnostic` "Superadmin only" label ke bawajood role check nahi karta**
`index.js` — comment kehta hai `// ---- WhatsApp: Diagnostic endpoint (Superadmin only) ----`, handler sirf `withAuth` wrap karta hai aur **`requireSuperadmin(user)` kabhi call nahi karta** (verified: us block me grep zero match). Compare karo `getPersonTemplates`/`getGroupTemplates`/`getMessageLog` se, jo explicitly `requireSuperadmin` karte hain.
→ Koi bhi authenticated Subadmin saare templates, saare group JIDs aur message previews dump kar sakta hai.
Ye endpoint `isTruthyFlag` ko inline duplicate bhi karta hai instead of fixed wala import karne ke — drift karne wali doosri copy.

**W-B13 — 🟡 MEDIUM — `message_id` collision possible aur unguarded**
`generateMessageId()` (`whatsapp.js:8`) = `'MSG' + Date.now().toString(36) + 6 random base36 chars`, aur `loans.js:135` + `loans.js:360` pe **inline duplicate**. `UNIQUE` constraint na hone se collision pe `updateMessageStatus` ka `UPDATE … WHERE message_id = ?` multiple rows hit karega aur `resendMessage` ka `.first()` arbitrary uthayega — silent cross-recipient status corruption.

**W-B14 — 🟡 LOW-MEDIUM — Koi retry/backoff nahi, aur resend gate reach hi nahi hota**
Worker me zero retry/backoff. Ek hi recovery = manual Superadmin `resendMessage`, jo **hard require karta hai `status === 'failed'`** (`whatsapp.js:99`). Kyunki is repo me kuch bhi `failed` set nahi karta, `pending` pe atka message (W-B5) UI se **unrecoverable** hai — `WhatsApp.jsx` use `badge-pending` chip dikhata hai aur koi action offer nahi karta.
`resendMessage` pe **koi attempt cap nahi** (`resendConsent` ke `send_count >= 5` ke ulta), to Superadmin infinitely loop kar sakta hai.

**W-B15 — 🟡 LOW-MEDIUM — OTP usi best-effort, unordered, unexpiring pipe se jate hain**
`loans.js:255-274` OTP ko `loan_consents.otp` me likhta hai aur plaintext OTP message enqueue karta hai — **koi expiry nahi**, `verifyConsentOtp` pe **koi attempt limit nahi** (6-digit code pe unlimited guesses), koi delivery guarantee nahi. `requestConsentOtp` by design unauthenticated hai, to link rakhne wala koi bhi us number pe **unlimited OTP messages** enqueue kar sakta hai.

**W-B16 — 🟢 LOW — `templatesForContribution` ka type-3 refinement un-normalized arg compare karta hai**
`whatsapp.js:139` — `if (contributionType === '3')` raw parameter use karta hai, jabki uske upar pool filter `normalizeType` use karta hai. `3`, `3.0`, ya `'3.0'` pass karne wala caller pool to pa jata hai par `doc_sub_type` (Certificate vs Receipt) refinement chupchap skip ho jata hai. Filhal masked hai kyunki frontend `'3'` bhejta hai.

**W-B17 — 🟢 LOW — `updateMessageStatus` unknown `message_id` pe raw `Error` throw karta hai**
`whatsapp.js:115` → `index.js` use `{success:false}` bana deta hai. External script ka finalize call us row ke liye loudly fail karta hai jise usne abhi process kiya — aur phir bhi server side kuch log nahi hota.

**W-B18 — 🟢 LOW — `CONSENT_BASE_URL` placeholder value ship ho raha hai**
Verified: `mgmt/backend/wrangler.toml:6` → `CONSENT_BASE_URL = "https://YOUR-FRONTEND-DOMAIN.example.com"`
`loans.js:108` `env.CONSENT_BASE_URL || ''`, `:494`, `:549` bhi `|| ''` — matlab fail karne ke bajaye **bare `/consent/<token>` path pe degrade** ho jata hai. Sent messages me dead links jate hain, phir bhi `sent` record hote hain.

**W-B19 — 🟢 LOW — Opt-out ka concept hi nahi hai**
Koi `opt_out` column/table nahi, koi STOP keyword handling nahi, koi inbound webhook nahi. Aur `active` flag write side pe `active ? 1 : 0` (`whatsapp.js:29`, `:69`) **TEXT** column me bind hota hai, jabki migration `'True'` likhta hai — DB me `'True'` aur `'1'` mix hote hain. Filhal tolerate hota hai kyunki reader (`isTruthyFlag`) permissive ban gaya hai.


---

## 3. docx → PDF Placeholders — Instructions page se kya missing hai

### 3.1 Do alag-alag template engine hain, do alag syntax

| Engine | Syntax | File | Unknown token ka behaviour |
|---|---|---|---|
| **A — DOCX** | **single brace** `{TOKEN}`, loops `{#loop}…{/loop}`, inverted `{^loop}`, image `{%QR_CODE}` | `mgmt/frontend/src/docxFill.js` (docxtemplater 3.69.3) | `nullGetter: () => ''` → **blank ban jata hai, koi error nahi** |
| **B — Markdown receipt** | `[TOKEN]` + `{{#IF KEY}}…{{/IF}}` | `mgmt/frontend/src/receiptTemplate.js` | **literally render hota hai** (`return m`) |
| **B′ — Consent page** | `[TOKEN]` only (no `{{#IF}}`, no QR) | `views/ConsentPage.jsx:21-23` | literally render, **aur empty-string pe bhi literal** (bug P-B5) |

`{{X}}`, `${X}`, `%X%` — koi bhi supported nahi. Engine A **case-sensitive** hai aur whitespace-tolerant **nahi** (`{ NAME }` / `{Name}` fail). UI ye warn karta hai (`DocxTemplates.jsx:157`) ✅.
**Run-splitting bug NAHI hai** — docxtemplater 3.69 ka lexer `w:t` runs ko join karta hai, aur verified: kisi bhi sample me split token nahi hai.
**Announcements/WhatsApp templates me DOCX placeholder engine nahi hai** — `renderTemplate` (`whatsapp.js:120-126`) alag simple string-replace hai (dekho W-B8).

### 3.2 Bugs

**P-B1 — 🔴 HIGH — Consent ke 11 documented placeholders Bulk Generate / Download Center me chupchap BLANK aate hain**
Ye tokens `DocxTemplates.jsx:8-20` **aur** `ConsentTemplates.jsx:11-18` dono me user ko documented hain, aur `loans.js` (consent page) me resolve hote hain:
```
FINAL_REPAYMENT_DAY_NAME
DIWALI_NEXT_DAY_DATE, DIWALI_NEXT_DAY_DAY_NAME
NAHAY_KHAY_DATE, NAHAY_KHAY_DAY_NAME
CHHATH_MORNING_ARGHYA_DATE, CHHATH_MORNING_ARGHYA_DAY_NAME
ACCEPTED_COUNT, PENDING_COUNT, DECLINED_COUNT
```
Par `docxTemplates.js` ka `base` (getRecordsForDocType = Bulk) aur `buildBase` (getPersonDownloads = Download Center) me **sirf ye 6+n hain** (verified):
```
FUND_YEAR, LOAN_AMOUNT, MONTHLY_INTEREST_RATE, MINIMUM_TENURE_MONTHS,
FINAL_REPAYMENT_DATE, LOANER_NAME, GUARANTOR_{n}_NAME, GUARANTOR_{n}_STATUS
```
`nullGetter: () => ''` ke saath milkar: **wahi template** consent page se poora PDF deta hai, aur Bulk Generate / Download Center se blank dates/day-names/counts wala PDF — **koi error nahi, koi log nahi.**
→ `FIXES_20260831.md` #7 ne sirf **hints** update kiye, **generators nahi** — is claim ko doc me "fixed" likha gaya hai jo galat hai.

**P-B2 — 🟠 MEDIUM-HIGH — `LOAN_CONSENT_ID` guarantor ke liye documented hai par bulk path me missing**
`DocxTemplates.jsx:16` `consent_guarantor` ke liye `LOAN_CONSENT_ID` list karta hai; consent page pe kaam karta hai; par `docxTemplates.js` guarantor branch me sirf `CONSENT_ID` + `GUARANTOR_NAME` add karta hai → bulk/DownloadCenter guarantor PDF me blank.

**P-B3 — 🟠 MEDIUM-HIGH — `samaan-sample.docx` file EXIST HI NAHI KARTI (404)**
`DocxTemplates.jsx:7` → `'samaan-sample.docx'`, download button `:133` pe render hota hai.
Verified `ls mgmt/frontend/public/sample-templates/` → sirf 7 files: certificate, consent-guarantor, consent-loaner, receipt, report-both, report-en, report-hi. **samaan nahi hai.**
→ Material/Samaan type ka "⬇ Download Sample .docx" button 404 deta hai; Vite SPA me typically `index.html` ek bogus `.docx` bankar download ho jata hai.

**P-B4 — 🟠 MEDIUM-HIGH — `report-hi-sample.docx` me Hindi tokens hi nahi hain (English data print karta hai)**
Verified token extraction:
```
report-en : {AMOUNT} {CATEGORY} {DESCRIPTION} {FATHER_NAME} {GUARANTOR_NAME} {INTEREST}
            {LOAN_TAKER} {NAME} {SL_NO} {STATUS} {TENURE} {VILLAGE} {YEAR} …
report-hi : ((BILKUL WAHI list — ek bhi _HI token nahi))
report-both: {NAME_HI} {FATHER_NAME_HI} {VILLAGE_HI} {LOAN_TAKER_HI}
            {STATUS_HI} {CATEGORY_HI} {DESCRIPTION_HI} {GUARANTOR_NAME_HI} ✅
```
`DocxTemplates.jsx:28-34` `report_hi` ke liye `_HI` tokens document karta hai, aur `PdfExport.jsx` unhe **hamesha supply karta hai (teeno modes me)**. Par sample template English keys use karta hai → **"Hindi report" Hindi headers ke neeche English naam/description/status print karta hai**, aur computed `_HI` values फेंक diye jate hain. Blank nahi aata isliye kisi ko pata nahi chalta.

**P-B5 — 🟠 MEDIUM — Consent page blank value pe raw `[TOKEN]` public me leak karta hai**
`ConsentPage.jsx:21-23`:
```js
.replace(/\[([A-Z0-9_]+)\]/g, (m, key) =>
  (placeholders[key] !== undefined && placeholders[key] !== '' ? String(placeholders[key]) : m))
```
`!== ''` condition ki wajah se **real-but-blank field** (jaise Festival Dates enter nahi hui to `FINAL_REPAYMENT_DAY_NAME`) public consent page pe literally `[FINAL_REPAYMENT_DAY_NAME]` print hota hai. `receiptTemplate.js:12` isi case me empty string substitute karta hai — **do resolver diverge karte hain.**

**P-B6 — 🟡 MEDIUM — Receipt ke 2 implemented placeholders instructions me MISSING hain (`DETAIL`, `YEAR`)**
Backend `templates.js` `getReceiptData` `DETAIL` **aur** `YEAR` dono return karta hai. `DocxTemplates.jsx:5` dono document karta hai ✅. Par markdown editor:
- `ReceiptTemplates.jsx:14` `PLACEHOLDER_HINTS` me **`DETAIL` nahi, `YEAR` nahi**
- `ReceiptTemplates.jsx:8-12` `SAMPLE_PLACEHOLDERS` me bhi `DETAIL` nahi
→ Aur seeded receipt sample khud `[DETAIL]` use karta hai (`templates.js:35`) → **`{{#IF DETAIL}}` block editor preview me drop ho jata hai** jabki asli receipt me theek render hota hai. Admin ke liye bahut confusing.
(Certificate `DETAIL` document karta hai ✅, Samaan `ITEM_DETAIL` ✅ — sirf receipt me gap hai.)

**P-B7 — 🟡 MEDIUM — Inverted sections `{^loop}` kahin documented nahi hain, par teeno report samples unpe depend karte hain**
Verified: `report-en`, `report-hi`, `report-both` — sabme `{^loans} {^guarantors} {^contributors} {^expenses}` hain. `DocxTemplates.jsx:154` sirf `{#loop}…{/loop}` document karta hai.
→ Jo admin instructions padhkar template scratch se banayega, uska **"No loans this year" fallback gayab** ho jayega.

**P-B8 — 🟡 MEDIUM — Kisi bhi sample me `{%QR_CODE}` nahi hai**
Verified: saare 7 samples me `QR_CODE` count = **0**.
Instructions (`DocxTemplates.jsx:152`) kehta hai QR available hai, aur `:138` kehta hai "sample edit karo, placeholders waise hi rakho". → **Us raste se QR kabhi nahi milega** jab tak admin haath se tag na daale. Aur QR public portal ke "Verified Record" flow ka core hai.

**P-B9 — 🟡 MEDIUM — `GUARANTOR_{n}_*` code me unbounded, docs me sirf 3**
`loans.js` aur `docxTemplates.js` dono `guarantorConsents.forEach((c, i) => ...)` se jitne guarantors hain utne keys banate hain. `DocxTemplates.jsx` + `ConsentTemplates.jsx` **sirf 1-3** document karte hain.
→ **4th guarantor chupchap un-renderable** hai (uska naam kisi bhi template me nahi aa sakta).

**P-B10 — 🟡 MEDIUM — `GUARANTOR_n_STATUS` do jagah alag compute hota hai**
`loans.js` ka `statusLabel` verification/decline **remarks include** karta hai; `docxTemplates.js` ki trimmed copy **remarks ke bina** hai.
→ `{GUARANTOR_1_STATUS}` consent page pe remarks dikhata hai, bulk-generated PDF me drop kar deta hai. Do copies drift kar rahi hain.

**P-B11 — 🟢 LOW — `ConsentTemplates.jsx` me `GENERATED_AT` / `QR_CODE` documented nahi**
Consent **DOCX** ko dono milte hain (`ConsentPage.jsx:414`), par consent **markdown** page ko nahi. To `ConsentTemplates` me `[GENERATED_AT]` ya `[QR_CODE]` daalne pe woh **literally render** hoga (P-B5 dekho). Na document kiya gaya, na explicitly "unsupported" mark kiya gaya.

**P-B12 — 🟢 LOW — QR ka size template me set nahi ho sakta**
`docxFill.js` image module **hard-coded 100×100 px** hai, chahe docx me tag ka size kuch bhi ho.

**P-B13 — 🟢 LOW — Curly brace delimiters ka fragility**
`{`/`}` delimiter hone se admin ne Word me koi **literal curly brace** type kiya (ya Word ne smart-quote/field artifact bana diya) to **poore document ka parse fail** ho jata hai. Instructions me ye warning nahi hai.

**P-B14 — 🟢 LOW — Transliteration silently galat Hindi DB me likh deta hai**
`transliterate.js:100-104` — Google transliteration API fail hone pe chupchap ek offline rule-table pe fall back karta hai, aur **galat Hindi spelling DB me likh jati hai bina kisi trace ke**. Ye `*_HI` report fields ka source hai.
Note: `transliterate.js` kisi bhi template/placeholder path me use **nahi** hota — sirf data entry me (`TransliterateInput.jsx`, `VillageInput.jsx`, `ListManagement.jsx` bulk action). To `*_HI` values seedhe sheet columns se aate hain; column blank hai to Hindi report me blank aayega, koi on-the-fly rescue nahi.

**P-B15 — 🟢 LOW — `NotoSansDevanagari.ttf` dead weight hai**
Verified: `NotoSans|Devanagari|addFont` — `frontend/src`, `index.html`, `package.json` me **zero reference**. Sirf `styles.css` ka `@font-face`. Ye hataye gaye jsPDF+`hindiPdf` path ka leftover hai (`PdfExport.jsx:12-17` ka comment). Ya wire karo ya delete karo. (Dekho B17.)

### 3.3 Final diff summary — failure class ke hisaab se

| Class | Kya hai | Kaunse |
|---|---|---|
| **(a) implemented but undocumented** | code resolve karta hai, UI batata nahi | `DETAIL`+`YEAR` in ReceiptTemplates (P-B6), `{^loop}` inverted sections (P-B7), `GUARANTOR_4+` (P-B9) |
| **(b) documented but not implemented** | token-name level pe **koi nahi** — har documented token kam se kam ek layer me resolve hota hai | — |
| **(c) ek hi layer me implemented** | **sabse bada problem** — same template, do different output, koi error nahi | 11 consent festival/count tokens (P-B1), `LOAN_CONSENT_ID` guarantor (P-B2), `GUARANTOR_n_STATUS` remarks (P-B10), `GENERATED_AT`/`QR_CODE` on consent markdown (P-B11) |
| **(d) sample/asset mismatch** | instructions theek, shipped asset galat | `samaan-sample.docx` missing (P-B3), `report-hi-sample.docx` English tokens (P-B4), koi sample me QR nahi (P-B8) |

---

## 4. Error Log — kaun-kaun error portal me NAHI aata

### 4.1 Aaj kaise kaam karta hai

**Sirf ek sahi writer:** `errorLog.js:5-15` `logError()` →
```sql
INSERT INTO error_log (error_id, source, page, message, stack, context, created_at, reported) VALUES (?,?,?,?,?,?,?,0)
```
`message` 1000 / `stack` 2000 / `context` 500 chars pe truncate. Poora `try/catch` me — **D1 write fail hua to error chupchap kho jata hai** (`return { success: false }`), aur `ReportErrorButton` ke alawa **koi caller return value check nahi karta**.

**Table** (`mgmt/db/schema/logs.sql`): `id, error_id, source, page, message, stack, context, created_at, reported`
→ **Koi column nahi hai** user/actor, request id, user agent, device id, IP, severity, ya resolved ke liye.
→ `activity_log` table isi schema me exist karta hai (`logs.sql:20-29`) par **kabhi koi INSERT nahi hota**. `api.js` har request pe `deviceId`/`deviceInfo`/`clientIp` collect karta hai aur **phenk deta hai**.

**Read:** `getErrorLog` → `requireSuperadmin`, `SELECT * … ORDER BY created_at DESC LIMIT 300`.

**Automatic capture (jo kaam karta hai ✅):**
1. Har failed frontend API call — `api.js:44-49` + `:64-90`
2. Global browser handlers — `main.jsx:12-18` `window.addEventListener('error')` + `('unhandledrejection')`
3. `ReportErrorButton` mount pe auto-log (public pages: ConsentPage, AnnouncePage, ReceiptModal)
4. Do explicit call sites — `Home.jsx:176-179`, `:187-189` (auto-PDF)

### 4.2 Structural gaps

**E-B1 — 🔴 CRITICAL — Backend me koi top-level error logging NAHI hai**
`index.js` ka only top-level wrapper:
```js
} catch (err) {
  const status = err.authError ? 'authError' : (...);
  return jsonOut({ success: false, message: err.message || String(err), [status]: true });
}
```
**`logError` kabhi call nahi karta.** Backend errors error log tak **sirf isliye** pahunchte hain ki mgmt React frontend unhe wapas echo karta hai (`api.js` `fireAndForgetLogError('backend', …)`).
→ **Koi bhi doosra client** — Public portal, external WhatsApp script (`withApiKey`), curl, bot — ko 200 JSON error milta hai aur **kuch bhi persist nahi hota.**
→ `err.stack` bhi response me nahi jata, isliye backend-sourced rows me `stack` **hamesha `''`** hota hai.

**E-B2 — 🔴 CRITICAL — Poora `Public/` portal ZERO error logging**
Verified:
- `Public/backend/wrangler.toml:41` → `# Deliberately NOT bound here: DB_TEMPLATES, DB_WHATSAPP_INDEX, DB_LOGS` → Public Worker **physically likh hi nahi sakta**
- `Public/backend/src/index.js` → `try`/`catch` grep = **zero match**. `fetch` handler me koi try/catch nahi. `getAllPortalData` (8 sequential table scans) me koi D1 failure = unhandled rejection = Cloudflare `1101 Worker threw exception` = invisible
- `Public/frontend/script.js` → `onerror|unhandledrejection|logError` grep = **KOI ERROR LOGGING NAHI**. Portal data fail = `console.error` + "Failed To Load Data" banner. Popup fetch pe `.catch(() => {})` with comment "never surface an error for it"
→ **Poora public transparency portal — backend aur frontend dono — total blind spot hai.**

**E-B3 — 🔴 CRITICAL — WhatsApp ke saare errors invisible** — dekho **W-B1** (galat columns, `.catch(()=>{})`)

**E-B4 — 🔴 HIGH — PDF-index error row report nahi ho sakta** — dekho **B3** (missing `error_id`/`reported`)

**E-B5 — 🔴 HIGH — `logError` ka delivery fetch khud network pe depend karta hai**
`api.js:47` → `fetch(API_URL, {...}).catch(() => {})`
→ **Sabse common failure — `TypeError: Failed to fetch`, offline, CORS, Worker down — kabhi record nahi ho sakta.** Migration me jo rows hain woh sirf isliye hain ki network wapas aa gaya tha.

**E-B6 — 🔴 HIGH — Koi React ErrorBoundary nahi**
Verified: `ErrorBoundary|componentDidCatch` — `mgmt/frontend/src` me **zero match**.
→ Render throw poora tree unmount kar deta hai (white screen), log sirf `window.onerror` se hota hai.
→ `App.jsx` ke 4 `Suspense` boundaries pe koi `.catch` nahi — redeploy ke baad **lazy-chunk 404 page blank kar deta hai**.

**E-B7 — 🔴 HIGH — Log spam real errors ko view se bahar phenk deta hai**
Koi rate limiting, dedup, ya fingerprinting nahi — har occurrence ek naya row.
**Migration data proof** (verified, 234 rows total):
- **7 identical** "Receipt template missing for year 2018" — 7 second me (ReportErrorButton ka `useEffect` re-fire)
- **5 identical** `"Script error."` — 6 second me
`getErrorLog` `LIMIT 300` hai → **ek spamming loop admin ke view se har asli error nikal deta hai.**

**E-B8 — 🟠 HIGH — `logError` unauthenticated write endpoint hai, koi rate limit nahi**
`index.js` → `logError: () => logError(env, req.source, req.page, ...)` — no `withAuth`, `source`/`page`/`message` fully client-controlled. Koi bhi flood ya poison kar sakta hai (D1 row-write billing + log-injection us WhatsApp message me jo `errorLog.js:35` banata hai).

**E-B9 — 🟠 HIGH — `crud.js` ka silent catch year-lock/year-access check BYPASS kar deta hai**
```js
const row = await d1.prepare(`SELECT year FROM ${table} WHERE id = ?`).bind(rowIndex).first().catch(() => null);
if (row && row.year) { await requireYearUnlocked(...); await requireYearAccess(...); }
await d1.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(rowIndex).run();
```
Agar woh SELECT fail ho jaye → `row = null` → **dono security checks skip** → DELETE phir bhi chal jata hai. Silent security/lock bypass.

**E-B10 — 🟠 HIGH — Saare login / brute-force failures kabhi log nahi hote**
`auth.js:47-63` — galat password, unknown user, aur 5-attempt lockout — sab `{success:false}` return karte hain. Aur `api.js:42` `NO_AUTOLOG_ACTIONS = ['logError', 'reportErrorToWhatsApp', 'login']` me `login` hai → **brute-force ki zero visibility.**
Isi tarah `auth.js:100-105` `withApiKey` ka `Invalid API key` (WhatsApp queue endpoints) kabhi persist nahi hota — echo karne wala browser hi nahi hai.

**E-B11 — 🟠 HIGH — Saare auth/session errors autolog se excluded hain**
`api.js:83` → `if (!err.authError && ...)` → expired token, `withAuth` ka `AuthError`, forced logout — **sab invisible.**

**E-B12 — 🟠 MEDIUM-HIGH — Frontend ka structural rule: sirf `api.js` ke andar se aaya error log hota hai**
`views/**` + `components/**` me ~120 `catch (err) { setError(err.message) }` blocks hain. API failures ke liye woh silent **nahi** hain (ek layer neeche log ho gaya). **Par koi bhi pure client-side error bilkul silent hai**, kyunki `try/catch` me pakda gaya isliye `main.jsx` ke `window.onerror` tak kabhi nahi pahunchta.
Iska matlab **saare client-side docx/PDF/QR generation failures invisible hain**:

| Jagah | Kya kho jata hai |
|---|---|
| `BulkGeneratePdfs.jsx:54` | docxtemplater / `docxFill.js` render errors (bad placeholder, corrupt template). **Sau records ka bulk run pura fail ho sakta hai aur log me kuch nahi.** |
| `PdfExport.jsx:164` | client-side docx fill / PDF assembly failure → `alert` only |
| `PdfExport.jsx:47` | `.catch(() => [])` → partial failure chupchap "no reports yet" dikhta hai |
| `DownloadCenter.jsx:25` | docx fill failure → UI only |
| `ReceiptModal.jsx:76` | ✅ ye covered hai — `ReportErrorButton` render hota hai (manual escalation) |
| QR: `Home.jsx:165`, `BulkGeneratePdfs.jsx:46`, `DownloadCenter.jsx:20`, `ReceiptModal.jsx:45`, `ConsentPage.jsx:406`, `CertificateTemplates.jsx:31`, `ReceiptTemplates.jsx:31`, `SamaanTemplates.jsx:31` | **QR generation failures har jagah silent** — PDF/receipt missing QR ke saath chala jata hai |
| `DocxTemplates.jsx:48`, `PopupManagement.jsx:20` | `reader.onerror` → plain `catch → setError` → upload ka file-read failure **never persisted** |
| `AnnouncePage.jsx:109/132/147` | `try { sessionStorage… } catch (e) { /* ignore */ }` ×3 → Safari private mode me PIN re-prompt loop, log me kuch nahi |
| `transliterate.js:100-104` | galat Hindi DB me likha gaya, koi trace nahi |
| `main.jsx:13, 17` | `.catch(() => {})` — **last line of defence khud swallow karta hai** |

**E-B13 — 🟠 MEDIUM — Logger ke apne recursive failures**
- `errorLog.js:12-14` — D1 down / table locked / oversized payload → `{success:false}`, koi retry nahi, koi fallback nahi
- `reportErrorToWhatsApp` throw karta hai (`'Error record nahi mila.'`, `'Koi Superadmin ka WhatsApp… nahi hai.'`) → `alert()`; `NO_AUTOLOG_ACTIONS` ki wajah se **escalation failures kabhi record nahi hote**
- `reported` TEXT hai aur migration ne `'False'`/`'True'` likha, jabki `errorLog.js:32` `WHERE reported = 0` karta hai → **saare 234 legacy rows pe `meta.changes === 0`** → `{success:true, alreadyReported:true}` return karke **kuch nahi bhejta**, aur `isTruthyFlag('False')` false hai to **button baar-baar dikhta rehta hai**. Silent, repeatable no-op.
- Dekho **W-B10** — `reported=1` messages queue karne se pehle set hota hai

**E-B14 — 🟡 MEDIUM — `stack` aur `context` store hote hain par UI me kabhi dikhte nahi**
`ErrorLog.jsx` sirf `message, page, source, created_at, error_id, reported` render karta hai (verified grep: `stack`/`context` zero match).
→ **Admin ko stack trace kabhi nahi dikhta.** Aur backend rows me `stack` hamesha `''` hota hai (E-B1). `context` dono autolog paths se `''` pass hota hai.

**E-B15 — 🟡 MEDIUM — Koi user attribution / request correlation nahi**
Table me actor column nahi. `api.js:52` already `deviceId` + `deviceInfo` + `clientIp` compute karta hai, par `fireAndForgetLogError` unhe omit karta hai aur `logError` unhe read bhi nahi karega.
→ **Kabhi pata nahi chalega ki kaunse admin ne / kaunse device pe error hit kiya.**

**E-B16 — 🟡 MEDIUM — Koi retention, size cap, ya archiving nahi**
`error_log` pe kahin koi `DELETE`/TTL/`VACUUM` nahi. Unbounded growth; ek hi cap 300-row read window hai.

**E-B17 — 🟡 MEDIUM — Ek table, 3 mutually incompatible writers**
| Writer | Status |
|---|---|
| `errorLog.js:9` | ✅ correct |
| `docxTemplates.js:105` | ⚠️ partial — `error_id`, `reported` missing (B3) |
| `whatsapp.js:256/313/328/359` | ❌ broken — non-existent columns (W-B1) |
Kuch bhi centralise nahi karta — `logError` sirf `index.js:8` import karta hai, **kisi doosre backend module me nahi**.

**E-B18 — 🟡 MEDIUM — Cross-origin script errors log hote hain par bekaar hain**
`main.jsx:12` — `"Script error."` bina stack ke aata hai (migration me 5 aise rows). `crossorigin` attribute / proper CORS headers na hone se ye useless entries hain jo E-B7 ka spam badhate hain.

**E-B19 — 🟢 LOW — `created_at` format inconsistent hai**
`logError` ISO likhta hai (`2026-08-11T00:57:19.000Z`), migration ne `2026-08-11 00:57:19` likha. `ORDER BY created_at DESC` **lexicographic TEXT sort** hai → **dono formats ke beech ordering reliable nahi hai.**

**E-B20 — 🟢 LOW — View me severity/resolved/search/pagination kuch nahi**
`reported` (matlab "WhatsApp gaya kya") hi ek state hai jispe admin action le sakta hai. Koi free-text filter, koi severity, koi acknowledge, koi pagination nahi.

### 4.3 Blind spots — ek line me

1. Poora `Public/` Worker + `Public/frontend` (E-B2)
2. Har WhatsApp queueing failure (W-B1)
3. External queue-consumer script (repo se bahar, aur uske failures kahin nahi jate)
4. Saare login / brute-force / auth failures (E-B10, E-B11)
5. Saare client-side docx / PDF / QR generation failures (E-B12)
6. Har backend error jab caller mgmt React browser nahi ho (E-B1)
7. Koi bhi error jab network ya D1 down ho (E-B5, E-B13)
8. Year-lock bypass jab ek SELECT fail ho (E-B9)

---

## Docs me kiye gaye claims ka verification

| Claim | Reality |
|---|---|
| `PDF_INDEX_DIAGNOSTIC.md` Fix 1 — `recordGeneratedFile` validates + logs + rethrows | ⚠️ **Present, par log INSERT khud broken** (B3) |
| `PDF_INDEX_DIAGNOSTIC.md` Fix 2 — `indexFailed` return | ⚠️ Present, par 6 me se 1 caller honour karta hai (B12) |
| `PDF_INDEX_DIAGNOSTIC.md` Fix 3 — Home.jsx logs index failures | ✅ Present |
| `PDF_INDEX_DIAGNOSTIC.md` "Issue 2: duplicate key … Already handled!" | ❌ **FALSE** — koi UNIQUE constraint nahi (B4) |
| `PDF_INDEX_DIAGNOSTIC.md` "Issue 1: DB_FILE_INDEX/DB_LOGS binding missing" | ❌ Live cause nahi — dono bound hain |
| `FIXES_20260831.md` #3 — fresh `ImageModule` per render | ✅ Actually fixed |
| `FIXES_20260831.md` #4 — Samaan/Kaam/Resell "Rs. 0" fix | ✅ Present |
| `FIXES_20260831.md` #5 — "Already Generated" list | ✅ Present |
| `FIXES_20260831.md` #6 — `GENERATED_AT` in 3 places | ✅ Present in all three |
| `FIXES_20260831.md` #7 — consent/report placeholder hints | ⚠️ **Hints updated, generators NOT** (P-B1) |
| `FIXES_20260831.md` #2 — `crud.js` "already-correct" isTruthyFlag | ❌ **FALSE** — `crud.js` abhi bhi case-sensitive version rakhta hai (`'True'` mis-read karega) |
| `WHATSAPP_ROOT_CAUSE.md` Fix #1 — `isTruthyFlag` handles `'True'` | ✅ `whatsapp.js:148-156` me implemented |
| `WHATSAPP_ROOT_CAUSE.md` Fix #2 — `templatesForContribution` normalizes REAL | ✅ Implemented (residual gap W-B16) |
| `WHATSAPP_ROOT_CAUSE.md` Fix #3 — migration group `active='True'` | ✅ Already applied |
| `WHATSAPP_FIX_COMPLETE.md` "🚨 Still Need to Fix: Database Migration Data" | ❌ **STALE** — woh already fix ho chuka hai |
| `WHATSAPP_FIX_COMPLETE.md` "✅ Error logs in error_log table when something fails" | ❌ **NOT IMPLEMENTED** (W-B1) |
| `WHATSAPP_DEBUG_GUIDE.md` ka `SELECT * FROM error_log WHERE category LIKE 'whatsapp%' ORDER BY timestamp DESC` | ❌ **`category` aur `timestamp` columns exist hi nahi karte** — operator khali result dekhkar "no errors" samjhega |
| `WHATSAPP_FIX_COMPLETE.md` Fix #4 — diagnostic endpoint Superadmin-gated | ⚠️ Endpoint hai, **role check NAHI** (W-B12) |
| `WHATSAPP_QUEUE_SETUP.md` "field names match schema column-for-column" | ✅ Broadly accurate — par claim/lease/idempotency ki absence ko bless karta hai (W-B3) |
| `TEST_AFTER_FIX.md` — browser console me `[recordGeneratedFile] Success` expect karta hai | ❌ Misleading — woh `console.log` **Worker** me chalte hain, sirf `wrangler tail` me dikhenge |
| `MIGRATION_NOTES.md` — docx→pdf "fully ported" | ✅ Accurate; par code ab OAuth refresh-token use karta hai jabki `wrangler.toml` service-account secrets document karta hai |

---

## Bug count

| Area | 🔴 Critical/High | 🟠 Medium-High | 🟡 Medium | 🟢 Low | Total |
|---|---|---|---|---|---|
| PDF generation | 11 | 2 | 5 | 3 | **21** |
| WhatsApp | 6 | 3 | 5 | 5 | **19** |
| Placeholders | 1 | 3 | 6 | 5 | **15** |
| Error log | 6 | 5 | 6 | 3 | **20** |
| **TOTAL** | **24** | **13** | **22** | **16** | **75** |

Note: kuch bugs cross-referenced hain (W-B1 = E-B3, B3 = E-B4), isliye unique count ~70 hai.
