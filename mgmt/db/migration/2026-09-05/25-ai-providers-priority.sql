-- ============================================================================
-- AI provider "priority" column — 2026-09-05  ·  DB: chhath-logs
--
-- RUN THIS FILE AGAINST **chhath-logs** ONLY:
--   wrangler d1 execute chhath-logs --remote --file=./migration/2026-09-05/25-ai-providers-priority.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-logs --local --file=./migration/2026-09-05/25-ai-providers-priority.sql
--
-- Adds `priority` to ai_providers so each purpose (fix / public_chat) can hold
-- MULTIPLE providers tried in a FALLBACK order: lower number = tried first. When
-- the primary hits a rate limit / is down (HTTP 429 / 5xx / timeout), the engine
-- falls through to the next-priority provider of the same purpose.
--
-- Backfill: the existing default provider of each purpose (is_default=1) becomes
-- priority 0 (tried first); everything else gets 100. This preserves today's
-- behaviour exactly — the old default is still the primary — until a Superadmin
-- reorders the list in the AI Management tab.
--
-- NOTE: SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so this migration
-- is NOT idempotent — running it twice fails on "duplicate column name", which is
-- expected. It is registered in SCHEMA_ONLY_MIGRATIONS in the migration test for
-- exactly that reason (same as 22 / 24). Run it ONCE.
-- ============================================================================

ALTER TABLE ai_providers ADD COLUMN priority INTEGER DEFAULT 100;

-- Old default of each purpose becomes the primary (priority 0).
UPDATE ai_providers SET priority = 0 WHERE is_default = 1;
