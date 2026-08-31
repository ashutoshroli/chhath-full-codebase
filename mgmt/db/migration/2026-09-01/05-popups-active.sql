-- ============================================================================
-- Popup fix migration — DB: chhath-misc
--
-- RUN THIS FILE AGAINST **chhath-misc** ONLY:
--   wrangler d1 execute chhath-misc --remote --file=./migration/2026-09-01/05-popups-active.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-misc --local --file=./migration/2026-09-01/05-popups-active.sql
--
-- Every statement is idempotent. Nothing is dropped and no popup is deleted.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) `popups.active` normalization
--
-- The column is TEXT. The sheet migration wrote the string 'True', while the
-- portal wrote a bound number 1 (stored as '1' by TEXT affinity). Both
-- getActivePopups (mgmt) and getActivePublicPopups (public) queried
--     WHERE active = 1
-- and SQLite applies TEXT affinity to that literal, so it matched '1' but NEVER
-- 'True'. Meanwhile the admin list rendered its badge with a permissive
-- isTruthyFlag() that DOES accept 'True' — so a popup could show "Active" in the
-- portal and still never be served to a single visitor.
--
-- The code no longer compares in SQL (it filters in JS with one shared
-- predicate), but the stored data is normalized here so the column is
-- unambiguous from now on.
-- ---------------------------------------------------------------------------
UPDATE popups SET active = '1'
 WHERE LOWER(TRIM(CAST(active AS TEXT))) IN ('true', 'yes', '1');

UPDATE popups SET active = '0'
 WHERE active IS NULL
    OR LOWER(TRIM(CAST(active AS TEXT))) IN ('false', 'no', '0', '');


-- ---------------------------------------------------------------------------
-- 2) Slide NULLs -> ''
--
-- image_url / text / link_url / link_text are all nullable and the migrated row
-- has three of them NULL. PopupManagement copied them straight into its form
-- state, and save()'s `s.text.trim()` then threw a TypeError from OUTSIDE its
-- try/catch — so pressing Save did nothing at all, with no error shown anywhere.
-- The backend coalesces on read now; this cleans the stored data too.
-- ---------------------------------------------------------------------------
UPDATE popup_slides SET text      = '' WHERE text      IS NULL;
UPDATE popup_slides SET link_url  = '' WHERE link_url  IS NULL;
UPDATE popup_slides SET link_text = '' WHERE link_text IS NULL;
UPDATE popup_slides SET image_url = '' WHERE image_url IS NULL;


-- ---------------------------------------------------------------------------
-- 3) Repair popup image URLs that point at the Drive VIEWER PAGE
--
-- uploadPopupImage returns two URLs and PopupManagement stored the wrong one:
--   url       = https://drive.google.com/file/d/<id>/view    <- an HTML page
--   directUrl = https://drive.google.com/uc?export=view&id=<id>  <- the image
-- An <img src> pointing at the /view page renders nothing, so every popup image
-- uploaded through the UI was broken in the editor, at login and on the public
-- portal. Rewrite the stored form.
-- ---------------------------------------------------------------------------
UPDATE popup_slides
   SET image_url = 'https://drive.google.com/uc?export=view&id=' ||
                   REPLACE(REPLACE(image_url, 'https://drive.google.com/file/d/', ''), '/view', '')
 WHERE image_url LIKE 'https://drive.google.com/file/d/%/view';


-- NOTE on `slide_order`: it is a REAL column holding 1.0 / 2.0. There is
-- deliberately no UPDATE for it here. `CAST(slide_order AS INTEGER)` would be a
-- no-op, because SQLite re-applies the column's REAL affinity to the result and
-- stores 1.0 again (verified in sqlite3). Making it a true INTEGER would require
-- rebuilding the table, and there is no reason to: both readers already coerce
-- with `parseInt(r.slide_order) || 0` (mgmt/backend/src/popups.js:43,
-- Public/backend/src/index.js:120), so the REAL value never reaches the UI.


-- ---------------------------------------------------------------------------
-- 4) Legacy start_at / end_at had no timezone ('2026-08-22 14:31:00'), which
--    Safari cannot parse at all and which V8 reads as local time (= UTC in a
--    Worker). The app now writes full ISO-8601 with an offset. Convert the old
--    space-separated form to explicit UTC so both readers agree.
--
--    NOTE: these legacy values were ALREADY being compared as UTC by the Worker,
--    so treating them as UTC here preserves the existing behaviour exactly
--    rather than silently shifting anyone's popup window.
-- ---------------------------------------------------------------------------
UPDATE popups
   SET start_at = REPLACE(start_at, ' ', 'T') || 'Z'
 WHERE start_at LIKE '____-__-__ __:__:__';

UPDATE popups
   SET end_at = REPLACE(end_at, ' ', 'T') || 'Z'
 WHERE end_at LIKE '____-__-__ __:__:__';


-- ---------------------------------------------------------------------------
-- 5) Helpful indexes for the role/window filtering the code now does in JS.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_popups_start_at ON popups (start_at);
CREATE INDEX IF NOT EXISTS idx_popups_end_at   ON popups (end_at);
