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
  contribution_type REAL,
  file_link TEXT
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
  contribution_type REAL,
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
  status TEXT,
  remarks TEXT,
  created_at TEXT,
  "from" REAL,
  message_type TEXT,
  file_link TEXT
);
CREATE INDEX idx_group_messages_status ON group_messages(status);
CREATE INDEX idx_group_messages_groupid ON group_messages(groupid);

-- source sheet: "PERSON_MESSAGES"
DROP TABLE IF EXISTS person_messages;
CREATE TABLE person_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  mobileno REAL,
  message TEXT,
  status TEXT,
  remarks TEXT,
  created_at TEXT,
  "from" REAL,
  message_type TEXT,
  file_link TEXT
);
CREATE INDEX idx_person_messages_status ON person_messages(status);
CREATE INDEX idx_person_messages_mobileno ON person_messages(mobileno);

