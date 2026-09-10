-- D1 database: whatsapp_index
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "GROUP_MESSAGE_TEMPLATES"
DROP TABLE IF EXISTS group_message_templates;
CREATE TABLE group_message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT,
  text TEXT,
  active TEXT,
  created_at TEXT,
  message_type TEXT,
  contribution_type INTEGER,  -- audit M-33: was REAL. Only ever 1-4.
  file_link TEXT,
  -- Both columns were missing here even though addTemplate()/updateTemplate()
  -- always write them for BOTH template tables -> every "Add/Update Group
  -- Template" failed with D1_ERROR "no column named doc_sub_type". They are
  -- genuinely used for group messages too: doc_sub_type picks
  -- Certificate-vs-Receipt in templatesForContribution(), file_doc_type decides
  -- whether the freshly generated PDF gets attached in resolveFileLink().
  doc_sub_type TEXT,
  file_doc_type TEXT
);

-- source sheet: "WHATSAPP_GROUPS"
DROP TABLE IF EXISTS whatsapp_groups;
CREATE TABLE whatsapp_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT,
  group_name TEXT,
  groupid TEXT,
  active TEXT,
  created_at TEXT
);
CREATE INDEX idx_whatsapp_groups_groupid ON whatsapp_groups(groupid);

-- source sheet: "PERSON_MESSAGE_TEMPLATES"
DROP TABLE IF EXISTS person_message_templates;
CREATE TABLE person_message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT,
  text TEXT,
  active TEXT,
  created_at TEXT,
  message_type TEXT,
  contribution_type INTEGER,  -- audit M-33: was REAL. Only ever 1-4.
  file_link TEXT,
  doc_sub_type TEXT,
  file_doc_type TEXT
);

-- source sheet: "GROUP_MESSAGES"
DROP TABLE IF EXISTS group_messages;
CREATE TABLE group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  groupid TEXT,
  message TEXT,
  status TEXT,          -- pending | sending | resending | sent | failed
  remarks TEXT,
  created_at TEXT,
  "from" TEXT,          -- was REAL: phone numbers are NOT numbers (a leading '+'
                        -- or 0 cannot survive REAL affinity)
  message_type TEXT,
  file_link TEXT,
  attempts INTEGER DEFAULT 0,  -- how many times served to the external sender
  claimed_at TEXT,             -- set when served; a stale claim is auto-requeued
  sent_at TEXT                 -- set on the terminal sent/failed transition
);
CREATE INDEX idx_group_messages_status ON group_messages(status);
CREATE INDEX idx_group_messages_groupid ON group_messages(groupid);
CREATE INDEX idx_group_messages_claimed_at ON group_messages(claimed_at);
-- message_id is the sole business key for updateMessageStatus()/resendMessage().
-- without this a collision silently corrupts a different recipient's status.
CREATE UNIQUE INDEX uq_group_messages_message_id ON group_messages(message_id);

-- source sheet: "PERSON_MESSAGES"
DROP TABLE IF EXISTS person_messages;
CREATE TABLE person_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  mobileno TEXT,        -- was REAL: stored 917282032146.0 and silently lost any
                        -- leading '+'/0. Always the canonical 91XXXXXXXXXX now
                        -- (see backend/src/phone.js waNumber()).
  message TEXT,
  status TEXT,          -- pending | sending | resending | sent | failed
  remarks TEXT,
  created_at TEXT,
  "from" TEXT,
  message_type TEXT,
  file_link TEXT,
  attempts INTEGER DEFAULT 0,
  claimed_at TEXT,
  sent_at TEXT
);
CREATE INDEX idx_person_messages_status ON person_messages(status);
CREATE INDEX idx_person_messages_mobileno ON person_messages(mobileno);
CREATE INDEX idx_person_messages_claimed_at ON person_messages(claimed_at);
CREATE UNIQUE INDEX uq_person_messages_message_id ON person_messages(message_id);

