# Fix Checklist — AUDIT_BUGS_LIST.md ka har bug

Date: 2026-09-01 · Companion to **AUDIT_BUGS_LIST.md** (audit) — ye uska **fix mapping** hai.

Har bug ID audit doc se hai. Status:
- ✅ **FIXED** — code me theek kar diya
- 🟡 **MITIGATED** — root cause architecture me hai, par ab **visible + recoverable** hai (silent nahi)
- 📋 **DEFERRED** — jaanbujhkar nahi kiya, kyun likha hai

**Koi build nahi chalaya gaya** (aapne mana kiya tha). Verification bina build ke kiya gaya — dekho Section "Verification".

---

## 1. PDF Generation — 21 bugs

| ID | Bug | Status | Fix |
|---|---|---|---|
| **B1** | Admin/Subadmin kabhi Receipt/Certificate/Samaan PDF download nahi kar sakte | ✅ | `docxTemplates.js` ka `isAutoGenerate` boolean hata kar explicit `mode` (`auto`/`single`/`bulk`/`public`). `auto`+`single` = `requireStaffRole`, `bulk` = `requireSuperadmin`. `ReceiptModal.jsx` ab `'single'` bhejta hai |
| **B2** | `convertDocxToPdfPublic` + `getDocxTemplatePublic` bilkul unauthenticated | ✅ | Naya `resolveConsentContext(env, token)` — consent token **server pe verify** hota hai. `convertDocxToPdfPublic(env, base64, token)`: docType/year/**recordId**/fileName sab consent row se **derive** hote hain, client se nahi. `if (user)` bypass hataya |
| **B3** | PDF-index error row un-reportable (missing `error_id`/`reported`) | ✅ | `logger.js` ka single writer use hota hai (correct column set). Migration purane rows me `error_id` backfill karta hai |
| **B4** | Duplicate index rows / duplicate Drive files (read-then-write race) | ✅ | `UNIQUE(doc_type, year, record_id)` index + `INSERT … ON CONFLICT DO UPDATE` upsert. **SQLite pe test kiya** — duplicate reject hota hai |
| **B5** | Report PDF har click pe naya duplicate row (`Date.now()`) | ✅ | `PdfExport.jsx` ab stable `${docType}-${year}` recordId + `force=true` — ek row per year per report type |
| **B6** | Guarantor consent PDF galat ID pe index → hamesha "Not Available" | ✅ | `getConsentByToken` ab `consentId` + `docType` return karta hai; `ConsentPage.jsx` `LOAN_CONSENT_ID \|\| CONSENT_ID` guess band, server ka `consentId` use karta hai. Backend bhi recordId khud derive karta hai |
| **B7** | jsPDF fallback content kaat deta hai + kabhi index nahi hota | ✅ | Naya `snapshotToPdf()` canvas ko **multiple pages** me slice karta hai + `document.fonts.ready` await karta hai. Un-indexed hona ab **amber warning** ke saath batata hai. `!previewRef.current` ka silent `return` ab throw karta hai |
| **B8** | Filename/recordId divergence (`Material Receipt-…` vs `samaan-…`) | 🟡 | Upsert (B4) ne reconciliation problem hata di — same recordId ab ek hi row hai, latest filename ke saath. Filename cosmetic hai |
| **B9** | Template download bade template pe stack tod deta hai, galat message | ✅ | `drive.js` `arrayBufferToBase64()` — 32KB chunks, `btoa(String.fromCharCode(...spread))` gaya. **Saare 5 callers** ka `.catch(() => null)` hata — ab "load failed" aur "no template" alag dikhte hain |
| **B10** | Edit pe PDF regenerate nahi, delete pe PDF hatta nahi | ✅ | `crud.js` naya `purgeGeneratedFilesForCollection()` — `updateRecordByIdx` **aur** `deleteRecordByIdx` dono me. Edit ke baad next generate fresh PDF banata hai; delete ke baad public portal se link gayab |
| **B11** | Collection ka WhatsApp message fire-and-forget promise pe latka | ✅ | `Home.jsx` `submit()` ab poora chain **await** karta hai, `savingStep` progress dikhata hai, aur PDF fail hone pe **bhi** message queue karta hai |
| **B12** | `indexFailed` 6 me se 1 caller check karta tha | ✅ | Ab **6/6**: Home, ReceiptModal, BulkGeneratePdfs, DownloadCenter, PdfExport, ConsentPage — sab surface + log karte hain |
| **B13** | Public portal har visit pe pura file index leak karta hai | 🟡 | `drive_path` (internal path) payload se **drop**; `Cache-Control: 60s + stale-while-revalidate`. **Baaki hissa architectural** — dekho "Deferred #1" |
| **B14** | QR silent catch → PDF me corrupt QR | ✅ | `docxFill.js` ab valid 1×1 PNG deta hai (`atob('')` zero-length buffer nahi) **aur** tag record karta hai. Saare 5 QR call sites warning dikhate + log karte hain |
| **B15** | Drive layer silent failures | ✅ | `setAnyoneReader` ab `res.ok` check karta hai (warna un-openable link success maan liya jata tha); `trashFile` orphan Google Doc `logWarn` karta hai |
| **B16** | Bulk generation me koi throttle/backoff/retry nahi | ✅ | `withRetry` (3 attempts, exponential backoff, 429/5xx/timeout detect) + 350ms throttle per record. `notIndexed` counter progress me |
| **B17** | Devanagari font embedding bilkul nahi | 🟡 | `document.fonts.ready` await add kiya — **tofu (□□□) archived PDF me nahi jayega**. Engine A (Google Docs) Hindi khud handle karta hai. `.ttf` wiring architectural hai — dekho "Deferred #4" |
| **B18** | `a.download` dead code, download popup-blocked ho sakta hai | ✅ | `openDownload()` helper — anchor DOM me append hota hai + 1.2s navigation fallback. 4 jagah lagaya |
| **B19** | Auth surface inconsistent | ✅ | `getDocxTemplateForDoc` → `requireStaffRole` (tha: koi check nahi); `searchUsersByVillageAndName` → `requireStaffRole`; `getLoanConsents` → `requireStaffRole`; `whatsappDiagnostic` → `requireSuperadmin` |
| **B20** | Orphan Drive files, koi reconciliation nahi | 🟡 | Upsert duplicate PDFs rokta hai; `trashFile` orphans log karta hai (pehle invisible). Bulk cleanup tool = "Deferred #3" |
| **B21** | Dead schema + stale config | ✅ | `wrangler.toml` secrets correct (`DRIVE_OAUTH_*`, stale `DRIVE_SA_*` hataya); `account.js` ka galat TODO theek + dead `pemToArrayBuffer()` hataya. `doc_pdf_templates`/`pdf_templates` = "Deferred #5" |

