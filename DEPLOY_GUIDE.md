# Deploy Guide — PR #5 (audit fixes) ke baad

Ye guide sirf **PR #5 ke fixes** deploy karne ke liye hai. Order important hai —
**migration pehle, phir backend, phir frontend.**

Verified: frontend build ✅ pass, dono workers ka bundle ✅ pass, chaaron migration
files real SQLite pe ✅ test ki gayi hain (purane production schema pe).

---

## ⚠️ Step 0 — Backup (2 minute, skip na karein)

Migration `ALTER TABLE` aur `DELETE` karta hai. D1 me undo button nahi hota.

```bash
cd ~/chhath-full-codebase/mgmt/db
mkdir -p backups && cd backups

# Jin 4 DB ko migration touch karta hai — sirf inka backup zaroori hai
for DB in chhath-file-index chhath-templates chhath-whatsapp-index chhath-logs; do
  npx wrangler d1 export "$DB" --remote --output="${DB}-$(date +%F).sql"
done

ls -la
```

Agar `d1 export` aapke wrangler version me na ho, to kam se kam ye counts note kar lein:

```bash
npx wrangler d1 execute chhath-file-index     --remote --command="SELECT COUNT(*) FROM generated_files"
npx wrangler d1 execute chhath-whatsapp-index --remote --command="SELECT COUNT(*) FROM person_messages"
npx wrangler d1 execute chhath-logs           --remote --command="SELECT COUNT(*) FROM error_log"
```

---

## Step 1 — Migration chalao (SABSE PEHLE)

> **Ye step zaroori hai.** Iske bina naya code **crash karega**: WhatsApp group
> template save nahi hoga, queue ke `attempts`/`claimed_at` columns missing honge.

Chaaron file **alag-alag DB** pe jati hain. Ek-ek karke chalao:

```bash
cd ~/chhath-full-codebase/mgmt/db
```

### 1a. Pehle LOCAL pe test karo (safe — production ko touch nahi karta)

```bash
npx wrangler d1 execute chhath-file-index     --local --file=./migration/2026-09-01/01-file_index.sql
npx wrangler d1 execute chhath-templates      --local --file=./migration/2026-09-01/02-templates.sql
npx wrangler d1 execute chhath-whatsapp-index --local --file=./migration/2026-09-01/03-whatsapp_index.sql
npx wrangler d1 execute chhath-logs           --local --file=./migration/2026-09-01/04-logs.sql
```

### 1b. Ab REMOTE (asli production)

```bash
npx wrangler d1 execute chhath-file-index     --remote --file=./migration/2026-09-01/01-file_index.sql
npx wrangler d1 execute chhath-templates      --remote --file=./migration/2026-09-01/02-templates.sql
npx wrangler d1 execute chhath-whatsapp-index --remote --file=./migration/2026-09-01/03-whatsapp_index.sql
npx wrangler d1 execute chhath-logs           --remote --file=./migration/2026-09-01/04-logs.sql
```

Har command pe `y` confirm karna pad sakta hai.

**Har file SIRF EK BAAR chalao.** Agar `03` galti se dobara chal gaya to
`duplicate column name: doc_sub_type` error aayega — **ye harmless hai**, matlab
column pehle se hai. Kuch corrupt nahi hota (SQLite me `ADD COLUMN IF NOT EXISTS`
nahi hota, isliye ye error aata hai).

### 1c. Verify karo ki migration lag gaya

```bash
# group template ke naye columns aa gaye?
npx wrangler d1 execute chhath-whatsapp-index --remote \
  --command="SELECT name FROM pragma_table_info('group_message_templates') WHERE name IN ('doc_sub_type','file_doc_type')"
# expected: 2 rows

# queue ke naye columns?
npx wrangler d1 execute chhath-whatsapp-index --remote \
  --command="SELECT name FROM pragma_table_info('person_messages') WHERE name IN ('attempts','claimed_at','sent_at')"
# expected: 3 rows

# duplicate PDF rows rok diye?
npx wrangler d1 execute chhath-file-index --remote \
  --command="SELECT name FROM sqlite_master WHERE type='index' AND name='uq_generated_files_doc_year_record'"
# expected: 1 row

# reported flag normalize ho gaya? ('True'/'False' nahi bachna chahiye)
npx wrangler d1 execute chhath-logs --remote \
  --command="SELECT DISTINCT reported FROM error_log"
# expected: sirf '0' aur '1'

# phone numbers normalize? (bare 10-digit nahi bachne chahiye)
npx wrangler d1 execute chhath-whatsapp-index --remote \
  --command="SELECT COUNT(*) AS bare_10_digit FROM person_messages WHERE LENGTH(CAST(mobileno AS TEXT))=10"
# expected: 0
```

