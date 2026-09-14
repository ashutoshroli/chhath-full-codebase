-- ============================================================================
-- RESET PORTAL DATA — SECTION 6 of 8
-- database: chhath-logs            (binding DB_LOGS)
--
--   npx wrangler d1 execute chhath-logs --remote --file mgmt/db/cleanup/2026-09-14-reset-portal-data/06-logs.sql
--
-- KEEPS: ai_providers — provider configuration, including ENCRYPTED API keys.
--        Emptying it disconnects every AI feature and the keys cannot be
--        recovered from this database.
--
-- EMPTIES: activity_log, error_log, ai_fixes
--
-- error_log and activity_log are also clearable from the UI:
--   Superadmin -> Cleanup -> "Error log" / "Activity log", mode "All".
--
-- Note: clearing error_log here also clears the rows ai_fixes referenced by
-- error_id, which is why both are emptied together.
-- ============================================================================

DELETE FROM ai_fixes;
DELETE FROM sqlite_sequence WHERE name = 'ai_fixes';

DELETE FROM activity_log;
DELETE FROM sqlite_sequence WHERE name = 'activity_log';

DELETE FROM error_log;
DELETE FROM sqlite_sequence WHERE name = 'error_log';

-- ---------------------------------------------------------------- VERIFY
-- Expected: the three *_rows 0, kept_ai_providers NON-zero.
-- activity_log may show 1 or 2 rows if an admin action was audited between the
-- delete and this read; that is normal.
SELECT
  (SELECT COUNT(*) FROM error_log)     AS error_log_rows,
  (SELECT COUNT(*) FROM activity_log)  AS activity_log_rows,
  (SELECT COUNT(*) FROM ai_fixes)      AS ai_fixes_rows,
  (SELECT COUNT(*) FROM ai_providers)  AS kept_ai_providers;