-- ============================================================================
-- EMAIL channel (Resend). Mirrors the WhatsApp person template + queue, but the
-- Worker sends directly via the Resend HTTP API (no external poller). Lives in
-- the same DB (DB_WHATSAPP_INDEX) so no new binding is needed.
-- ============================================================================

-- Email message templates: same shape as person_message_templates, plus a
-- `subject` column (email needs a subject line). Selected by contribution_type /
-- doc_sub_type via templatesForContribution(), rendered with renderTemplateChecked().
CREATE TABLE IF NOT EXISTS email_message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT,
  subject TEXT,                 -- email subject line (supports {placeholders} too)
  text TEXT,                    -- email body (supports {placeholders}); rendered as text/HTML
  active TEXT,
  created_at TEXT,
  message_type TEXT,            -- normal | priority (kept for parity with WhatsApp)
  contribution_type INTEGER,    -- 1-4, same meaning as the WhatsApp templates
  file_link TEXT,               -- static attachment/link, OR '' to use the generated PDF
  doc_sub_type TEXT,            -- Certificate vs Receipt refinement for type 3
  file_doc_type TEXT            -- when set + matches the produced doc, attach the generated PDF link
);
CREATE INDEX IF NOT EXISTS idx_email_message_templates_contribution_type ON email_message_templates(contribution_type);

-- Email queue: mirrors person_messages. The Worker itself drains this (Resend is
-- a plain HTTPS API), so there is no apiKey-gated external poller — status moves
-- pending -> sending -> sent/failed inside processPendingEmails().
CREATE TABLE IF NOT EXISTS email_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  to_email TEXT,        -- recipient (contributor's users.email)
  subject TEXT,
  body TEXT,
  status TEXT,          -- pending | sending | resending | sent | failed
  remarks TEXT,
  created_at TEXT,
  "from" TEXT,          -- From address (RESEND_FROM)
  reply_to TEXT,        -- Reply-To address (RESEND_REPLY_TO)
  message_type TEXT,
  file_link TEXT,       -- optional attachment URL (the generated PDF link)
  attempts INTEGER DEFAULT 0,
  claimed_at TEXT,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status);
CREATE INDEX IF NOT EXISTS idx_email_messages_to_email ON email_messages(to_email);
CREATE INDEX IF NOT EXISTS idx_email_messages_status_attempts ON email_messages(status, attempts);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_messages_message_id ON email_messages(message_id);



-- ============================================================================
-- OFFICIAL MAILBOX (chhath@shaharpura.com) — a real inbox: outbound (sent/reply)
-- AND inbound (received via the Resend receiving webhook). Lives in the same DB
-- (DB_WHATSAPP_INDEX) so no new binding is needed. Distinct from email_messages
-- (that is the one-way noreply@ notification QUEUE); this is the two-way mailbox.
-- ============================================================================
CREATE TABLE IF NOT EXISTS official_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,              -- our own id (MSG...)
  direction TEXT,               -- 'inbound' | 'outbound'
  resend_id TEXT,               -- Resend's email id (sent id, or the received email_id)
  from_addr TEXT,               -- "from" is a reserved word; use from_addr
  to_addr TEXT,
  cc_addr TEXT,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  thread_id TEXT,               -- groups a conversation (root message_id/resend_id)
  in_reply_to TEXT,             -- the id this message replies to
  status TEXT,                  -- outbound: sent|failed ; inbound: received
  remarks TEXT,
  is_read INTEGER DEFAULT 0,    -- inbound unread flag (0/1)
  attachments TEXT,             -- JSON array: outbound [{filename}], inbound [{filename,contentType,id}]
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_official_emails_direction ON official_emails(direction);
CREATE INDEX IF NOT EXISTS idx_official_emails_thread ON official_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_official_emails_created_at ON official_emails(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_official_emails_message_id ON official_emails(message_id);
