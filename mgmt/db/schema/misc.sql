-- D1 database: misc
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "CUSTOM_ANNOUNCEMENTS"
DROP TABLE IF EXISTS custom_announcements;
CREATE TABLE custom_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_code TEXT,
  year INTEGER,              -- audit M-33: was REAL. Whole year.
  texthindi TEXT,
  textenglish TEXT,
  priority TEXT,
  announced TEXT,
  announcedcount INTEGER,     -- audit M-33: was REAL. Integer counter.
  createdat TEXT,
  "order" INTEGER             -- audit M-33: was REAL. Integer ordering field.
);
CREATE INDEX idx_custom_announcements_year ON custom_announcements(year);
CREATE INDEX idx_custom_announcements_announced ON custom_announcements(announced);

-- source sheet: "ANNOUNCEMENT_LINKS"
DROP TABLE IF EXISTS announcement_links;
CREATE TABLE announcement_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT,
  year INTEGER,              -- audit M-33: was REAL. Whole year.
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
  slide_order INTEGER,        -- audit M-33: was REAL. Integer ordering (ORDER BY slide_order).
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



-- source: app feature (Collection Queue) — see migration/2026-09-02/01-collection-jobs.sql
-- Background job queue: a COLLECTION save enqueues one row here; a Worker Cron
-- Trigger processes pending rows (PDF generation + WhatsApp queueing) so the
-- save itself returns instantly.
CREATE TABLE IF NOT EXISTS collection_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  doc_type TEXT,
  year TEXT,
  row_index INTEGER,
  record_id TEXT,
  is_new_entry INTEGER DEFAULT 1,
  payload TEXT,
  filled_base64 TEXT,
  file_name TEXT,
  public_link TEXT,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_by TEXT,
  created_at TEXT,
  claimed_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_status ON collection_jobs(status);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_created_at ON collection_jobs(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_jobs_job_id ON collection_jobs(job_id);
