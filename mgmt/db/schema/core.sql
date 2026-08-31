-- D1 database: core
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "Commitee Members"
DROP TABLE IF EXISTS committee_members;
CREATE TABLE committee_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year REAL,
  name TEXT,
  created_by TEXT,
  view_role TEXT,
  view_role_hindi TEXT,
  whatsapp REAL
);
CREATE INDEX idx_committee_members_year ON committee_members(year);

-- source sheet: "LOGIN"
DROP TABLE IF EXISTS login_users;
CREATE TABLE login_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  password TEXT,
  role TEXT,
  updated_at TEXT,
  mobile REAL,
  email TEXT
);
CREATE INDEX idx_login_users_name ON login_users(name);

-- source sheet: "PORTAL_SETTINGS"
DROP TABLE IF EXISTS portal_settings;
CREATE TABLE portal_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "key" TEXT,
  value TEXT
);

-- source sheet: "FESTIVAL_DATES"
DROP TABLE IF EXISTS festival_dates;
CREATE TABLE festival_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year REAL,
  diwali_next_day_date TEXT,
  nahay_khay_date TEXT,
  chhath_morning_arghya_date TEXT
);
CREATE INDEX idx_festival_dates_year ON festival_dates(year);

-- source sheet: "DROPDOWN_LISTS"
DROP TABLE IF EXISTS dropdown_lists;
CREATE TABLE dropdown_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_type TEXT,
  english_value TEXT,
  hindi_label TEXT,
  active TEXT,
  sort_order REAL
);
CREATE INDEX idx_dropdown_lists_list_type ON dropdown_lists(list_type);
CREATE INDEX idx_dropdown_lists_active ON dropdown_lists(active);

-- source sheet: "MANUAL YEARS"
DROP TABLE IF EXISTS manual_years;
CREATE TABLE manual_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year TEXT,
  addedby TEXT,
  addedat TEXT
);

-- source sheet: "LOCKED YEARS"
DROP TABLE IF EXISTS locked_years;
CREATE TABLE locked_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year TEXT,
  lockedby TEXT,
  lockedat TEXT
);

-- source sheet: "Users"
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_code TEXT,
  name TEXT,
  village TEXT,
  fathers_name TEXT,
  mobile REAL,
  designation TEXT,
  created_by TEXT,
  email TEXT,
  whatsapp REAL,
  name_hindi TEXT,
  fathers_name_hindi TEXT,
  designation_hindi TEXT,
  village_hindi TEXT
);
CREATE INDEX idx_users_village ON users(village);
CREATE INDEX idx_users_mobile ON users(mobile);

