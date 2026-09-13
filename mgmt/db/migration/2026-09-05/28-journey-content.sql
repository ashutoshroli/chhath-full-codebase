-- ============================================================================
-- journey_entries table + journey tagline — 2026-09-13  ·  DB: chhath-core
--
-- RUN THIS FILE AGAINST **chhath-core** ONLY:
--   wrangler d1 execute chhath-core --remote --file=./migration/2026-09-05/28-journey-content.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-core --local --file=./migration/2026-09-05/28-journey-content.sql
--
-- Makes the public "Our Journey / 10 Years of Chhath" year-by-year story
-- DB-driven instead of hardcoded in the frontend. Each row is one year card:
--   year, title_en/title_hi (e.g. "2017 — A New Beginning"), content_en/content_hi
--   (the story paragraph), and position (display order, ascending).
--
-- The tagline ("A decade of faith, unity and service") is NOT a row here — it is
-- stored in the existing key/value portal_settings table under
-- journey_tagline_en / journey_tagline_hi (seeded at the bottom).
--
-- The INSERTs below carry the EXACT text that was previously hardcoded in the
-- frontend (en + hi), so the live page looks identical and future edits happen in
-- the DB (mgmt "Journey Content" tab) — never in code again.
--
-- Fully idempotent: CREATE TABLE/INDEX IF NOT EXISTS, and every seed INSERT is
-- guarded by WHERE NOT EXISTS so a second run adds nothing. Nothing is dropped or
-- modified. schema/core.sql defines the same table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS journey_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,
  title_en TEXT,
  title_hi TEXT,
  content_en TEXT,
  content_hi TEXT,
  position INTEGER
);
CREATE INDEX IF NOT EXISTS idx_journey_entries_position ON journey_entries(position);

-- ---- Seed: the 2017-2026 story, exactly as it was hardcoded (en + hi) ----
-- Guarded by NOT EXISTS on `year` so re-running never duplicates a year.

INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position)
SELECT 2017, '2017 — A New Beginning', '2017 — एक नई शुरुआत',
  'In 2017 the youth came together to carry the local Chhath Puja forward with new energy, better arrangements and an organised effort. This was the year the present organised journey of Navyuvak began to take a new shape. That same year, Genius Public School allowed its entire sound system to be used at the Chhath ghat, an important support for the event.',
  '2017 में युवाओं ने मिलकर छठ पूजा के स्थानीय आयोजन को नए उत्साह, बेहतर व्यवस्था और संगठित प्रयास के साथ आगे बढ़ाना शुरू किया। यही वह वर्ष था जहाँ से Navyuvak की वर्तमान संगठित यात्रा ने एक नया रूप लेना शुरू किया। इसी वर्ष Genius Public School ने अपना पूरा sound system छठ घाट पर उपयोग करने की अनुमति दी, जिससे आयोजन को महत्वपूर्ण सहयोग मिला।',
  1
WHERE NOT EXISTS (SELECT 1 FROM journey_entries WHERE year = 2017);

INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position)
SELECT 2018, '2018 — Toward Self-Reliance', '2018 — आत्मनिर्भरता की ओर',
  'In 2018 the event moved gradually toward a more organised and self-reliant arrangement. The committee now had funds and the necessary resources, and many arrangements began to be managed on its own — relying on available community support rather than on outside help alone.',
  '2018 में आयोजन धीरे-धीरे अधिक संगठित और स्वावलंबी व्यवस्था की ओर बढ़ा। अब समिति के पास funds और आवश्यक resources उपलब्ध होने लगे और आयोजन से जुड़ी कई व्यवस्थाएँ अपने स्तर पर संभाली जाने लगीं — किसी बाहरी सहयोग पर निर्भर रहने के बजाय उपलब्ध community support के आधार पर।',
  2
WHERE NOT EXISTS (SELECT 1 FROM journey_entries WHERE year = 2018);

INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position)
SELECT 2019, '2019 — Growing Support', '2019 — बढ़ता सहयोग',
  'By 2019 the support from the community grew further. With collective effort, available resources and community participation, Navyuvak’s identity and the event’s organisation steadily strengthened.',
  '2019 तक community से मिलने वाला सहयोग और अधिक बढ़ने लगा। सामूहिक प्रयास, उपलब्ध resources और community participation के साथ Navyuvak की पहचान तथा आयोजन की व्यवस्था धीरे-धीरे मजबूत होती गई।',
  3
WHERE NOT EXISTS (SELECT 1 FROM journey_entries WHERE year = 2019);

INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position)
SELECT 2020, '2020 — A Journey of Continuity', '2020 — निरंतरता की यात्रा',
  'In 2020 the Chhath Puja event and community participation continued. Even amid changing circumstances, the tradition and the collective effort moved forward — the year’s defining mark was that continuity was maintained despite the changes.',
  '2020 में भी छठ पूजा का आयोजन और community participation जारी रहा। बदलती परिस्थितियों के बीच भी आयोजन की परंपरा तथा सामूहिक प्रयास आगे बढ़ते रहे — इस वर्ष की विशेष पहचान यही रही कि परिस्थितियाँ बदलने के बावजूद निरंतरता बनी रही।',
  4
WHERE NOT EXISTS (SELECT 1 FROM journey_entries WHERE year = 2020);

INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position)
SELECT 2021, '2021 — Transparency Goes Digital', '2021 — Transparency का Digital रूप',
  '2021 was an important milestone in Navyuvak’s transparency journey. One point must be made clearly: transparency did not begin in 2021 — in 2021 the medium of transparency became digital. Earlier the accounts were prepared on paper, turned into PDFs, and shared in the WhatsApp group. In 2021 the records from 2017 to 2021 were organised into Google Sheets and made public via a view-only URL. The medium changed, but the purpose did not.',
  '2021 Navyuvak की transparency journey में एक महत्वपूर्ण milestone बना। Transparency 2021 में शुरू नहीं हुई थी — 2021 में Transparency का माध्यम Digital हुआ। पहले आय-व्यय का हिसाब paper पर तैयार होता, फिर PDF बनाकर WhatsApp Group में साझा किया जाता था। 2021 में 2017 से 2021 तक के records को Google Sheets में व्यवस्थित किया गया और View-Only URL के माध्यम से public किया गया। माध्यम बदला, लेकिन उद्देश्य नहीं बदला।',
  5
WHERE NOT EXISTS (SELECT 1 FROM journey_entries WHERE year = 2021);

INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position)
SELECT 2022, '2022 — Digital Transparency Continues', '2022 — Digital Transparency जारी',
  'In 2022 the digital arrangement of keeping financial records in Google Sheets and sharing them with the community continued. Technology moved ahead, but the core idea of transparency stayed the same — keep records organised and share them with the community.',
  '2022 में Google Sheets के माध्यम से financial records को व्यवस्थित रखने और community के साथ share करने की digital transparency व्यवस्था जारी रही। तकनीक आगे बढ़ रही थी, लेकिन transparency की मूल सोच वही रही — records को व्यवस्थित रखना और community के साथ साझा करना।',
  6
WHERE NOT EXISTS (SELECT 1 FROM journey_entries WHERE year = 2022);

INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position)
SELECT 2023, '2023 — More Participation, Continued Transparency', '2023 — बढ़ती सहभागिता, जारी पारदर्शिता',
  'In 2023 community participation and digital record-sharing continued. The practice of maintaining financial records in an organised way and sharing them with the community carried on — showing that transparency was not a one-year campaign but an ongoing system.',
  '2023 में community participation और digital record-sharing की प्रक्रिया आगे भी जारी रही। Financial records को व्यवस्थित रूप में maintain करने और community के साथ share करने की परंपरा बनी रही — transparency किसी एक वर्ष का अभियान नहीं, बल्कि लगातार चलने वाली व्यवस्था बन चुकी थी।',
  7
WHERE NOT EXISTS (SELECT 1 FROM journey_entries WHERE year = 2023);

INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position)
SELECT 2024, '2024 — A New Rise in Participation', '2024 — सहभागिता में नई वृद्धि',
  'In 2024 there was a notable rise in community support. The journey kept moving forward and the digital record arrangement for transparency continued. This year, participation and contribution both took Navyuvak’s growing reach and collective support to a new level.',
  '2024 में community से मिलने वाले सहयोग में उल्लेखनीय वृद्धि हुई। आयोजन की यात्रा लगातार आगे बढ़ती रही और transparency के लिए digital records की व्यवस्था भी जारी रही। इस वर्ष community participation और contribution — दोनों ने Navyuvak की growing reach को एक नया स्तर दिया।',
  8
WHERE NOT EXISTS (SELECT 1 FROM journey_entries WHERE year = 2024);

INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position)
SELECT 2025, '2025 — Toward a Decade', '2025 — एक दशक की ओर',
  'By 2025 both community participation and contribution showed a notable rise. The youth-led organised journey that began in 2017 was now moving toward its tenth year — an important milestone on the way to 2026.',
  '2025 तक आते-आते community participation और contribution दोनों में उल्लेखनीय वृद्धि दिखाई दी। 2017 में शुरू हुई youth-led organized journey अब अपने दसवें वर्ष की ओर बढ़ रही थी — 2026 तक पहुँचने के लिए एक महत्वपूर्ण पड़ाव।',
  9
WHERE NOT EXISTS (SELECT 1 FROM journey_entries WHERE year = 2025);

INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position)
SELECT 2026, '2026 — The Tenth Year', '2026 — दसवाँ वर्ष',
  'The present organised journey of Navyuvak that began in 2017 has now entered its tenth year in 2026. Much has changed over these years — the form of the event, community participation, financial contribution, and the way records are maintained and shared. Yet through all these changes one thing has stayed constant: trust, participation and transparency.',
  '2017 में शुरू हुई Navyuvak की वर्तमान संगठित यात्रा अब 2026 में अपने दसवें वर्ष में प्रवेश कर चुकी है। इन वर्षों में आयोजन का स्वरूप बदला, community participation बढ़ी, financial contribution में बदलाव आया, records maintain करने का तरीका बदला। लेकिन इन सभी बदलावों के बीच एक चीज लगातार बनी रही: विश्वास, सहभागिता और पारदर्शिता।',
  10
WHERE NOT EXISTS (SELECT 1 FROM journey_entries WHERE year = 2026);

-- ---- Seed: the journey tagline into the existing portal_settings key/value ----

INSERT INTO portal_settings ("key", value)
SELECT 'journey_tagline_en', 'A decade of faith, unity and service'
WHERE NOT EXISTS (SELECT 1 FROM portal_settings WHERE "key" = 'journey_tagline_en');

INSERT INTO portal_settings ("key", value)
SELECT 'journey_tagline_hi', 'आस्था, एकता और सेवा का एक दशक'
WHERE NOT EXISTS (SELECT 1 FROM portal_settings WHERE "key" = 'journey_tagline_hi');
