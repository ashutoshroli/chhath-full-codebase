-- ============================================================================
-- RESET PORTAL DATA — SECTION 7 of 8
-- database: chhath-misc            (binding DB_MISC)
--
--   npx wrangler d1 execute chhath-misc --remote --file mgmt/db/cleanup/2026-09-14-reset-portal-data/07-misc.sql
--
-- EMPTIES: announcement_links, custom_announcements, collection_jobs, render_jobs
--
-- popups and popup_slides are NOT touched here. They may hold real announcements
-- rather than test data, so they live in the separate, optional
-- 07b-misc-popups.sql -- run that one only if you want the popups gone too.
-- ============================================================================

-- Announcement PIN links and their announcement rows.
DELETE FROM announcement_links;
DELETE FROM sqlite_sequence WHERE name = 'announcement_links';

DELETE FROM custom_announcements;
DELETE FROM sqlite_sequence WHERE name = 'custom_announcements';

-- Background job queues. Any row still 'pending' here is work the cron would
-- otherwise pick up and act on against data that no longer exists, so clearing
-- them is part of the reset, not just tidying.
DELETE FROM collection_jobs;
DELETE FROM sqlite_sequence WHERE name = 'collection_jobs';

DELETE FROM render_jobs;
DELETE FROM sqlite_sequence WHERE name = 'render_jobs';

-- ---------------------------------------------------------------- VERIFY
-- Expected: the four *_rows 0. The popup counts are informational -- they show
-- what 07b would remove if you choose to run it.
SELECT
  (SELECT COUNT(*) FROM announcement_links)     AS announcement_links_rows,
  (SELECT COUNT(*) FROM custom_announcements)   AS custom_announcements_rows,
  (SELECT COUNT(*) FROM collection_jobs)        AS collection_jobs_rows,
  (SELECT COUNT(*) FROM render_jobs)            AS render_jobs_rows,
  (SELECT COUNT(*) FROM popups)                 AS popups_still_there,
  (SELECT COUNT(*) FROM popup_slides)           AS popup_slides_still_there;
