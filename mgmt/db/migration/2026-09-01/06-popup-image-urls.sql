-- ============================================================================
-- Drive image URL fix — DB: chhath-misc
--
--   wrangler d1 execute chhath-misc --remote --file=./migration/2026-09-01/06-popup-image-urls.sql
--
-- Idempotent. Kuch delete nahi hota.
--
-- KYUN: `https://drive.google.com/uc?export=view&id=<ID>` ek 303 redirect hai
-- `https://drive.usercontent.google.com/download?...` pe, aur us final response me
-- `cross-origin-resource-policy: same-site` hota hai. Iska matlab browser us image
-- ko KISI DOOSRI SITE se embed hone par BLOCK kar deta hai — to `<img src>` chupchap
-- fail hota tha aur popup image kabhi dikhti hi nahi thi.
--
-- curl se ye pakadna namumkin tha: curl CORP enforce nahi karta (200 + image/jpeg
-- deta hai), sirf browser karta hai.
--
-- `lh3.googleusercontent.com/d/<ID>` Google ka image CDN hai — `ACAO: *`, koi CORP
-- header nahi. Verify kiya asli file pe: `=w1600` suffix ke saath original
-- 1080x2273 poora aata hai.
--
-- Migration 05 ne `/file/d/<ID>/view` ko `uc?export=view&id=<ID>` banaya tha —
-- woh sahi disha me tha (viewer page se direct image), par manzil galat thi.
-- Ye file usko theek karti hai.
-- ============================================================================

-- 1) `uc?export=view&id=<ID>`  ->  `lh3.googleusercontent.com/d/<ID>=w1600`
--    ID hamesha 'id=' ke baad aakhir tak hoti hai.
UPDATE popup_slides
   SET image_url = 'https://lh3.googleusercontent.com/d/' ||
                   substr(image_url, instr(image_url, 'id=') + 3) || '=w1600'
 WHERE image_url LIKE 'https://drive.google.com/uc?export=view&id=%'
   AND instr(image_url, 'id=') > 0;

-- 2) Agar koi row abhi bhi viewer-page form me hai (05 se pehle ka koi bacha hua)
UPDATE popup_slides
   SET image_url = 'https://lh3.googleusercontent.com/d/' ||
                   REPLACE(REPLACE(image_url, 'https://drive.google.com/file/d/', ''), '/view', '') ||
                   '=w1600'
 WHERE image_url LIKE 'https://drive.google.com/file/d/%/view';

-- 3) `drive.usercontent.google.com/download?id=<ID>&export=view` form
--    (yahan ID ke baad '&' aata hai, to usse pehle tak kaatna hai)
UPDATE popup_slides
   SET image_url = 'https://lh3.googleusercontent.com/d/' ||
                   substr(
                     substr(image_url, instr(image_url, 'id=') + 3),
                     1,
                     CASE
                       WHEN instr(substr(image_url, instr(image_url, 'id=') + 3), '&') > 0
                       THEN instr(substr(image_url, instr(image_url, 'id=') + 3), '&') - 1
                       ELSE length(substr(image_url, instr(image_url, 'id=') + 3))
                     END
                   ) || '=w1600'
 WHERE image_url LIKE 'https://drive.usercontent.google.com/download?%id=%';
