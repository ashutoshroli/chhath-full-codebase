# Popup Management + Error Log — 25 Bugs Fixed

Do audit ka result, ek PR me:

1. **Popup Management (PM-1 … PM-15)** — "popup active nahi kar paa raha hu" ki
   shikayat se shuru hua audit.
2. **Error Log (EL-1 … EL-10)** — live production Error Log (278 rows, 276
   unreported) ko row-by-row padh kar nikale gaye asli defects.

Iske alawa 4 bug **verification ke dauran** mile (`V-1 … V-4`, neeche) — un me se
2 mere hi pichle PR ki galti thi.

---

## Popup Management

### Do root cause the "Active nahi ho raha" ke

**PM-1 — checkbox poora full-width box ban jata tha** (`mgmt/frontend/styles.css`)

`input, select { width:100%; padding:10px; border:1px solid #ddd }` — selector
unqualified tha, to **checkbox aur radio pe bhi lag raha tha**. Phone pe woh ek
bada grey rectangle dikhta hai jisme checked/unchecked ka farq hi nahi pata
chalta, aur rectangle me kahin bhi tap karne se value toggle ho jati hai. App ki
9 checkbox me se sirf 2 pe `style={{width:'auto'}}` ka workaround laga tha.
→ Selector se checkbox/radio exclude kiye, unhe 18×18 ka asli tap target diya,
aur `Login.jsx` ka duplicate workaround hata diya.

**PM-2 — `WHERE active = 1` ne `'True'` ko kabhi match nahi kiya**
(`mgmt/backend/src/popups.js`, `Public/backend/src/index.js`)

`popups.active` **TEXT** column hai. Sheet migration ne `'True'` likha tha, portal
bound number `1` likhta tha (jo TEXT affinity ki wajah se `'1'` ban jata hai).
Query `WHERE active = 1` par SQLite literal ko TEXT affinity deta hai — to woh
`'1'` match karta hai par **`'True'` kabhi nahi**.

Asli SQLite me verify kiya:

```
active values: 'True', '1', 1, '  TRUE ', 'yes', 'False', 'no', '0', NULL, ''
WHERE active = 1  →  sirf '1' aur 1 wale rows
```

Aur admin list ka badge `isTruthyFlag()` se render hota tha, jo `'True'` **accept**
karta hai. Isliye portal "Active" dikhata tha aur popup kisi ek visitor ko bhi
serve nahi hota tha. Dono jagah SQL comparison hata kar ek hi shared predicate se
JS me filter kiya — ab dono readers ka drift hona possible nahi.

### Baaki popup bugs

| # | Bug | Fix |
|---|---|---|
| **PM-3** | `uploadFileToDrive` do URL deta hai — `url` = `…/file/d/<id>/view` (HTML **page**) aur `directUrl` = `…/uc?export=view&id=<id>` (asli image). `PopupManagement.jsx:78` **`res.url`** save kar raha tha, to UI me se upload kiya gaya har popup image editor, login aur public portal — teeno jagah broken tha | Backend ab `imageUrl` (= `directUrl`) return karta hai; teeno readers me `driveImageUrl()` rewrite; purane rows migration se theek |
| **PM-4** | Migrated slide row me `text`/`link_url`/`link_text` **NULL** the. `save()` ka `s.text.trim()` `try/catch` ke **bahar** TypeError phenkta tha → **Save button chupchap kuch nahi karta tha**, koi error kahin nahi dikhta tha | Backend `slideOut()` me `|| ''` coalesce, frontend me `str()` helper, migration se stored NULLs `''` |
| **PM-5** | `datetime-local` ki wall-time seedhi bhej di jati thi. Worker me local = UTC, to IST admin ka 2:31 PM ka window asal me 2:31 PM **UTC** = 8:01 PM IST pe khulta tha — **5.5 ghante late** | `fromLocalInputValue()` browser me asli instant (`toISOString()`) banata hai; `toLocalInputValue()` wapas local wall time deta hai |
| **PM-6** | Legacy rows `'2026-08-22 14:31:00'` (space, no timezone) — Safari **parse hi nahi kar pata** | `parseStoredDate()` / `normalizeStamp()` dono forms handle karte hain (ordering bug ke liye V-1 dekho) |
| **PM-7** | Zero-slide popup `getActivePopups` chupchap drop kar deta tha — admin ko pata hi nahi chalta ki popup kabhi dikhega hi nahi | `getPopups` ab `slide_count` deta hai, list warning dikhati hai |
| **PM-8** | Sirf `'Public'` role wala popup **apne hi author ko invisible** tha, kyunki `getActivePopups` caller ke role pe filter karta hai | Naya `previewPublicPopups` — "Preview as Public" |
| **PM-9** | Public portal sirf `popups[0]` render karta hai; baaki eligible popups chupchap kho jate the | Preview `alsoEligibleButNotShown` + `droppedNoSlides` batata hai |
| **PM-10** | **XSS** — popup `text`/`link_text` public site pe `innerHTML` me seedha jata tha aur `link_url` `javascript:` accept karta tha. Yani mgmt portal public site me injection vector tha | `escapeHtml()`/`escapeAttr()`, `safeUrl()` sirf http(s) allow karta hai |
| **PM-11** | Save par `active` **number** bind hota tha TEXT column me → DB me `'1'` aur `'True'` ka mixture | Ab explicitly `'1'`/`'0'` string bind hoti hai |
| **PM-12** | Badge permissive `isTruthyFlag` use karta tha jabki query `= 1` — UI aur reality alag | Ek hi `popupIsLiveNow()` predicate dono jagah |
| **PM-13** | `uploadPopupImage` base64 validate nahi karta tha | Size + format validation |
| **PM-14** | Popup ke user-facing errors plain `Error` the → Error Log me chale jate the | `ValidationError` (EL-6 dekho) |
| **PM-15** | Purane broken image ka toota icon **har user ko login pe** dikhta tha | `onError` se image hide |

