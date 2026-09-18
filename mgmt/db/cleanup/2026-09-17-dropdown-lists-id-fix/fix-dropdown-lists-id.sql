-- ============================================================================
-- OPERATOR SCRIPT — restore dropdown_lists.id to INTEGER PRIMARY KEY AUTOINCREMENT
-- (chhath-core). Standalone cleanup, NOT a migration. See RUNBOOK.md in this dir.
-- ============================================================================
--
-- ROOT CAUSE
-- ----------
-- Adding a new dropdown list item (mgmt UI -> List management -> Add) silently
-- lost data on the LIVE database: the row appeared to save but was gone after a
-- reload. FEAT-002 hardened mgmt/backend/src/dropdownLists.js to throw when a D1
-- write reports meta.changes === 0, which catches most silent no-ops. But the
-- EXACT live variant is not a 0-change write — it is a corrupted table shape:
--
--   The live `dropdown_lists` table lost `INTEGER PRIMARY KEY AUTOINCREMENT` on
--   its `id` column; it is now a plain `id INTEGER`. With a plain integer id, an
--   INSERT that omits `id` (as the handler does) reports meta.changes = 1 while
--   storing id = NULL. The write "succeeds" (changes=1, so meta.changes cannot
--   catch it) but the row has a NULL primary key and behaves as lost/duplicate.
--
-- The drift was introduced by the reset RUNBOOK's "If something goes wrong"
-- restore path (mgmt/db/cleanup/2026-09-14-reset-portal-data/RUNBOOK.md), which
-- replays `wrangler d1 export` output. A `wrangler d1 export` re-emits the table
-- as a plain `id INTEGER` and drops the AUTOINCREMENT, so restoring from that
-- backup recreates the table with the wrong shape.
--
-- The durable fix is to rebuild the table with the correct DDL, matching
-- mgmt/db/schema/core.sql exactly, carrying every existing row forward (ids
-- included, so references such as row id=1 'Lighting' are preserved).
--
-- WARNING — BACK UP FIRST
-- -----------------------
-- This DROPs and rebuilds a live table. Take a full backup before running it,
-- exactly as the reset RUNBOOK step 0 does:
--   npx wrangler d1 export chhath-core --remote --output backup-core-$(date +%F).sql
-- Confirm the backup file is non-empty before proceeding.
--
-- APPLY (run the PRE-FLIGHT detection in RUNBOOK.md FIRST):
--   npx wrangler d1 execute chhath-core --remote --file mgmt/db/cleanup/2026-09-17-dropdown-lists-id-fix/fix-dropdown-lists-id.sql
--
-- The statements are wrapped in an explicit BEGIN TRANSACTION; ... COMMIT; so the
-- whole rebuild lands, or none of it does — atomicity is self-contained and does
-- not depend on how `wrangler d1 execute --file` batches statements. A mid-script
-- failure after DROP TABLE rolls back, so dropdown_lists can never be left gone.
--
-- NOTE — a FRESH database is already correct
-- ------------------------------------------
-- A database built from mgmt/db/schema/core.sql ALREADY declares
-- `id INTEGER PRIMARY KEY AUTOINCREMENT` and both indexes. It does NOT need this
-- script, and must NOT run it. This is an in-place repair for an EXISTING live
-- database whose id column drifted. Run it only when the PRE-FLIGHT detection in
-- RUNBOOK.md shows the live `id` lacks PRIMARY KEY.
--
-- Modeled on the documented rebuild recipe in
-- mgmt/db/migration/2026-09-05/12-column-types-integer.sql PART 2
-- (CREATE new / INSERT SELECT / DROP / RENAME / recreate indexes).
-- ============================================================================

BEGIN TRANSACTION;

-- 1. New table with the CORRECT shape (matches mgmt/db/schema/core.sql exactly).
CREATE TABLE dropdown_lists_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_type TEXT,
  english_value TEXT,
  hindi_label TEXT,
  active TEXT,
  sort_order INTEGER
);

-- 2. Carry EVERY row forward, ids included, so existing references are preserved
--    (e.g. row id=1 'Lighting' keeps id=1).
INSERT INTO dropdown_lists_new (id, list_type, english_value, hindi_label, active, sort_order)
  SELECT id, list_type, english_value, hindi_label, active, sort_order FROM dropdown_lists;

-- 3. Replace the drifted table.
DROP TABLE dropdown_lists;
ALTER TABLE dropdown_lists_new RENAME TO dropdown_lists;

-- 4. Recreate the indexes the schema declares.
CREATE INDEX idx_dropdown_lists_list_type ON dropdown_lists(list_type);
CREATE INDEX idx_dropdown_lists_active ON dropdown_lists(active);

COMMIT;
