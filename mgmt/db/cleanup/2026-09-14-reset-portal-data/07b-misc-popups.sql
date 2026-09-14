-- ============================================================================
-- RESET PORTAL DATA — SECTION 7b (OPTIONAL)
-- database: chhath-misc            (binding DB_MISC)
--
--   npx wrangler d1 execute chhath-misc --remote --file mgmt/db/cleanup/2026-09-14-reset-portal-data/07b-misc-popups.sql
--
-- Clears the announcement popups shown on the public portal and at mgmt login.
--
-- This is SEPARATE and OPTIONAL because popups are content, not obviously test
-- data -- a real announcement the committee wrote looks exactly like a test one
-- in the database. Run 07-misc.sql first; its VERIFY block prints how many popup
-- and slide rows exist so you can decide.
--
-- ⚠️ RUN THE FILE-URL EXPORT IN RUNBOOK.md STEP 3 FIRST if you want the popup
-- images removed from R2 too. popup_slides.image_url is the only pointer to them.
-- ============================================================================

DELETE FROM popup_slides;
DELETE FROM sqlite_sequence WHERE name = 'popup_slides';

DELETE FROM popups;
DELETE FROM sqlite_sequence WHERE name = 'popups';

-- ---------------------------------------------------------------- VERIFY
-- Expected: both 0
SELECT
  (SELECT COUNT(*) FROM popups)       AS popups_rows,
  (SELECT COUNT(*) FROM popup_slides) AS popup_slides_rows;