---

## Error Log

| # | Bug | Rows | Fix |
|---|---|---|---|
| **EL-1** | `api.js` `const data = await res.json(); if (data.authError)` — `getDocxTemplate()` null return karta hai → `jsonOut(null)` → body `"null"` → `data === null` → **`Cannot read properties of null (reading 'authError')`**. Production ka **sabse frequent asli error**, aur woh sabse aam path pe firing tha ("is saal ka template nahi hai") | 12+ | `null`/`undefined` ab seedha pass-through |
| **EL-2** | Non-JSON body (CDN ka HTML error page, 502) → `Unexpected token '<'` | kuch | `res.json()` ke around try/catch + samajhne wala message |
| **EL-3** | `tableRegistry.js` me collections alias `'AnnouncedCount' → 'announced_count'`, par schema me column **`announcedcount`** hai. Reverse-map miss hua → `announcements.js` me `row.AnnouncedCount` hamesha `undefined` → **announce counter hamesha 0** | — | Alias theek kiya; 8 unit tests |
| **EL-4** | Unmapped key sanitizer se guzar kar **`father_s_name`** ban jata tha (original sheet headers me trailing space tha: `"Father's Name "`) | kuch | `toColumnPayload` ab unknown key pe **throw** karta hai, chupchap mangle nahi karta |
| **EL-5** | Views `(view.data || []).map(...)` karte hain — response truthy **non-array** hote hi `.map is not a function` | 3 | `useViewData` ab `list` (hamesha array) deta hai; `data` waisa hi |
| **EL-6** | Har validation/permission message Error Log row ban jata tha — "Galat PIN", "OTP galat hai", "Sirf Superadmin…", plus **har galat password**. 278 me se ~50 rows yehi the, asli defects dhundhna namumkin | ~50 | Naya `ValidationError`; `isExpectedError` ab `expected` flag dekhta hai; login me **sirf lockout** log hota hai |
| **EL-7** | `Uncaught TypeError: this.i.at is not a function` — `Array.prototype.at()` Chrome 92+/Safari 15.4+ chahta hai, purane Android WebView pe app **poori mar jati thi** | 5 | Asli polyfill (V-2 dekho — pehla attempt kaam nahi kar raha tha) |
| **EL-8** | Deploy ke baad purana tab hashed chunk maangta hai jo ab exist nahi karta → dead screen. `await import()` wali jagah ErrorBoundary ko **bypass** karti hain | 8+ | Naya `chunkGuard.js` — detect karke **ek baar** auto-reload (1-min cooldown), `safeImport()` manual imports ke liye |
| **EL-9** | MetaMask / browser-extension ka shor jo kabhi hamara bug hi nahi tha | kuch | `IGNORED_ERROR_PATTERNS` |
| **EL-10** | Ek outage = 10-15 rows (har in-flight action ka apna message, isliye dedup fail) | 10-15 | Transport failures ek shared message ke tehat, min me ek baar |

---

## Verification ke dauran mile (V-1 … V-4)

Ye tab mile jab main fixes ko **asli SQLite aur asli build** pe test kar raha tha.

**V-1 — `parseStoredDate` ka order ulta tha (4 jagah)** — *sabse important*

Code pehle `new Date(raw)` try karta tha, aur **fail hone par** `'Z'` lagata tha.
Par V8 space-wala form (`'2026-08-22 14:31:00'`) **accept** karta hai aur usko
**LOCAL time** padhta hai — to fallback sirf Safari me chalta tha, aur Chrome/Node
chupchap local time maan lete the. Natija: Worker (TZ=UTC) aur IST browser **ek hi
stored value pe 5.5 ghante ka farq** karte the.

Behavioural test 6 timezone me chalaya (`Asia/Kolkata`, `America/New_York`,
`Pacific/Chatham` +12:45, …) — pehle **9 test fail** hue, jo exactly yehi bug tha.
Ab zone `new Date()` ke **pehle** decide hota hai. Chaaron copies
(`popups.js`, `Public/.../index.js`, `toLocalInputValue`, `fmtStamp`) identical
hain — verify kiya.

