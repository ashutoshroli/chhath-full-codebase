-- ============================================================================
-- audit M-13 — the PUBLIC logError per-IP limiter was an unindexable scan
-- Database: chhath-logs
--
-- Public/backend/src/index.js folded the edge IP into the JSON `context` column and
-- then counted it with:
--
--     SELECT COUNT(*) AS n FROM error_log
--      WHERE created_at >= ? AND context LIKE '%"edgeIp":"1.2.3.4"%'
--
-- A leading-wildcard LIKE can never use an index, so every public JavaScript error
-- cost a partial scan of error_log — on an ANONYMOUS, unauthenticated endpoint that
-- also INSERTs. The rate limiter meant to make that endpoint cheap was itself the
-- expensive part, and it got worse as the table grew, which is precisely when a
-- flood is happening.
--
-- Adding a real column makes the count index-served. `context` keeps carrying
-- edgeIp too, so nothing that reads the JSON breaks and old rows still work.
--
-- Idempotent: ALTER TABLE ADD COLUMN cannot be guarded by IF NOT EXISTS in SQLite,
-- so it is wrapped the same way the earlier migrations in this folder handle it —
-- run it once; a second run reports "duplicate column name: client_ip" and changes
-- nothing. The CREATE INDEX below IS idempotent and is what the code depends on.
--
-- Apply with:
--   wrangler d1 execute chhath-logs --remote --file=./09-error-log-client-ip.sql
-- ============================================================================

-- Safe to re-run: fails with "duplicate column name" the second time, which is a
-- no-op. Run the CREATE INDEX below regardless.
ALTER TABLE error_log ADD COLUMN client_ip TEXT;

-- The limiter's exact predicate is (client_ip = ? AND created_at >= ?), so lead
-- with client_ip and let created_at narrow the window inside it.
CREATE INDEX IF NOT EXISTS idx_error_log_client_ip_created_at
  ON error_log (client_ip, created_at);

-- Backfill the IP out of the JSON for existing rows, so the limiter counts history
-- rather than starting from zero the moment this is applied. Bounded and
-- re-runnable: only rows that have an edgeIp in context and no client_ip yet.
UPDATE error_log
   SET client_ip = TRIM(
         SUBSTR(context,
                INSTR(context, '"edgeIp":"') + 10,
                INSTR(SUBSTR(context, INSTR(context, '"edgeIp":"') + 10), '"') - 1)
       )
 WHERE (client_ip IS NULL OR client_ip = '')
   AND context LIKE '%"edgeIp":"%';
