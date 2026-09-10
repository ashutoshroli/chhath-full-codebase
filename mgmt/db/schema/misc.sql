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
  link_text TEXT,
  duration_ms INTEGER          -- auto-play: ms this slide stays on screen (NULL/0 -> 5000ms default, clamped 1000-60000). Migration 2026-09-05/19.
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
-- The queue-drain poll filters on (status, attempts); this index keeps it off a
-- full scan of the (fat, filled_base64-bearing) table. See migration 2026-09-05/14.
CREATE INDEX IF NOT EXISTS idx_collection_jobs_status_attempts ON collection_jobs(status, attempts);


-- source: app feature (Render offload) — see migration/2026-09-05/23-render-jobs.sql
-- Generic job queue for work OFFLOADED to the external Render service (long-running
-- AI fix generation + PR creation that would hit the Worker's CPU/subrequest
-- limits). The Worker is the single source of truth for job STATE; Render only
-- computes and calls back. Lifecycle:
--   pending -> dispatched -> completed | failed
-- The Worker INSERTs a 'pending' row, POSTs the job to Render (X-Render-Api-Key),
-- marks it 'dispatched'; Render calls back on completion (X-Render-Signature) and
-- the Worker saves the result and marks 'completed'/'failed'. A reconciliation
-- cron re-dispatches or times out rows stuck in 'dispatched'. `job_id` is the
-- idempotency key (a duplicate callback for a finished job is a no-op).
CREATE TABLE IF NOT EXISTS render_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,                       -- Worker-generated unique id (idempotency key)
  kind TEXT NOT NULL,                -- 'ai_fix_generate' | 'ai_pr_create' (extensible)
  status TEXT NOT NULL DEFAULT 'pending', -- pending | dispatched | completed | failed
  payload TEXT,                      -- JSON input sent to Render (references only, no big blobs)
  result TEXT,                       -- JSON result from Render's callback
  error TEXT,                        -- failure reason (dispatch failure / Render error / timeout)
  render_job_id TEXT,                -- Render's own id, if it returns one (cross-ref)
  ref_id TEXT,                       -- domain reference (e.g. the ai_fixes.fix_id this job drives)
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_by TEXT,
  created_at TEXT,
  dispatched_at TEXT,
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_render_jobs_job_id ON render_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs(status);
-- The reconciliation cron scans (status, dispatched_at) for stuck 'dispatched' rows.
CREATE INDEX IF NOT EXISTS idx_render_jobs_status_dispatched ON render_jobs(status, dispatched_at);
CREATE INDEX IF NOT EXISTS idx_render_jobs_ref_id ON render_jobs(ref_id);
