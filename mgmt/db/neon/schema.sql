-- ============================================================================
-- Neon (PostgreSQL) schema for the PUBLIC AI CHATBOT
--
-- WHY A SEPARATE DB (not Cloudflare D1):
--   Chat is high-write and spiky (a festival traffic spike could be thousands of
--   messages). D1's free tier has a HARD 100,000-rows-written/day cap that the
--   mgmt Worker ALREADY shares (cron queue, error log, sessions, saves). Putting
--   chat logs on D1 would let a chat spike exhaust that budget and take the whole
--   portal (receipts, WhatsApp, saves) offline. Neon has no such daily row-cap, so
--   chat writes here NEVER touch the D1 budget — the mgmt portal stays safe no
--   matter how much the chatbot is used.
--
-- WHAT LIVES HERE: only chatbot conversation logs. NO portal data (that stays in
-- D1, the source of truth) and NO secrets. Two tables:
--   chat_sessions  — one row per browser conversation
--   chat_messages  — one row per message (user question / assistant answer)
--
-- HOW TO APPLY: see README.md in this folder (Neon SQL Editor, or psql).
-- Safe to re-run: everything is CREATE ... IF NOT EXISTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
  id           BIGSERIAL PRIMARY KEY,
  session_id   TEXT NOT NULL UNIQUE,        -- client-generated opaque id (no PII)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lang         TEXT,                        -- 'en' | 'hi' (UI language when started)
  ip_hash      TEXT,                        -- HASH of the client IP (rate-limit/audit only; never the raw IP)
  user_agent   TEXT                         -- coarse UA string (diagnostics only)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL,              -- FK-ish to chat_sessions.session_id (not enforced: logs, keep writes cheap)
  role          TEXT NOT NULL,              -- 'user' | 'assistant'
  content       TEXT NOT NULL,              -- the question or the answer
  model         TEXT,                       -- which model produced an assistant reply
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  data_version  TEXT,                       -- portalData version the answer was grounded on (traceability)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read patterns: "messages of a session, in order" and "recent activity".
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages (created_at);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_created ON chat_sessions (created_at);

-- OPTIONAL retention helper (run manually or via a scheduled job if you want to
-- keep the free tier small): delete chat logs older than 90 days.
--   DELETE FROM chat_messages WHERE created_at < now() - INTERVAL '90 days';
--   DELETE FROM chat_sessions WHERE last_seen_at < now() - INTERVAL '90 days';
