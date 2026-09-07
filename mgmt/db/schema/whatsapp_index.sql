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

