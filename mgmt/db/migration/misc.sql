-- Data migration for D1 database: misc
-- Run with: wrangler d1 execute misc --remote --file=./migration/misc.sql

-- 2 rows from sheet "CUSTOM_ANNOUNCEMENTS" -> custom_announcements
INSERT INTO custom_announcements (id_code, year, texthindi, textenglish, priority, announced, announcedcount, createdat, "order") VALUES ('CAmt39ylp5g3ml', 2026.0, NULL, 'Yejo whatsapp ka messeja jata hai or jaha pe template banta hai waha pe is tis cantaint file wala me abhi manual ink dalna padta hai wahaa pe usme tik karne pe o messege jis kaam ke liya hai or uska link kaya hai file ka o auto select ho jaye uspe tk kr ke jis jis template me ho to pahle bato jab build bolu tab build


Samjha — abhi jo WhatsApp template banate ho (`WhatsApp.jsx` mein), wahan "**Is this template have files?**" checkbox tick karne ke baad **manually file link paste karna padta hai** (Google Drive ya kahin ka public URL) — har template ke liye alag-alag, khud se.

Tumhara ask hai: tick karte hi, us template **kis purpose/kaam ke liye hai** (jaise — Receipt, Certificate, Consent-Loaner, Consent-Guarantor, ya jo bhi contribution/doc type ho) — uske hisaab se link **auto-select ho jaye**, manual paste na karna pade. Yani system already jaanta ho ki "Certificate" purpose ka link X hai, "Receipt" purpose ka link Y hai, waise hi baaki templates ke liye.

Iske liye plan kuch aisa banega:
1. Ek chhoti "**File Links**" mapping bananी padegi (purpose → link) — jaise: Receipt, Certificate, Consent-Loaner-sample, Consent-Guarantor-sample, waghera — kahin store hogi (Sheet mein naya tab, ya Settings mein).
2. WhatsApp template banate waqt, jab "hasFile" tick karo, to file link ka text-box hatke ek **dropdown** aa jaye jisme purpose ke hisaab se pehle se defined links list ho — jo template ke `contribution_type` / `doc_sub_type` / `loanType` se match kare wahi auto-select ho jaye, manual bhi override kar sako.

Do cheezein confirm kar do:
1. Ye "purpose → link" mapping tum khud kahin manage karna chahoge (ek naya "File Links" settings tab) — ya already koi jagah hai jaha ye links stored hain jo main use karun?
2. Auto-select match kis field se ho — `contribution_type`+`doc_sub_type` (Person/Group templates ke liye) aur `loanType` (Loan templates ke liye), sahi hai?

Ye confirm kar do, phir jab "build" bologe tab implement kar dunga.


Ek sheet hai jaha pe sara files ka pdf ka link save hota hai to haa us index se chek karna hai fillink ka already bana hua bahi or haa template me o select karne pe jisko messege ja raha hai usko ka file ka ilk ho koi or bhi nahi to pale deko sara kuchh or bat


Dekh liya sab kuchh. Confirm ho gaya — tumhara wahi sheet hai jiska naam **GENERATED_FILES**, jisme har generate hue PDF ka record hota hai: `doc_type, year, record_id, file_name, public_link, drive_path, generated_at`. Ye record har person ke Receipt/Certificate/Samaan/Consent PDF ke liye alag-alag banta hai (record_id = doc_type-year-row).

Ab asli dikkat samajh aayi — **timing ka issue hai**:

- Jab bhi koi Collection save hoti hai, WhatsApp message **turant** auto-queue ho jata hai (`triggerCollectionMessages`) — usi second, template ka static `file_link` use hoke.
- Lekin us person ka Receipt/Certificate PDF (GENERATED_FILES wala) tab tak **bana hi nahi hota** — wo baad mein alag se "Bulk Generate PDFs" / "Download Center" se generate hota hai.
- Matlab jis waqt message queue hota hai, us waqt us specific recipient ka file link GENERATED_FILES mein exist hi nahi karega — abhi ke architecture mein.

To auto-select tabhi kaam karega jab:
1. Ya to PDF generation collection-save ke turant baad automatically ho (abhi manual/bulk hai), **ya**
2. Message sirf tab queue ho jab uska PDF pehle se GENERATED_FILES mein ho (yani agar nahi mila to file-attach skip ho jaye, sirf text jaaye — link nahi), **ya**
3. Message queue hoke "file pending" state mein rahe, aur jab baad mein PDF generate ho tab uska link us pending message mein backfill ho jaye.

Ye teenon mein se kaunsa sahi lagta hai tumhe — recipient ka apna PDF na bane hone par kya ho: file ke bina bhej de, ya us record ke liye message hi tab tak na bheje jab tak file na ban jaaye?

Ye decide kar do, phir "build" bologe to implement karunga.', 'False', 'True', 2.0, '2026-08-21 11:20:27', 12.0);
INSERT INTO custom_announcements (id_code, year, texthindi, textenglish, priority, announced, announcedcount, createdat, "order") VALUES ('CAmt49q911xr50', 2017.0, 'Abcd', NULL, 'True', 'True', 1.0, '2026-08-22 04:01:43', 28.0);

-- 4 rows from sheet "ANNOUNCEMENT_LINKS" -> announcement_links
INSERT INTO announcement_links (token, year, pin, expiresat, active, createdby, createdat) VALUES ('36322da8d16742e787bb55ac30d2b9e9hxnzh6', 2026.0, '1426082cfc00280511355aece1596d8adbb9ac80c72a4e467952f3514447eec1', '2026-08-21T16:57:00.000Z', 'True', 'USER0001', '2026-08-21 03:58:29');
INSERT INTO announcement_links (token, year, pin, expiresat, active, createdby, createdat) VALUES ('20f539e5367a4fe2a183ec9269608748odkj96', 2026.0, '14df4a5f656892b9b2f2d91b5372522ebabfc158f0ddbd5a9eadcd5c7eef15b2', NULL, 'True', 'USER0001', '2026-08-21 04:25:19');
INSERT INTO announcement_links (token, year, pin, expiresat, active, createdby, createdat) VALUES ('9c50d27b3cc64a4289418b861ea424f3m00bnp', 2026.0, '424cb2627a754f4bd824df3291859ecec2f449e124ac5c7d667c1c5128ee5373', NULL, 'True', 'USER0135', '2026-08-22 02:42:14');
INSERT INTO announcement_links (token, year, pin, expiresat, active, createdby, createdat) VALUES ('f5d461e1542d4e84b15218cc01c3cfefispw6o', 2017.0, '0a7c1303f34052e9bebd3e897bf34cec04d3087aca09a2e6d28b31ff1f763345', NULL, 'True', 'USER0136', '2026-08-22 03:58:53');

-- 1 rows from sheet "POPUP_SLIDES" -> popup_slides
INSERT INTO popup_slides (slide_id, popup_id, slide_order, image_url, text, link_url, link_text) VALUES ('SLDmt45h3khj7nq0', 'POPmt45h0xnksrs', 1.0, 'https://drive.google.com/uc?export=view&id=1sDRN417DPz8_gePdOSNLeGDQnJg0Qjb9', NULL, NULL, NULL);

-- 1 rows from sheet "POPUPS" -> popups
INSERT INTO popups (popup_id, title, roles, active, start_at, end_at, created_at, updated_at) VALUES ('POPmt45h0xnksrs', 'dknfn', 'Superadmin,Admin,Subadmin', 'True', '2026-08-22 14:31:00', '2026-08-22 15:31:00', '2026-08-22 02:02:35', '2026-08-22 02:02:35');

