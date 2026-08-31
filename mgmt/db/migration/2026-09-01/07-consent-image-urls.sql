-- ============================================================================
-- Drive image URL fix — DB: chhath-loans-expenses
--
--   wrangler d1 execute chhath-loans-expenses --remote --file=./migration/2026-09-01/07-consent-image-urls.sql
--
-- Idempotent. Kuch delete nahi hota.
--
-- Wahi CORP bug jo popup images me tha (poora kaaran 06-popup-image-urls.sql me
-- likha hai), par consent ke photo aur signature pe. `uploadFileToDrive` ka
-- `directUrl` `uc?export=view&id=` deta tha, aur loans.js usko seedha
-- loan_consents.photo_url / signature_url me likhta tha.
--
-- Asar: ConsentReview screen pe Superadmin ko guarantor/loaner ki photo aur
-- signature KABHI dikhi hi nahi — jabki verify/reject ka faisla usi par hona hai.
-- Browser CORP: same-site ki wajah se image block kar deta tha; naya tab me link
-- kholne par dikh jati thi (wahan CORP lagu nahi hota), isliye ye bug chhupa raha.
-- ============================================================================

-- ---- photo_url ----
UPDATE loan_consents
   SET photo_url = 'https://lh3.googleusercontent.com/d/' ||
                   substr(photo_url, instr(photo_url, 'id=') + 3) || '=w1600'
 WHERE photo_url LIKE 'https://drive.google.com/uc?export=view&id=%'
   AND instr(photo_url, 'id=') > 0;

UPDATE loan_consents
   SET photo_url = 'https://lh3.googleusercontent.com/d/' ||
                   REPLACE(REPLACE(photo_url, 'https://drive.google.com/file/d/', ''), '/view', '') ||
                   '=w1600'
 WHERE photo_url LIKE 'https://drive.google.com/file/d/%/view';

-- ---- signature_url ----
UPDATE loan_consents
   SET signature_url = 'https://lh3.googleusercontent.com/d/' ||
                       substr(signature_url, instr(signature_url, 'id=') + 3) || '=w1600'
 WHERE signature_url LIKE 'https://drive.google.com/uc?export=view&id=%'
   AND instr(signature_url, 'id=') > 0;

UPDATE loan_consents
   SET signature_url = 'https://lh3.googleusercontent.com/d/' ||
                       REPLACE(REPLACE(signature_url, 'https://drive.google.com/file/d/', ''), '/view', '') ||
                       '=w1600'
 WHERE signature_url LIKE 'https://drive.google.com/file/d/%/view';
