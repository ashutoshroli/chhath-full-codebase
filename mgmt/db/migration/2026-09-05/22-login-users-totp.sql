-- ============================================================================
-- TOTP two-factor authentication columns — 2026-09-05  ·  DB: chhath-core
--
-- RUN THIS FILE AGAINST **chhath-core** ONLY:
--   wrangler d1 execute chhath-core --remote --file=./migration/2026-09-05/22-login-users-totp.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-core --local --file=./migration/2026-09-05/22-login-users-totp.sql
--
-- Adds the five columns 2FA needs to login_users. schema/core.sql already defines
-- them (this file is what brings an EXISTING live database up to that schema).
--
-- NOTE: SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so this migration
-- is NOT idempotent — running it twice fails on "duplicate column name", which is
-- expected. It is registered in SCHEMA_ONLY_MIGRATIONS in the migration test for
-- exactly that reason (same as 09-error-log-client-ip.sql). Run it ONCE.
--
-- Nothing is dropped and no row is modified: every existing login keeps working
-- with 2FA simply OFF (totp_enabled defaults to 0).
-- ============================================================================

ALTER TABLE login_users ADD COLUMN totp_enabled INTEGER DEFAULT 0;
ALTER TABLE login_users ADD COLUMN totp_secret_enc TEXT;
ALTER TABLE login_users ADD COLUMN totp_pending_enc TEXT;
ALTER TABLE login_users ADD COLUMN totp_backup_codes TEXT;
ALTER TABLE login_users ADD COLUMN totp_recovery_hash TEXT;
