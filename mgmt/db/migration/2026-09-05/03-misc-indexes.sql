-- ============================================================================
-- Missing indexes — 2026-09-05  ·  DB: chhath-misc               (audit H-10)
--
--   wrangler d1 execute chhath-misc --remote --file=./migration/2026-09-05/03-misc-indexes.sql
--
-- Idempotent (CREATE INDEX IF NOT EXISTS only). Nothing dropped, no row modified.
-- ============================================================================

-- popups.popup_id — the business key. savePopup, deletePopup, savePopupSlides and
-- getPopupWithSlides all do `WHERE popup_id = ?` and had no index for it.
CREATE INDEX IF NOT EXISTS idx_popups_popup_id ON popups (popup_id);

-- custom_announcements.id_code — markAnnounced / update / delete all match on it,
-- and markAnnounced runs on every single announcement made during the ceremony.
CREATE INDEX IF NOT EXISTS idx_custom_announcements_id_code ON custom_announcements (id_code);

-- collection_jobs: the retention sweep (audit M-38) selects done jobs by
-- finished_at, and the processor already filters on status.
CREATE INDEX IF NOT EXISTS idx_collection_jobs_finished_at ON collection_jobs (finished_at);
-- Composite for the sweep's exact predicate (status + finished_at) and for the
-- claim query, so neither ever degrades into a scan of a table that holds
-- megabyte-sized filled_base64 payloads.
CREATE INDEX IF NOT EXISTS idx_collection_jobs_status_finished ON collection_jobs (status, finished_at);