---

## 2. WhatsApp — 19 bugs

| ID | Bug | Status | Fix |
|---|---|---|---|
| **W-B1** | Har WhatsApp error_log write FAIL (columns exist hi nahi) | ✅ | Chaaron broken INSERT (`category`/`location`/`timestamp`) hataye → `logger.js`. **Ye poore audit ka sabse bada fix hai** |
| **W-B2** | Group message template add/update hamesha error | ✅ | `group_message_templates` me `doc_sub_type` + `file_doc_type` columns add (schema + migration). **SQLite pe test kiya** — dono tables pe INSERT/UPDATE chalta hai |
| **W-B3** | Message do baar ja sakta hai (no claim/lease/idempotency) | ✅ | `getPendingMessages` ab **claiming read** hai: `status→'sending'`, `claimed_at`, `attempts++`, conditional claim (concurrent poll skip karta hai), 10-min stale reclaim. `UNIQUE(message_id)`. `updateMessageStatus` me `'sent'` **terminal** — SQLite pe verify kiya |
| **W-B4** | Browser orchestrator hone se message chupchap drop | ✅ | `Home.jsx` await + guaranteed queueing (B11). Backend ab real summary `{groupMessagesSent, personMessageSent, warnings}` return karta hai; "0 messages queued" user ko dikhta hai aur log hota hai |
| **W-B5** | `status` hamesha `pending` reh sakta hai, kisi ko pata nahi | ✅ | `getPendingMessages` pe `LIMIT` (default 100); `MAX_ATTEMPTS 5` ke baad `failExhaustedMessages()` auto-fail + log; naya `getStuckMessages` endpoint + **WhatsApp screen pe red banner** ("30 min se atke hain — sender script check karein") |
| **W-B6** | `reportErrorToWhatsApp` unauthenticated blast endpoint | ✅ | KV rate limit **10/hour globally**, aur `logger.js` ka dedup ek hi errorId reuse karta hai (naya mint karke loop nahi ho sakta). Public rehna zaroori hai — Consent/Announce no-login pages |
| **W-B7** | Phone numbers E.164 nahi, 3-4 inconsistent normalizers | ✅ | Naya `phone.js` — `waNumber()`/`waNumberOf()`, canonical `91XXXXXXXXXX`. Sab call sites migrate. Columns `REAL → TEXT`. Migration purana mixed data normalize karta hai. **12 edge cases test kiye** (+91, 0091, trunk 0, dashes, D1 REAL artefacts) |
| **W-B8** | Unresolved `{Placeholder}` verbatim user ko deliver | ✅ | `renderTemplateChecked()` unresolved tokens **strip** karta hai aur kaunse missing hain **log** karta hai. `notificationData()` ab FatherName/Village/Guarantor1-3 supply karta hai (root cause) |
| **W-B9** | 15 swallowed failure paths, ek bhi error_log tak nahi | ✅ | `loans.js` me naya `trySend()` wrapper — har bare `console.error` catch replace, sab `logErrorAt` karte hain |
| **W-B10** | `reportErrorToWhatsApp` queue se pehle `reported=1` | ✅ | Claim-then-**release**: queue fail hone pe `reported` wapas `'0'`. Single-shot claim SQLite pe verify kiya |
| **W-B11** | Koi rate limit / fan-out bound nahi; D1 reads waste | ✅ | `loanTemplateContext()` — `LOAN_MESSAGE_TEMPLATES` + sender **ek baar** (tha: 3-6 reads, aur `otpConsentSenderNumber` guarantor loop ke andar) |
| **W-B12** | `whatsappDiagnostic` "Superadmin only" label, koi check nahi | ✅ | `requireSuperadmin(user)` add; 4th inline `isTruthyFlag` copy hata kar `wa.isTruthyFlag` import |
| **W-B13** | `message_id` collision possible aur unguarded | ✅ | `crypto.randomUUID()` + `UNIQUE(message_id)` index dono tables pe. Inline duplicate generators hataye |
| **W-B14** | Koi retry/backoff nahi, resend gate reach hi nahi hota | ✅ | `resendMessage` ab `failed` **+ pending/sending/resending** accept karta hai (pehle `failed` unreachable tha) + attempt cap. UI pe button har non-sent status pe ("Re-queue") |
| **W-B15** | OTP usi unexpiring pipe se, unlimited guesses | ✅ | KV-backed: **10-min TTL**, **5 verify attempts**, **5 requests/hour**. REAL-affinity-safe compare. Number invalid ho to clear error |
| **W-B16** | `templatesForContribution` type-3 un-normalized compare | ✅ | `normalizeType(contributionType)` use karta hai. `3` / `3.0` / `'3.0'` — **teeno test kiye** |
| **W-B17** | `updateMessageStatus` unknown id pe raw Error | ✅ | Ab `logWarn` karta hai; already-terminal row pe `{alreadyFinal:true}` return (throw nahi) |
| **W-B18** | `CONSENT_BASE_URL` placeholder ship ho raha | ✅ | `consentLinkBuilder(env)` placeholder/empty pe **throw** karta hai clear message ke saath — dead links `sent` record nahi honge. `wrangler.toml` me warning |
| **W-B19** | Opt-out ka concept nahi; `active` flag mixed `'True'`/`'1'` | 🟡 | `active` normalize (write `'1'`/`'0'`, read case-insensitive) + migration data clean. **Opt-out = "Deferred #2"** |

