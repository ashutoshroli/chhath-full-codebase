-- ============================================================================
-- Audit fix migration — 2026-09-01  ·  DB: chhath-file-index
--
-- RUN THIS FILE AGAINST **chhath-file-index** ONLY:
--   wrangler d1 execute chhath-file-index --remote --file=./migration/2026-09-01/01-file_index.sql
--
-- Test it locally first (safe, hits the local replica, not production):
--   wrangler d1 execute chhath-file-index --local --file=./migration/2026-09-01/01-file_index.sql
--
-- Every statement is IDEMPOTENT (IF NOT EXISTS / guarded), so re-running is safe.
-- Nothing here drops a table or deletes live records (the only DELETEs remove
-- duplicate rows and error_log entries older than 180 days).
--
-- This file was split out of 2026-09-01-audit-fixes.sql, which contains all four
-- DB blocks in one file — convenient to read, but you CANNOT pipe that combined
-- file into a single database.
-- ============================================================================

-- B4: generated_files had NO unique constraint, so the read-then-write guard in
-- convertDocxToPdf() was a pure race — two concurrent requests both converted
-- and both inserted. A partial UNIQUE INDEX gives the DB the last word and lets
-- the code use INSERT ... ON CONFLICT.
-- Clean up any duplicates that already accumulated (keep the newest row).
DELETE FROM generated_files
WHERE id NOT IN (
  SELECT MAX(id) FROM generated_files GROUP BY doc_type, year, record_id
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_generated_files_doc_year_record
  ON generated_files (doc_type, year, record_id);
