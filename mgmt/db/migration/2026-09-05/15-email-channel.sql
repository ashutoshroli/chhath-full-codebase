-- ============================================================================
-- EMAIL channel (Resend) — 2026-09-05  ·  DB: chhath-whatsapp-index
--
--   wrangler d1 execute chhath-whatsapp-index --remote --file=./migration/2026-09-05/15-email-channel.sql
--
-- Adds the two tables that power collection email notifications sent via Resend:
--   * email_message_templates — mirrors person_message_templates + a `subject`.
--   * email_messages          — the send queue (drained by the Worker itself;
--                               Resend is a plain HTTPS API, so unlike WhatsApp
--                               there is NO external poller).
--
-- Lives in the same database as the WhatsApp tables (bound as DB_WHATSAPP_INDEX)
-- so no new binding is required.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS only. Nothing is dropped, no row
-- is modified. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT,
  subject TEXT,
  text TEXT,
  active TEXT,
  created_at TEXT,
  message_type TEXT,
  contribution_type INTEGER,
  file_link TEXT,
  doc_sub_type TEXT,
  file_doc_type TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_message_templates_contribution_type ON email_message_templates(contribution_type);

CREATE TABLE IF NOT EXISTS email_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  to_email TEXT,
  subject TEXT,
  body TEXT,
  status TEXT,
  remarks TEXT,
  created_at TEXT,
  "from" TEXT,
  reply_to TEXT,
  message_type TEXT,
  file_link TEXT,
  attempts INTEGER DEFAULT 0,
  claimed_at TEXT,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status);
CREATE INDEX IF NOT EXISTS idx_email_messages_to_email ON email_messages(to_email);
CREATE INDEX IF NOT EXISTS idx_email_messages_status_attempts ON email_messages(status, attempts);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_messages_message_id ON email_messages(message_id);
