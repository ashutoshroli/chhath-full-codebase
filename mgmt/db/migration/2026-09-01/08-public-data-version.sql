-- ============================================================================
-- Public data-version cache key — DB: chhath-core
--
-- RUN THIS FILE AGAINST **chhath-core** ONLY:
--   wrangler d1 execute chhath-core --remote --file=./migration/2026-09-01/08-public-data-version.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-core --local --file=./migration/2026-09-01/08-public-data-version.sql
--
-- Every statement is idempotent. Nothing is dropped.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- WHY
--
-- The Public transparency portal used to send its whole dataset with a fixed
-- `Cache-Control: max-age=60`, so every visitor re-downloaded everything each
-- minute regardless of whether anything changed. We now drive caching off a
-- single monotonically-increasing counter that the mgmt Worker bumps after
-- every successful WRITE and the Public Worker turns into an ETag: unchanged
-- version -> `304 Not Modified` (no payload, no DB scan).
--
-- The counter is stored as one row in portal_settings:
--     key = 'public_data_version', value = '<n>'
--
-- Both Workers bind DB_CORE (the Public Worker has no KV binding), so this table
-- is the one place they can both reach.
-- ---------------------------------------------------------------------------


-- 1) De-duplicate any pre-existing portal_settings rows that share a key, keeping
--    the lowest id. Required before a UNIQUE index can be created, and harmless
--    if there are no duplicates.
DELETE FROM portal_settings
 WHERE id NOT IN (SELECT MIN(id) FROM portal_settings GROUP BY "key");


-- 2) UNIQUE index on "key" so the app's UPSERT (INSERT ... ON CONFLICT("key"))
--    is atomic. setPortalSetting()/getPortalSetting() already treat key as
--    unique; this makes the schema enforce it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_settings_key ON portal_settings ("key");


-- 3) Seed the counter so getDataVersion() has a row to read/increment from the
--    very first request. Idempotent: only inserts when absent.
INSERT INTO portal_settings ("key", value)
SELECT 'public_data_version', '1'
 WHERE NOT EXISTS (SELECT 1 FROM portal_settings WHERE "key" = 'public_data_version');