---

## Step 2 — `CONSENT_BASE_URL` set karo (ZAROORI)

Abhi `wrangler.toml` me placeholder hai: `https://YOUR-FRONTEND-DOMAIN.example.com`

Naya code jaanbujhkar **send karne se mana kar dega** agar ye placeholder ho —
pehle ye chupchap dead link (`/consent/<token>`) bhej deta tha jo `sent` mark ho
jata tha. To ise theek karna hi padega.

`mgmt/backend/wrangler.toml` kholo aur apna asli frontend domain daalo:

```toml
[vars]
CONSENT_BASE_URL = "https://apna-asli-domain.vercel.app"
```

> ⚠️ **End me `/` na lagayein** aur ye wahi domain hona chahiye jahan `mgmt/frontend`
> deploy hai (kyunki consent link `<domain>/consent/<token>` banta hai).

Commit kar dein taaki agli baar bhi rahe:

```bash
cd ~/chhath-full-codebase
git add mgmt/backend/wrangler.toml
git commit -m "Set real CONSENT_BASE_URL for production"
git push
```

---

## Step 3 — Secrets check karo

Jo secrets code padhta hai (`wrangler.toml` me comment se update kiya gaya hai —
purane `DRIVE_SA_*` naam **galat** the, code unhe kabhi padhta hi nahi tha):

```bash
cd ~/chhath-full-codebase/mgmt/backend
npx wrangler secret list
```

Ye 7 hone chahiye:

| Secret | Kaam |
|---|---|
| `PASSWORD_SALT` | login password hashing |
| `WHATSAPP_QUEUE_API_KEY` | external WhatsApp sender script ka auth |
| `DRIVE_OAUTH_CLIENT_ID` | Drive (docx→PDF conversion) |
| `DRIVE_OAUTH_CLIENT_SECRET` | " |
| `DRIVE_OAUTH_REFRESH_TOKEN` | " |
| `DRIVE_FOLDER_ID` | popups + consent photo/signature upload |
| `DRIVE_ROOT_FOLDER_ID` | "DOCX Templates" + "Generated PDFs" ka parent folder |

Koi missing ho to:

```bash
npx wrangler secret put DRIVE_OAUTH_CLIENT_ID
# phir value paste karein
```

---

## Step 4 — mgmt backend deploy

```bash
cd ~/chhath-full-codebase/mgmt/backend
npm install

# pehle dry-run — bundle check karta hai, deploy nahi karta
npx wrangler deploy --dry-run

# ab asli deploy
npx wrangler deploy
```

Deploy ke baad turant health check:

```bash
curl -s https://chhath-mgmt-api.<aapka-subdomain>.workers.dev/ | head
# expected: {"status":"ok","message":"Chhath Puja Management API is live (Cloudflare Worker)"}
```

---

## Step 5 — Public backend deploy

> Ye step **zaroori** hai — Public worker ko naya `DB_LOGS` binding mila hai.
> Iske bina public portal ke errors abhi bhi invisible rahenge.

```bash
cd ~/chhath-full-codebase/Public/backend
npm install
npx wrangler deploy --dry-run
npx wrangler deploy
```

Check:

```bash
curl -s "https://chhath-public-api.shaharpura.workers.dev/?action=portalData" | head -c 300
echo
# aur naya error-log endpoint (public frontend isse use karta hai)
curl -s -X POST "https://chhath-public-api.shaharpura.workers.dev/?action=logError" \
  -d '{"page":"/deploy-test","message":"deploy verification test"}'
# expected: {"success":true,"errorId":"ERR..."}
```

Phir mgmt portal ke **Error Log** tab me `public-frontend` source wala row dikhna chahiye.

---

## Step 6 — mgmt frontend deploy

`VITE_API_URL` **build time** pe bake hota hai, isliye ye set hona zaroori hai.

### Vercel se (recommended — `vercel.json` already hai)

```bash
cd ~/chhath-full-codebase/mgmt/frontend
npm install

# ek baar env var check/set karein (Vercel dashboard -> Settings -> Environment Variables)
# VITE_API_URL = https://chhath-mgmt-api.<aapka-subdomain>.workers.dev

npx vercel --prod
```

