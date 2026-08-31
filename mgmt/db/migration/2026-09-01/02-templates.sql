-- ============================================================================
-- Audit fix migration — 2026-09-01  ·  DB: chhath-templates
--
-- RUN THIS FILE AGAINST **chhath-templates** ONLY:
--   wrangler d1 execute chhath-templates --remote --file=./migration/2026-09-01/02-templates.sql
--
-- Test it locally first (safe, hits the local replica, not production):
--   wrangler d1 execute chhath-templates --local --file=./migration/2026-09-01/02-templates.sql
--
-- Every statement is IDEMPOTENT (IF NOT EXISTS / guarded), so re-running is safe.
-- Nothing here drops a table or deletes live records (the only DELETEs remove
-- duplicate rows and error_log entries older than 180 days).
--
-- This file was split out of 2026-09-01-audit-fixes.sql, which contains all four
-- DB blocks in one file — convenient to read, but you CANNOT pipe that combined
-- file into a single database.
-- ============================================================================

-- docx_templates upload/copy used SELECT-then-INSERT with no constraint, so two
-- concurrent uploads could create two rows for the same (doc_type, year) and
-- getDocxTemplate()'s .first() would then pick one arbitrarily.
DELETE FROM docx_templates
WHERE id NOT IN (SELECT MAX(id) FROM docx_templates GROUP BY doc_type, year);

CREATE UNIQUE INDEX IF NOT EXISTS uq_docx_templates_type_year
  ON docx_templates (doc_type, year);
