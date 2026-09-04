-- ============================================================================
-- Audit store migration — DB: chhath-audit
--
-- Creates the two tables that power:
--   * Active Devices list + remote logout (every role, own devices)
--   * Superadmin "who is online / force logout any user"
--   * Superadmin Activity & Login Logs page (login history, failed attempts,
--     currently-locked accounts + unlock)
--
-- RUN THIS FILE AGAINST **chhath-audit** ONLY:
--   wrangler d1 execute chhath-audit --remote --file=./migration/2026-09-04/01-audit-sessions-logins.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-audit --local --file=./migration/2026-09-04/01-audit-sessions-logins.sql
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS only; drops/modifies nothing.
-- Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL,        -- SHA-256 hex of the session token (never the raw token)
  name TEXT NOT NULL,              -- login user id (login_users.name)
  role TEXT,                       -- role at login time (display only)
  ip TEXT,                         -- server-observed edge IP (CF-Connecting-IP)
  device_info TEXT,                -- client-reported user-agent / device string
  created_at TEXT NOT NULL,        -- login time (ISO)
  last_seen_at TEXT,               -- updated on activity (throttled)
  expires_at INTEGER NOT NULL,     -- epoch ms; matches the KV session TTL
  revoked_at TEXT                  -- set when logged out / force-logged-out (row kept for audit)
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_name ON user_sessions(name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT,                 -- what was typed (name / mobile / email), trimmed
  name TEXT,                       -- resolved login_users.name on success (else NULL)
  success INTEGER NOT NULL,        -- 1 = logged in, 0 = failed
  reason TEXT,                     -- 'ok' | 'bad_password' | 'unknown_user' | 'locked_out'
  ip TEXT,                         -- server-observed edge IP
  device_info TEXT,
  locked INTEGER DEFAULT 0,        -- 1 if this attempt hit/was during the lockout
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created_at ON login_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_success ON login_attempts(success);
