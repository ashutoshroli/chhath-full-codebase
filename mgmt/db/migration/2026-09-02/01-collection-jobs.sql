-- ============================================================================
-- Collection Queue migration — DB: chhath-misc
--
-- Adds the `collection_jobs` table that powers the new server-side background
-- queue. When an admin/subadmin/superadmin saves a COLLECTION, the browser
-- fills the .docx template (as before) but then, instead of waiting for the
-- PDF conversion + WhatsApp queueing to finish, it just INSERTS one row here as
-- `pending` and returns immediately (fast save). A Cron Trigger in the Worker
-- picks up pending rows every minute and runs the EXISTING, already-server-side
-- convertDocxToPdf + triggerCollectionMessages, then marks the row done/failed.
--
-- RUN THIS FILE AGAINST **chhath-misc** ONLY:
--   wrangler d1 execute chhath-misc --remote --file=./migration/2026-09-02/01-collection-jobs.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-misc --local --file=./migration/2026-09-02/01-collection-jobs.sql
--
-- Idempotent: uses CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS, and
-- does NOT drop or modify any existing table. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS collection_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,                 -- app-generated unique id (JOB...)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | done | failed
  doc_type TEXT,               -- receipt | certificate | samaan | '' (no auto-doc, e.g. resell)
  year TEXT,
  row_index INTEGER,           -- COLLECTIONS row id (last_row_id from saveRecord)
  record_id TEXT,              -- `${doc_type}-${year}-${row_index}` (null when no doc)
  is_new_entry INTEGER DEFAULT 1,  -- 1 = new save (queue WhatsApp), 0 = edit (skip WhatsApp)
  payload TEXT,                -- JSON snapshot of the collection payload (for WhatsApp placeholders)
  filled_base64 TEXT,          -- client-filled .docx as base64 (used by convertDocxToPdf); '' when no doc
  file_name TEXT,              -- suggested output file name
  public_link TEXT,            -- filled in after PDF generation succeeds
  attempts INTEGER DEFAULT 0,  -- processing attempts (capped so a bad job can't loop forever)
  last_error TEXT,             -- last failure message (for the queue panel + Error Log)
  created_by TEXT,             -- acting user's id/name (for WhatsApp "from" + audit)
  created_at TEXT,
  claimed_at TEXT,             -- when the cron picked it up (stuck-detection)
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_collection_jobs_status ON collection_jobs(status);
CREATE INDEX IF NOT EXISTS idx_collection_jobs_created_at ON collection_jobs(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_jobs_job_id ON collection_jobs(job_id);