### Ya locally build karke

```bash
cd ~/chhath-full-codebase/mgmt/frontend
npm install
VITE_API_URL="https://chhath-mgmt-api.<aapka-subdomain>.workers.dev" npm run build
# output: dist/  -> ise apne host pe upload karein
```

Build verified hai — 3.4s me pass hota hai. Do warning aayengi (`api.js` /
`qrCode.js` dynamically + statically imported) — **ye harmless hain**, pehle se
thi, sirf chunking ke baare me hain.

---

## Step 7 — Public frontend deploy

`Public/frontend` me koi build step nahi hai (plain HTML/JS). Bas files upload
kar dein jahan abhi host hai.

⚠️ `Public/frontend/script.js` me Worker URL **hardcoded** hai (line ~60):

```js
const BASE_API_URL = "https://chhath-public-api.shaharpura.workers.dev/";
```

Agar aapka Public worker URL isse different hai to ise badalna padega.

---

## Step 8 — Deploy ke baad smoke test (10 minute)

Ye 8 cheezein exactly wo bugs hain jo fix hue — inhe test karke confirm ho jayega:

| # | Test | Expected |
|---|---|---|
| 1 | **Admin** (Superadmin nahi) se ek Collection ka Download PDF | PDF milna chahiye. Pehle "Sirf Superadmin ye action kar sakta hai" aata tha |
| 2 | WhatsApp → Templates → **Group** template add karein | Save hona chahiye. Pehle `D1_ERROR` aata tha |
| 3 | Naya Collection save karein | Button me "PDF generate kar rahe hain..." → "WhatsApp message queue kar rahe hain..." dikhega. Koi problem ho to peela warning banner |
| 4 | **Guarantor** consent page se PDF download | Download Center me bhi wahi PDF dikhna chahiye (pehle kabhi nahi dikhta tha) |
| 5 | Document Templates → **Material** → Download Sample .docx | File download honi chahiye (pehle 404) |
| 6 | Document Templates → **Report — Hindi** sample | Andar `{NAME_HI}` type ke tokens hone chahiye, `{NAME}` nahi |
| 7 | Bulk Generate PDFs → consent type | PDF me festival dates + counts bharne chahiye (pehle blank) |
| 8 | **Error Log** tab | Rows pe "Stack / context dekhein" toggle + search/filter dikhna chahiye |

Aur ye check karein ki logging zinda hai:

```bash
npx wrangler d1 execute chhath-logs --remote \
  --command="SELECT source, COUNT(*) c FROM error_log GROUP BY source ORDER BY c DESC"
```

Ab `whatsapp-queue`, `backend`, `auth`, `public-frontend` jaise naye sources dikhne
chahiye. Pehle ye **kabhi** nahi aa sakte the.

Live errors dekhne ke liye:

```bash
cd ~/chhath-full-codebase/mgmt/backend && npx wrangler tail
```

---

## Rollback (agar kuch tut jaye)

**Code rollback** — DB safe rehta hai (naye columns extra hain, purana code unhe
ignore karta hai):

```bash
cd ~/chhath-full-codebase
git revert -m 1 425d39d
git push
# phir Step 4/5/6 dobara
```

**Migration rollback ki zaroorat nahi.** Naye columns aur indexes purane code ke
saath compatible hain. Sirf ek cheez: `UNIQUE` index duplicate insert reject
karega — par purana code bhi duplicate nahi banana chahta tha (wo ek bug tha).

---

## Ek baat WhatsApp sender script ke baare me

Aapki bahar wali `manager.js` script me **koi change zaroori nahi** — saare field
names same hain.

Bas ek behaviour change: `getPendingMessages` ab jo rows deta hai unhe `'sending'`
mark kar deta hai (duplicate send rokne ke liye). Agar script send ke baad
`updateMessageStatus` call karti hai (jo karti hai), to sab normal chalega.

Agar script kabhi crash ho jaye to atki hui rows **10 minute baad automatically**
wapas queue me aa jayengi. Aur 5 attempts ke baad row `failed` ho jayegi + Error
Log me aa jayegi — pehle ye hamesha ke liye `pending` me atki rehti thi.

Naya monitoring: mgmt portal ke **WhatsApp** tab me lal banner aayega agar koi
message 30 minute se atka ho.
