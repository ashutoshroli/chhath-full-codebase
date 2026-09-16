-- D1 database: chhath-audit  (database_id c25cdf0d-c545-42f1-9ca0-06836a4a1cc3)
--
-- Security / audit store, kept in its OWN database so the sensitive
-- session + login-attempt data is isolated from the app data and from the
-- existing chhath-logs (activity_log / error_log). Two tables:
--
--   user_sessions   — one row per ACTIVE login (device, IP, times). Powers the
--                     "Active Devices" list + remote logout, and the Superadmin
--                     "who is online / force-logout" view. The raw session token
--                     is NEVER stored — only a SHA-256 hash of it (token_hash),
--                     so a leak of this DB can't be used to hijack sessions.
--
--   login_attempts  — one row per login attempt (success or failure) with the
--                     reason and IP/device. Powers the audit page + the
--                     "currently locked accounts" list and unlock feature.
--
-- Ongoing per-action activity (saveRecord/updateRecord/…) already lives in
-- chhath-logs.activity_log and is reused as-is; it is NOT duplicated here.

DROP TABLE IF EXISTS user_sessions;
CREATE TABLE user_sessions (
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

DROP TABLE IF EXISTS login_attempts;
CREATE TABLE login_attempts (
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


-- ============================================================================
-- INDEXES AND CONSTRAINTS THAT USED TO EXIST ONLY IN A MIGRATION
--
-- Everything below was created by a file under db/migration/ and was NOT in this
-- schema, which meant a database built from this file alone was missing it. That is
-- the wrong direction of drift: the test suite applies THIS file, so it was more
-- permissive than production -- a duplicate the live database rejects, the tests
-- accepted. (Proven at the time: a duplicate `error_log.error_id` inserted cleanly
-- against the committed schema while production has uq_error_log_error_id.)
--
-- This file is now the END STATE. A fresh database needs this file and nothing else.
-- schema-is-the-end-state.test.mjs fails if a migration ever creates an index or adds
-- a column that is not also here.
-- ============================================================================

-- from migration/06-audit-indexes.sql
CREATE INDEX IF NOT EXISTS idx_user_sessions_name_revoked
  ON user_sessions (name, revoked_at);

-- from migration/06-audit-indexes.sql
CREATE INDEX IF NOT EXISTS idx_login_attempts_name
  ON login_attempts (name);
