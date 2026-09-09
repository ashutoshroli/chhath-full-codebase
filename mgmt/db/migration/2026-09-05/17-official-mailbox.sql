-- ============================================================================
-- Official mailbox (chhath@shaharpura.com) — 2026-09-05  ·  DB: chhath-whatsapp-index
--
--   wrangler d1 execute chhath-whatsapp-index --remote --file=./migration/2026-09-05/17-official-mailbox.sql
--
-- Adds official_emails: the two-way mailbox for chhath@shaharpura.com — outbound
-- (sent/reply, via Resend) AND inbound (received via the Resend receiving webhook,
-- body fetched with the Received Emails API). Separate from email_messages, which
-- is the one-way noreply@ notification queue.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS only. Nothing dropped, no row
-- modified. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS official_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  direction TEXT,
  resend_id TEXT,
  from_addr TEXT,
  to_addr TEXT,
  cc_addr TEXT,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  thread_id TEXT,
  in_reply_to TEXT,
  status TEXT,
  remarks TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_official_emails_direction ON official_emails(direction);
CREATE INDEX IF NOT EXISTS idx_official_emails_thread ON official_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_official_emails_created_at ON official_emails(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_official_emails_message_id ON official_emails(message_id);
