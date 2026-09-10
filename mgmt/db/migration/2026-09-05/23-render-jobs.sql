-- ============================================================================
-- render_jobs table — 2026-09-05  ·  DB: chhath-misc
--
-- RUN THIS FILE AGAINST **chhath-misc** ONLY:
--   wrangler d1 execute chhath-misc --remote --file=./migration/2026-09-05/23-render-jobs.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-misc --local --file=./migration/2026-09-05/23-render-jobs.sql
--
-- Generic job queue for work offloaded to the external Render service (AI fix
-- generation + PR creation). The Worker owns the job STATE; Render only computes
-- and calls back. schema/misc.sql already defines this table; this file brings an
-- existing live database up to that schema.
--
-- Fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS only). Nothing is dropped,
-- no row is modified, and it is safe to run twice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS render_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  result TEXT,
  error TEXT,
  render_job_id TEXT,
  ref_id TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_by TEXT,
  created_at TEXT,
  dispatched_at TEXT,
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_render_jobs_job_id ON render_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs(status);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status_dispatched ON render_jobs(status, dispatched_at);
CREATE INDEX IF NOT EXISTS idx_render_jobs_ref_id ON render_jobs(ref_id);