---

## 3. Placeholders — 15 bugs

| ID | Bug | Status | Fix |
|---|---|---|---|
| **P-B1** | Consent ke 11 documented placeholders Bulk/DownloadCenter me BLANK | ✅ | Naya `consentPlaceholders.js` — `buildConsentPlaceholders()` + `consentPlaceholderFactory()`. `loans.js` **aur** `docxTemplates.js` dono same builder use karte hain. Festival dates + counts ab har path me |
| **P-B2** | `LOAN_CONSENT_ID` guarantor ke liye bulk path me missing | ✅ | Shared builder **hamesha dono** `LOAN_CONSENT_ID` + `CONSENT_ID` deta hai |
| **P-B3** | `samaan-sample.docx` exist hi nahi karti (404) | ✅ | **File banayi.** `receipt-sample.docx` se derive, Mobile + Amount rows **hataye** (getSamaanData unhe supply nahi karta). Tokens: `{SAMAAN_NO} {DATE} {NAME} {FATHER_NAME} {VILLAGE} {YEAR} {ITEM_DETAIL} {GENERATED_AT}` |
| **P-B4** | `report-hi-sample.docx` me Hindi tokens hi nahi | ✅ | 8 loop keys `_HI` me rename (`LOAN_TAKER_HI`, `STATUS_HI`, `GUARANTOR_NAME_HI`, `NAME_HI`, `FATHER_NAME_HI`, `VILLAGE_HI`, `DESCRIPTION_HI`, `CATEGORY_HI`). Scalars sahi chhode |
| **P-B5** | Consent page blank value pe raw `[TOKEN]` public me leak | ✅ | `substitutePlaceholders` ab `hasOwnProperty` use karta hai — `receiptTemplate.js` ke saath aligned. Unknown key literal rehta hai (useful signal), blank value blank |
| **P-B6** | Receipt ke `DETAIL` + `YEAR` instructions me missing | ✅ | `PLACEHOLDER_HINTS` **aur** `SAMPLE_PLACEHOLDERS` dono me add — `{{#IF DETAIL}}` block editor preview me ab dikhta hai |
| **P-B7** | Inverted sections `{^loop}` kahin documented nahi | ✅ | Naya instruction 9 — `{^loans}`/`{^guarantors}`/`{^contributors}`/`{^expenses}` explain kiya |
| **P-B8** | Kisi sample me `{%QR_CODE}` nahi | ✅ | Non-report types pe **amber banner**: "sample me QR nahi hai, khud add karo (instruction 7)" |
| **P-B9** | `GUARANTOR_{n}` code me unbounded, docs me 3 | ✅ | Builder **minimum 1-3 guarantee** karta hai + jitne actual hain. UI dono jagah GUARANTOR_4+ mention karta hai |
| **P-B10** | `GUARANTOR_n_STATUS` do jagah alag compute | ✅ | `docxTemplates.js` ki trimmed copy **hatayi** — shared `statusLabel()` (remarks ke saath). **Test kiya** |
| **P-B11** | `GENERATED_AT`/`QR_CODE` ConsentTemplates me documented nahi | ✅ | Red note: consent markdown page pe ye **unsupported** hain (sirf .docx me) |
| **P-B12** | QR ka size template me set nahi ho sakta | 📋 | Cosmetic. `getSize: () => [100, 100]` — QR high-res generate hota hai to sharp rehta hai |
| **P-B13** | Curly brace delimiters ka fragility | ✅ | Instructions me explicit warning: literal `{`/`}` kahin na type karein |
| **P-B14** | Transliteration silently galat Hindi DB me likhta | ✅ | Naya `transliterateWithMeta()` `{text, approximate}` deta hai; offline fallback ek baar **report** hota hai |
| **P-B15** | `NotoSansDevanagari.ttf` dead weight | 📋 | Rakha — `styles.css` use karta hai, aur `document.fonts.ready` fix (B17) uspe depend karta hai |

