-- ============================================================================
-- Scalability indexes (Phase 1) — support the mgmt read views that were changed
-- from full-table scans to indexed WHERE lookups (see mgmt/backend/src/views.js
-- getUserProfile / getUserHistory).
--
-- Without these, the new `WHERE name = ?` / `WHERE guarantor = ?` queries would
-- still do a full scan. With them, per-person profile/history reads are O(rows
-- for that person) instead of O(whole table).
--
-- Additive, idempotent (CREATE INDEX IF NOT EXISTS). Nothing is dropped.
--
-- ⚠️ Run each section against the DB named in its header:
--   Section A -> chhath-collections
--   Section B -> chhath-loans-expenses
--   Section C -> chhath-core
--
-- Example (remote):
--   wrangler d1 execute chhath-collections --remote --command "CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name);"
-- Test with --local first.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Section A — DB: chhath-collections
-- getUserHistory + getUserProfile.contributions read collections WHERE name = ?
-- (name stores the contributor's user id).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name);


-- ---------------------------------------------------------------------------
-- Section B — DB: chhath-loans-expenses
-- getUserProfile: loans WHERE name = ? (loans taken) and
-- loan_guarantors WHERE guarantor = ? (loans guaranteed for others).
-- idx_loans_loan_id + idx_loans_year already exist from 02-perf-indexes.sql.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_loans_name ON loans(name);
CREATE INDEX IF NOT EXISTS idx_loan_guarantors_guarantor ON loan_guarantors(guarantor);


-- ---------------------------------------------------------------------------
-- Section C — DB: chhath-core
-- getUserProfile.committeeYears reads committee_members WHERE name = ?.
-- (idx_committee_members_year already exists in schema/core.sql.)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_committee_members_name ON committee_members(name);
