-- ============================================================================
-- Missing indexes — 2026-09-05  ·  DB: chhath-logs               (audit H-10)
--
--   wrangler d1 execute chhath-logs --remote --file=./migration/2026-09-05/04-logs-indexes.sql
--
-- Idempotent (CREATE INDEX IF NOT EXISTS only). Nothing dropped, no row modified.
-- ============================================================================

-- error_log de-duplication runs on EVERY logError() call — including from the
-- unauthenticated public endpoints — and its predicate is
--     WHERE source = ? AND page = ? AND message = ? AND created_at >= ?
-- but only created_at was indexed, so each write did a near-full scan of a table
-- that is designed to grow. This composite covers the selective columns; `message`
-- is deliberately left out (it is long free text, and source+page+created_at already
-- narrows the candidate set to a handful of rows).
CREATE INDEX IF NOT EXISTS idx_error_log_dedup ON error_log (source, page, created_at);

-- error_log.error_id — reportErrorToWhatsApp and the claim UPDATE both look it up.
-- Migration 2026-09-01/04 adds a UNIQUE index; repeated here with IF NOT EXISTS so a
-- deployment that skipped that file still gets the lookup covered.
CREATE UNIQUE INDEX IF NOT EXISTS uq_error_log_error_id ON error_log (error_id);

-- activity_log.timestamp — the Superadmin audit page orders by it, and the
-- retention sweep (audit M-38) selects on it.
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log (timestamp);