---

## 4. Error Log — 20 bugs

| ID | Bug | Status | Fix |
|---|---|---|---|
| **E-B1** | Backend me koi top-level error logging NAHI | ✅ | `index.js` ka main catch ab `logError` karta hai `err.stack` ke saath (`ctx.waitUntil`). **Ab har caller cover hai** — Public portal, external script, curl, bot |
| **E-B2** | Poora `Public/` portal ZERO error logging | ✅ | `DB_LOGS` **bind** kiya; `logPublicError()` + dedup; poora fetch handler try/catch me; naya `?action=logError` route; frontend me `window.onerror` + `unhandledrejection` + Retry button |
| **E-B3** | WhatsApp ke saare errors invisible | ✅ | = **W-B1** |
| **E-B4** | PDF-index error row report nahi ho sakta | ✅ | = **B3** |
| **E-B5** | `logError` ka delivery fetch khud network pe depend | ✅ | Failed sends **sessionStorage me buffer** hote hain (max 20) aur `'online'` event pe + next successful call pe flush hote hain |
| **E-B6** | Koi React ErrorBoundary nahi | ✅ | Naya `ErrorBoundary.jsx` — `componentStack` ke saath log, chunk-load error detect (stale bundle → Refresh prompt), details toggle. `App.jsx` (per-tab) + `main.jsx` (root, public pages bhi) |
| **E-B7** | Log spam real errors ko view se bahar phenk deta hai | ✅ | `logger.js` me **5-min dedup** (source+page+message). Public worker me bhi. Client-side dedup bhi |
| **E-B8** | `logError` unauthenticated, koi rate limit | ✅ | Public rehna **zaroori** hai (no-login pages). Abuse dedup (E-B7) + report rate limit (W-B6) se bandh |
| **E-B9** | `crud.js` silent catch year-lock BYPASS kar deta tha | ✅ | `.catch(() => null)` hataya — ab throw karta hai clear message ke saath. **Security fix** |
| **E-B10** | Saare login/brute-force failures kabhi log nahi | ✅ | `index.js` ka `login` handler failures log karta hai identifier ke saath (**password kabhi nahi**). `withApiKey` failures bhi top-level catch se log hote hain |
| **E-B11** | Saare auth/session errors autolog se excluded | ✅ | `api.js` `!err.authError` guard hataya — ab source `'auth'` se log hote hain |
| **E-B12** | Sirf `api.js` ke andar se aaya error log hota tha | ✅ | Naya `reportClientError()` — **13 jagah** lagaya: docxtemplater render, QR, canvas/jsPDF, file read, unresolved placeholders, transliteration, ErrorBoundary, window handlers |
| **E-B13** | Logger ke apne recursive failures | ✅ | `logError` fail hone pe `{success:false}` + tail log; `ReportErrorButton` ab **batata hai** (permanently disabled nahi rehta); `reported` `'False'` normalize (migration) |
| **E-B14** | `stack`/`context` store hote the par UI me kabhi nahi dikhte | ✅ | `ErrorLog.jsx` rewrite — "Stack / context dekhein" toggle. Backend stack bhi ab bharta hai (E-B1) |
| **E-B15** | Koi user attribution / request correlation nahi | ✅ | `buildLogContext(req)` `deviceId` + `deviceInfo` + `clientIp` ko `context` column me fold karta hai (pehle collect karke phenk diye jate the) |
| **E-B16** | Koi retention, size cap, archiving nahi | ✅ | Migration me 180-day retention cleanup; `getErrorLog` configurable limit (300/600/1000) |
| **E-B17** | Ek table, 3 mutually incompatible writers | ✅ | **Ek** writer: `logger.js`. Saare modules usi ko import karte hain |
| **E-B18** | Cross-origin "Script error." rows bekaar | ✅ | `index.html` me `crossorigin` add (root cause); handler opaque case detect karke explicitly batata hai |
| **E-B19** | `created_at` format inconsistent (lexicographic sort tuta) | ✅ | Migration legacy `'YYYY-MM-DD HH:MM:SS'` → ISO convert karta hai |
| **E-B20** | View me severity/search/pagination kuch nahi | ✅ | `ErrorLog.jsx`: text search, source filter, only-unreported filter, limit selector, Refresh, source-colour badges |

