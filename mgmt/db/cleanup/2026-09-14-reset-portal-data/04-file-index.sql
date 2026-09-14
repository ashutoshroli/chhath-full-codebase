-- ============================================================================
-- RESET PORTAL DATA — SECTION 4 of 8
-- database: chhath-file-index      (binding DB_FILE_INDEX)
--
--   npx wrangler d1 execute chhath-file-index --remote --file mgmt/db/cleanup/2026-09-14-reset-portal-data/04-file-index.sql
--
-- ⚠️ RUN THE FILE-URL EXPORT IN RUNBOOK.md STEP 3 FIRST.
-- generated_files is the ONLY index of every receipt / certificate / samaan PDF
-- ever produced. public_link and drive_path are the only pointers to those files
-- in R2 and Google Drive. Delete these rows without exporting first and the PDFs
-- stay on storage forever with nothing left to locate them by.
--
-- EMPTIES: generated_files
-- ============================================================================

DELETE FROM generated_files;
DELETE FROM sqlite_sequence WHERE name = 'generated_files';

-- ---------------------------------------------------------------- VERIFY
-- Expected: 0
SELECT COUNT(*) AS generated_files_rows FROM generated_files;
