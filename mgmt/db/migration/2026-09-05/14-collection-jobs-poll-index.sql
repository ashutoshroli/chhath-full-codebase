-- ============================================================================
-- collection_jobs poll index — 2026-09-05  ·  DB: chhath-misc   (rows_read burn)
--
--   wrangler d1 execute chhath-misc --remote --file=./migration/2026-09-05/14-collection-jobs-poll-index.sql
--
-- WHY: the background queue drain (processPendingJobs, run every 3 min by cron
-- AND on every retry / frontend nudge) selects eligible jobs with:
--
--     WHERE attempts < ?
--       AND (status = 'pending'
--            OR (status = 'processing' AND (claimed_at IS NULL OR claimed_at < ?)))
--
-- The only pre-existing indexes on collection_jobs were (status), (created_at),
-- (job_id) and (status, finished_at). NONE of them covers `attempts`, so the
-- planner fell back to a FULL TABLE SCAN of a table whose rows each hold a
-- ~700 KB base64 .docx (filled_base64). On the D1 free plan (5,000,000
-- rows_read/day) that scan — 480 cron ticks/day plus every retry — silently
-- burned the daily read budget even with almost no user activity.
--
-- This composite (status, attempts) lets SQLite satisfy each `status = ...`
-- branch of the OR with an index range on `attempts` instead of scanning. Paired
-- with the code change that stops SELECT *-ing the fat blob during the poll, the
-- drain becomes cheap.
--
-- Idempotent (CREATE INDEX IF NOT EXISTS only). Nothing dropped, no row modified.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_collection_jobs_status_attempts
  ON collection_jobs (status, attempts);