---

## Verification Kya Kya Kiya (build ke bina)

| Check | Result |
|---|---|
| **Syntax** — `node --check` (backend + Public) + esbuild parse (72 frontend files) | ✅ **72/72 pass** |
| **Import/export consistency** — custom checker: har relative import resolve hota hai, har named import actually exported hai | ✅ **0 problems** |
| **Router consistency** — frontend ke 123 actions vs worker ke 124 routes | ✅ **har action routed hai** |
| **Behavioural tests** — `phone.waNumber` (12 edge cases), `renderTemplateChecked`, `templatesForContribution`, `isTruthyFlag`, `statusLabel` | ✅ **41/41 pass** |
| **SQL — purane schema pe migration** (asli upgrade path) | ✅ **cleanly applies** |
| **SQL — naye schema pe migration** (idempotency) | ✅ **conflict-safe** |
| **SQL — runtime statements** jo code chalata hai | ✅ **18/18 valid** |
| **UNIQUE constraints actually kaam karte hain** | ✅ duplicate `generated_files`, duplicate `message_id`, duplicate `docx_templates` — teeno reject |
| **`'sent'` terminal hai** | ✅ `sent` row `failed` pe flip nahi hoti |
| **Claim single-shot hai** | ✅ doosra claim `rowcount=0` |
| **Silent swallows** | **27 → 8**, saare 8 pe explicit justification comment |

**Verification me mila extra bug:** SQL comments ke andar semicolon (3 jagah) — `wrangler d1 execute --file` ka naive statement splitter tod deta. Fix kiya.

