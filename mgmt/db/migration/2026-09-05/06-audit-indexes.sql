-- ============================================================================
-- Missing indexes — 2026-09-05  ·  DB: chhath-audit              (audit H-10)
--
--   wrangler d1 execute chhath-audit --remote --file=./migration/2026-09-05/06-audit-indexes.sql
--
-- Idempotent (CREATE INDEX IF NOT EXISTS only). Nothing dropped, no row modified.
-- ============================================================================

-- verifyToken() reads user_sessions by token_hash on EVERY authenticated request —
-- the single most frequent query in the portal. uq_user_sessions_token_hash already
-- covers it (schema/audit.sql); repeated with IF NOT EXISTS as a safety net.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_token_hash ON user_sessions (token_hash);

-- The retention sweep (audit M-38) trims long-expired sessions and old attempts.
-- expires_at + created_at are already indexed in schema/audit.sql; this composite
-- serves the "my active devices" list (name + revoked_at IS NULL + expires_at > now).
CREATE INDEX IF NOT EXISTS idx_user_sessions_name_revoked ON user_sessions (name, revoked_at);

-- getLoginAttempts() filters by name and orders by id; name was not indexed
-- (only `identifier` was).
CREATE INDEX IF NOT EXISTS idx_login_attempts_name ON login_attempts (name);
