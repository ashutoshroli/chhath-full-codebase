-- ============================================================================
-- RESET PORTAL DATA — SECTION 2 of 8
-- database: chhath-collections     (binding DB_COLLECTIONS)
--
--   npx wrangler d1 execute chhath-collections --remote --file mgmt/db/cleanup/2026-09-14-reset-portal-data/02-collections.sql
--
-- EMPTIES: collections
--
-- sl_no needs no reset: it is allocated per year as MAX(sl_no)+1 WHERE year = ?,
-- so an empty table restarts every year's receipt numbering at 1.
-- ============================================================================

DELETE FROM collections;
DELETE FROM sqlite_sequence WHERE name = 'collections';

-- ---------------------------------------------------------------- VERIFY
-- Expected: 0
SELECT COUNT(*) AS collections_rows FROM collections;