**V-2 — `.at()` ka fix asal me kaam nahi kar raha tha (EL-7)**

Pehle `vite.config.js` ka `build.target` neeche kiya tha, aur comment me likha tha
ki isse esbuild `.at()` ko "down-level" kar dega. **Ye galat hai** — esbuild
*syntax* lower karta hai (`??=`, optional chaining), *instance methods* nahi, aur
koi runtime shim ship nahi karta. Asli build pe grep kiya: `chrome87/safari14`
target ke baad bhi **19 raw `.at(` calls** the — `marked` ke lexer se
(`tokens.at(-1)`) aur pdf chunk ke APNG decoder se. Dono dependencies hain, to
apne code me avoid karna possible nahi tha.
→ Asli `src/polyfills.js` banaya (Array/String/TypedArray), `main.jsx` me
**sabse pehle** import kiya. Native ke against 160 differential cases — **0 farq**.
`vite.config.js` ka galat comment bhi theek kiya.

Bundle me baaki modern methods bhi check kiye: `Object.hasOwn` apna `||` fallback
ke saath aata hai, `??=` esbuild lower kar deta hai, aur
`.flatMap`/`.trimEnd`/`Promise.allSettled`/`globalThis`/`queueMicrotask` sab hamare
target se purane hain — koi aur shim nahi chahiye.

**V-3 — migration ka ek statement no-op tha**

`UPDATE popup_slides SET slide_order = CAST(slide_order AS INTEGER)` — column
`REAL` declare hai, to SQLite result pe wapas REAL affinity laga kar `1.0` hi
store karta hai. SQLite me verify kiya: 3 baar chalane ke baad bhi `1.0`/`real`.
Aur zaroorat bhi nahi thi — dono readers pehle se `parseInt(r.slide_order) || 0`
karte hain. Statement hata diya (dead code ship karne se behtar), kaaran comment me
likh diya.

**V-4 — `whatsapp.js` `resendMessage` me aadha kaam hua tha**

Ek hi function me line 213 `ValidationError` thi par uske 3 sibling throws plain
`Error` reh gaye the — yani wahi function kuch user messages log karta, kuch nahi.
Teeno convert kiye.

---

## Verification

| Kya | Result |
|---|---|
| SQL migration, asli SQLite pe, **asli production seed row** ke saath | **18/18 pass**, 3 baar chala kar idempotent verify |
| Behavioural tests (real modules import karke, re-implementation nahi) | **81/81 pass**, **6 timezones** me |
| `isIgnorableClientError` (esbuild bundle se) | 13/13 pass |
| `tableRegistry` round-trip | 8/8 pass |
| `Array.prototype.at` polyfill vs native | 160 cases, **0 farq** |
| Polyfill entry chunk me pehle chalta hai? | verify kiya (offset 2384 vs pehla `.at(` 114186) |
| `vite build` (asli) | pass — 683 modules |
| `wrangler@4 deploy --dry-run`, dono Workers | pass |
| Sabhi changed js/jsx parse | 22/22 |
| `parseStoredDate` mgmt vs Public identical | verify kiya |

---

## Jaan-boojh kar nahi kiya

**~110 aur `throw new Error(...)`** mgmt backend me bache hain jo user-facing
validation messages hain (`dropdownLists.js`, `templates.js`, `account.js`,
`crud.js`, `views.js`, aur `loans.js`/`whatsapp.js` ke kuch hisse). Ye Error Log me
**latent shor** hain.

Convert **nahi** kiye kyunki: (a) production log me inme se koi aaya hi nahi —
maine wahi convert kiye jo asal me log me the; (b) inke beech me asli **system**
errors baithe hain jo log hone hi **chahiye** (`Drive upload failed`,
`DRIVE_FOLDER_ID not configured`, `Drive API … failed`) — inhe blind convert karna
asli failures chhupa dega. Ye ek alag, soch-samajh kar kiya jane wala pass hai.

**PR #5 ki 7 deferred items** waise hi hain — `FIX_CHECKLIST.md` me kaaran ke saath
likhi hain (public portal ka Drive-link exposure, WhatsApp opt-out, orphan Drive
cleanup, font embedding, dead tables drop, server-side WhatsApp orchestration,
Cloudflare Queue).

---

## Deploy

```bash
# 1. Migration (SIRF chhath-misc pe)
cd mgmt/db
npx wrangler d1 execute chhath-misc --remote --file=./migration/2026-09-01/05-popups-active.sql

# 2. Dono Workers
cd ../backend        && npx wrangler deploy
cd ../../Public/backend && npx wrangler deploy

# 3. Dono frontends (mgmt me naya polyfill hai — build zaroori)
cd ../../mgmt/frontend && npm run build && npx vercel --prod
```

Verification queries `DEPLOY_GUIDE.md` Step 1c me hain.

> **Zaroori:** `mgmt` frontend **dobara build** karna padega — `.at()` polyfill
> bundle ka hissa hai, sirf Worker deploy karne se woh nahi jayega.
