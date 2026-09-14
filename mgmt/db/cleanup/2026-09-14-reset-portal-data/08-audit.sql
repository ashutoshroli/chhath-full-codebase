-- ============================================================================
-- RESET PORTAL DATA — SECTION 8 of 8
-- database: chhath-audit           (binding DB_AUDIT)
--
--   npx wrangler d1 execute chhath-audit --remote --file mgmt/db/cleanup/2026-09-14-reset-portal-data/08-audit.sql
--
-- EMPTIES: user_sessions, login_attempts
--
-- Clearing user_sessions signs every logged-in device out, which is what you want
-- after removing the other login accounts -- otherwise a deleted account could
-- keep working from an already-open browser until its session expired. Expect to
-- log in again yourself right after this.
--
-- login_attempts holds the lockout counters, so clearing it also releases any
-- account currently locked out by failed attempts.
-- ============================================================================

DELETE FROM user_sessions;
DELETE FROM sqlite_sequence WHERE name = 'user_sessions';

DELETE FROM login_attempts;
DELETE FROM sqlite_sequence WHERE name = 'login_attempts';

-- ---------------------------------------------------------------- VERIFY
-- Expected: both 0
SELECT
  (SELECT COUNT(*) FROM user_sessions)  AS user_sessions_rows,
  (SELECT COUNT(*) FROM login_attempts) AS login_attempts_rows;