⚠️ **Build nahi chalaya** (`npm run build` / `wrangler deploy`) — aapne mana kiya tha. Jab bolein, `mgmt/frontend` me `npm install && npm run build` chala kar bundle verify kar dunga.

---

## Deploy karne se PEHLE (zaroori)

1. **Migration chalao** — `mgmt/db/migration/2026-09-01-audit-fixes.sql`. File DB-wise blocks me bata hai; har block apne DB pe:
   ```
   wrangler d1 execute chhath-file-index     --remote --command="<file-index block>"
   wrangler d1 execute chhath-templates      --remote --command="<templates block>"
   wrangler d1 execute chhath-whatsapp-index --remote --command="<whatsapp-index block>"
   wrangler d1 execute chhath-logs           --remote --command="<logs block>"
   ```
   Migration ke bina: group template add/update chalega (columns nahi honge) aur queue claim columns missing rahenge.

2. **`CONSENT_BASE_URL` set karo** — abhi `wrangler.toml` me placeholder hai. `loans.js` ab jaanbujhkar **refuse** karta hai (pehle dead link `sent` mark ho jata tha).

3. **`Public/backend` redeploy karo** — naya `DB_LOGS` binding chahiye.

4. **External WhatsApp sender script** — koi change **zaroori nahi** (field names same hain). Par ab `getPendingMessages` rows ko `'sending'` mark karta hai; agar script `status` field pe depend karti hai to check kar lena. `attempts`/`claimed_at`/`sent_at` naye optional fields hain.

---

## Deferred — jaanbujhkar nahi kiya

| # | Kya | Kyun |
|---|---|---|
| **1** | Public portal `generated_files` ko poora expose karta hai (incl. consent PDFs) | Har PDF ek Drive link hai jo explicitly `type:anyone` share hai — leak **Drive sharing model** me hai, payload me nahi. Asli fix = signed/short-lived links ya R2 + auth. Bada architectural change, alag se decide karo. Filhal `drive_path` drop + caching |
| **2** | WhatsApp opt-out (STOP keyword, `opt_out` column, inbound webhook) | Inbound webhook chahiye, jo repo me hi nahi hai (bhejne wala external script hai). Naya feature, bug fix nahi |
| **3** | Orphan Drive files ka bulk cleanup tool | Naya Superadmin tool + Drive-vs-DB reconciliation. Ab orphans **log** hote hain, to pehle scale dekho phir tool banao |
| **4** | `NotoSansDevanagari.ttf` ko jsPDF me embed | jsPDF path raster hai (html2canvas), to font embedding se koi fayda nahi. `document.fonts.ready` fix (B17) ne asli bug (tofu) hata diya. Asli PDF Google Docs se aata hai |
| **5** | Dead tables `doc_pdf_templates` + `pdf_templates` drop | Zero code inhe use karta hai, par `DROP TABLE` irreversible hai. Data confirm karke alag migration me karo |
| **6** | Server-side WhatsApp orchestration (browser ke bajaye) | `saveRecord` ko messages queue karne chahiye, client round-trip pe nahi. Ab await + guaranteed queueing se drop nahi hota, par sahi fix ye hai. Bada refactor |
| **7** | Cloudflare Queue / cron migration | D1-table-as-queue + external poller replace karna. Ab claim/lease/attempts/stale-reclaim mil gaya hai, par asli Queue me DLQ + platform retries hote hain |

---

## Kuch Bacha? — Cross-check

| Area | Audit me bugs | Fixed | Mitigated | Deferred |
|---|---|---|---|---|
| PDF generation | 21 | 17 | 4 | 0 |
| WhatsApp | 19 | 18 | 1 | 0 |
| Placeholders | 15 | 13 | 0 | 2 |
| Error log | 20 | 20 | 0 | 0 |
| **Total** | **75** | **68** | **5** | **2** |

Plus 4 extra bugs jo fixing ke dauran mile aur fix kiye:
- SettingsModal profile load fail hone pe form blank → save karne pe mobile/email **mit** sakta tha
- ListManagement `getYears` fail = "no years" (Festival Dates section chupchap gayab)
- AnnouncePage ka live poll chupchap mar sakta tha (ab **● OFFLINE** indicator)
- AnnouncementPortal clipboard non-HTTPS pe chupchap fail (ab prompt fallback)

**AUDIT_BUGS_LIST.md ka koi bug bina address chhoda nahi gaya.** Jo fix nahi hua, woh upar "Deferred" me kaaran ke saath likha hai.
