-- D1 database: misc
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "CUSTOM_ANNOUNCEMENTS"
DROP TABLE IF EXISTS custom_announcements;
CREATE TABLE custom_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_code TEXT,
  year REAL,
  texthindi TEXT,
  textenglish TEXT,
  priority TEXT,
  announced TEXT,
  announcedcount REAL,
  createdat TEXT,
  "order" REAL
);
CREATE INDEX idx_custom_announcements_year ON custom_announcements(year);
CREATE INDEX idx_custom_announcements_announced ON custom_announcements(announced);

-- source sheet: "ANNOUNCEMENT_LINKS"
DROP TABLE IF EXISTS announcement_links;
CREATE TABLE announcement_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT,
  year REAL,
  pin TEXT,
  expiresat TEXT,
  active TEXT,
  createdby TEXT,
  createdat TEXT
);
CREATE INDEX idx_announcement_links_token ON announcement_links(token);
CREATE INDEX idx_announcement_links_year ON announcement_links(year);
CREATE INDEX idx_announcement_links_active ON announcement_links(active);

-- source sheet: "POPUP_SLIDES"
DROP TABLE IF EXISTS popup_slides;
CREATE TABLE popup_slides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slide_id TEXT,
  popup_id TEXT,
  slide_order REAL,
  image_url TEXT,
  text TEXT,
  link_url TEXT,
  link_text TEXT
);
CREATE INDEX idx_popup_slides_popup_id ON popup_slides(popup_id);

-- source sheet: "POPUPS"
DROP TABLE IF EXISTS popups;
CREATE TABLE popups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  popup_id TEXT,
  title TEXT,
  roles TEXT,
  active TEXT,
  start_at TEXT,
  end_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX idx_popups_active ON popups(active);

