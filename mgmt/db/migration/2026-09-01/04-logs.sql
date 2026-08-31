-- ============================================================================
-- Audit fix migration — 2026-09-01  ·  DB: chhath-logs
--
-- RUN THIS FILE AGAINST **chhath-logs** ONLY:
--   wrangler d1 execute chhath-logs --remote --file=./migration/2026-09-01/04-logs.sql
--
-- Test it locally first (safe, hits the local replica, not production):
--   wrangler d1 execute chhath-logs --local --file=./migration/2026-09-01/04-logs.sql
--
-- Every statement is IDEMPOTENT (IF NOT EXISTS / guarded), so re-running is safe.
-- Nothing here drops a table or deletes live records (the only DELETEs remove
-- duplicate rows and error_log entries older than 180 days).
--
-- This file was split out of 2026-09-01-audit-fixes.sql, which contains all four
-- DB blocks in one file — convenient to read, but you CANNOT pipe that combined
-- file into a single database.
-- ============================================================================

-- E-B13: the sheet migration wrote reported='False'/'True' but the code does
-- `UPDATE ... WHERE reported = 0`, so for all 234 legacy rows meta.changes was
-- always 0 -> reportErrorToWhatsApp() returned alreadyReported and sent NOTHING,
-- while isTruthyFlag('False') was false so the button kept re-appearing.
-- Silent, repeatable no-op. Normalize to '0'/'1'.
UPDATE error_log SET reported = '1' WHERE LOWER(TRIM(CAST(reported AS TEXT))) IN ('true','yes','1');
UPDATE error_log SET reported = '0' WHERE reported IS NULL
   OR LOWER(TRIM(CAST(reported AS TEXT))) IN ('false','no','0','');

-- B3: rows written by the old docxTemplates.js INSERT are missing error_id
-- entirely, which made them un-reportable (report(null) -> "Error record nahi
-- mila.") and gave React duplicate null keys. Backfill a synthetic id.
UPDATE error_log
SET error_id = 'ERRFIX' || CAST(id AS TEXT)
WHERE error_id IS NULL OR TRIM(error_id) = '';

-- E-B19: created_at was written in two formats ('2026-08-11 00:57:19' from the
-- sheet migration vs ISO '2026-08-11T00:57:19.000Z' from logError), and
-- `ORDER BY created_at DESC` is a lexicographic TEXT sort — so ordering across
-- the two was not reliable. Convert the legacy space-separated form to ISO.
UPDATE error_log
SET created_at = REPLACE(created_at, ' ', 'T') || 'Z'
WHERE created_at LIKE '____-__-__ __:__:__';

CREATE UNIQUE INDEX IF NOT EXISTS uq_error_log_error_id ON error_log (error_id);

-- E-B16: no retention policy existed at all — error_log grew without bound and
-- the only cap was the 300-row read window. Trim anything older than 180 days
-- that has already been reported (or was never worth reporting).
DELETE FROM error_log
WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-180 days');
