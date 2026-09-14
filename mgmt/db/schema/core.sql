-- D1 database: core
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "Commitee Members"
DROP TABLE IF EXISTS committee_members;
CREATE TABLE committee_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,               -- audit M-33: was REAL. Whole year, parseInt-compared.
  name TEXT,
  created_by TEXT,
  view_role TEXT,
  view_role_hindi TEXT,
  whatsapp TEXT               -- audit M-33: was REAL. Phone number — REAL loses leading '+'/0 + precision.
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
  mobile TEXT,                -- audit M-33: was REAL. Phone number; compared as text in login lookup.
  email TEXT
  -- ---- TOTP two-factor authentication (Superadmin) ----
  -- The five 2FA columns (totp_enabled, totp_secret_enc, totp_pending_enc,
  -- totp_backup_codes, totp_recovery_hash) are added by the ADD-COLUMN migration
  -- 2026-09-05/22-login-users-totp.sql. As with error_log.client_ip (migration 09),
  -- an ADD-COLUMN migration is applied ON TOP of this committed schema, so the
  -- columns deliberately do NOT appear here — the migration is their source of
  -- truth. Semantics:
  --   totp_enabled       INTEGER 0/1 — when 1, login requires a second factor.
  --   totp_secret_enc    TEXT — Base32 secret, AES-GCM encrypted ("v1:iv:ct"). Never plain.
  --   totp_pending_enc   TEXT — in-progress enrollment secret (encrypted), promoted
  --                             to totp_secret_enc only after a valid code proves possession.
  --   totp_backup_codes  TEXT — JSON array of PBKDF2 hashes of 10 single-use codes.
  --   totp_recovery_hash TEXT — PBKDF2 hash of the 32-char recovery key (shown once).
);
CREATE INDEX idx_login_users_name ON login_users(name);

-- source sheet: "PORTAL_SETTINGS"
DROP TABLE IF EXISTS portal_settings;
CREATE TABLE portal_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "key" TEXT,
  value TEXT
);

-- "Our Journey / 10 Years of Chhath" year-by-year story (DB-driven, editable from
-- the mgmt "Journey Content" tab). Seeded by migration 28-journey-content.sql.
-- The tagline lives in portal_settings under journey_tagline_en / journey_tagline_hi.
DROP TABLE IF EXISTS journey_entries;
CREATE TABLE journey_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,
  title_en TEXT,
  title_hi TEXT,
  content_en TEXT,
  content_hi TEXT,
  position INTEGER
);
CREATE INDEX idx_journey_entries_position ON journey_entries(position);

-- Web Push subscriptions for the PUBLIC portal. The public worker upserts a row
-- when a visitor opts in (?action=savePushSubscription); the mgmt worker reads
-- them to broadcast (auto on a new contribution, or the "Custom Notification"
-- tab). Both workers bind this same database. Created by migration
-- 31-push-subscriptions.sql. `endpoint` is an opaque browser handle — no personal
-- data is stored and it is never joined to a contributor/user row.
DROP TABLE IF EXISTS push_subscriptions;
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT,
  user_agent TEXT,
  active INTEGER DEFAULT 1,
  last_error TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE UNIQUE INDEX uq_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX idx_push_subscriptions_active ON push_subscriptions(active);

-- source sheet: "FESTIVAL_DATES"
DROP TABLE IF EXISTS festival_dates;
CREATE TABLE festival_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,              -- audit M-33: was REAL. Whole year.
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
  sort_order INTEGER          -- audit M-33: was REAL. Integer ordering index (max+1).
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
  mobile TEXT,                -- audit M-33: was REAL. Phone number — TEXT preserves digits/leading zeros.
  designation TEXT,
  created_by TEXT,
  email TEXT,
  whatsapp TEXT,             -- audit M-33: was REAL. Phone number.
  name_hindi TEXT,
  fathers_name_hindi TEXT,
  designation_hindi TEXT,
  village_hindi TEXT
  -- ---- profile photo ----
  -- The `photo` column (public R2 URL of the member's profile picture; NULL/'' ->
  -- the portal's initials avatar) is added by the ADD-COLUMN migration
  -- 2026-09-05/27-users-photo.sql. As with login_users' TOTP columns and
  -- error_log.client_ip (migration 09), an ADD-COLUMN migration is applied ON TOP
  -- of this committed schema, so the column deliberately does NOT appear here —
  -- the migration is its source of truth.
);
CREATE INDEX idx_users_village ON users(village);
CREATE INDEX idx_users_mobile ON users(mobile);

