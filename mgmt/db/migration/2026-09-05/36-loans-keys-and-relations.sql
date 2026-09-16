-- ============================================================================
-- audit M-34 / H-8 / PR-34 — enforce the loan relations
-- Database: chhath-loans-expenses
--
-- migration 10 shipped three things as comments: a detection query set (PART 1),
-- insert-only triggers (PART 2), and a full FK table rebuild (PART 3). It applied
-- nothing — it is 101 comment lines and zero executable ones.
--
-- PART 1 has now been run. `getIntegrityReport` (PR-33) ran against the live
-- databases on 2026-09-16:
--
--   dup_loan_id             0 findings
--   orphan_consent_loan     0 findings   (the H-8 case)
--   orphan_guarantor_loan   0 findings
--
-- so the parent key can be made unique and the triggers can be applied without
-- either failing. RE-RUN THAT REPORT IF THIS FILE HAS BEEN SITTING UNAPPLIED: an
-- orphan created since would make the triggers start rejecting writes to a loan_id
-- that is already broken, which is a confusing way to find out.
--
-- WHAT IS **NOT** HERE, AND WHY
--
-- 1. THE REAL FOREIGN KEY (10's PART 3). It needs a full table rebuild — CREATE new /
--    INSERT SELECT / DROP / RENAME — on live, spreadsheet-sourced data. And D1 does
--    not persist `PRAGMA foreign_keys` across requests, so even after the rebuild the
--    FK would be documentation and these triggers would still be what actually
--    enforces it. The rebuild buys a self-describing schema, not enforcement, so it is
--    not worth doing in the same change as the enforcement itself.
--
-- 2. A `BEFORE DELETE ON loans` GUARD. This is the one that would have prevented H-8
--    in the first place, and it is deliberately absent: it would abort the
--    application's own correct deletion. `deleteLoan` (loans.js) sends ONE D1 batch
--    whose FIRST statement is `DELETE FROM loans WHERE id = ?` and whose LAST two
--    delete the guarantors and consents. A delete guard fires on that first statement,
--    while the children still exist, and aborts the whole batch — so loan deletion
--    would stop working. The batch is atomic, so the ordering is harmless today;
--    changing it to children-first is an application change and belongs with the code,
--    not inside a migration.
--
-- 3. CHECK CONSTRAINTS (migration 11). Also a table rebuild, and 11 itself says to
--    combine it with the REAL->INTEGER rebuild in 12. That is one coordinated rebuild
--    of the money tables, not a line in this file.
--
-- WHAT IS NEW HERE that migration 10 did not have: the **UPDATE** triggers. 10's
-- PART 2 has `BEFORE INSERT` only, which the audit flagged directly — "proposed
-- triggers omit update cases". An insert-only guard is half a guard: it stops a row
-- being CREATED against a missing loan, and then allows the same row to be re-pointed
-- at a missing loan by an UPDATE a moment later. Both directions are covered below.
--
-- Idempotent (all IF NOT EXISTS). Additive: one index and four triggers, no row is
-- read, written or moved.
--
-- Apply with:
--   wrangler d1 execute chhath-loans-expenses --remote --file=./36-loans-keys-and-relations.sql
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The parent key. A relationship needs the thing it points AT to be unique,
--    and a duplicate loan_id silently merges two loans' consent sets: every consent
--    for either loan appears under both, so the accepted/pending/declined counts
--    printed on a consent PDF are wrong for both.
--
--    PARTIAL, so legacy rows saved before `loan_id` existed (NULL/blank) are exempt
--    and need no backfill.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_loans_loan_id
  ON loans (loan_id) WHERE loan_id IS NOT NULL AND loan_id <> '';


-- ---------------------------------------------------------------------------
-- 2. loan_consents.loan_id must name a loan that exists.
--
--    The blank/NULL exemption matters: legacy consent rows predate loan_id, and a
--    row with no reference is not a broken reference. `saveLoanTransaction` always
--    inserts a consent with the loan_id of the loan it just created, so these never
--    fire for a legitimate save.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_loan_consents_loan_fk_ins
BEFORE INSERT ON loan_consents
FOR EACH ROW WHEN NEW.loan_id IS NOT NULL AND NEW.loan_id <> ''
  AND NOT EXISTS (SELECT 1 FROM loans WHERE loan_id = NEW.loan_id)
BEGIN
  SELECT RAISE(ABORT, 'loan_consents.loan_id references a loan that does not exist');
END;

-- The half migration 10 was missing. Without it, a consent can be re-pointed at a
-- loan that is not there — the same orphan H-8 produced, reached by a different verb.
CREATE TRIGGER IF NOT EXISTS trg_loan_consents_loan_fk_upd
BEFORE UPDATE OF loan_id ON loan_consents
FOR EACH ROW WHEN NEW.loan_id IS NOT NULL AND NEW.loan_id <> ''
  AND NOT EXISTS (SELECT 1 FROM loans WHERE loan_id = NEW.loan_id)
BEGIN
  SELECT RAISE(ABORT, 'loan_consents.loan_id would be re-pointed at a loan that does not exist');
END;


-- ---------------------------------------------------------------------------
-- 3. The same pair for loan_guarantors.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_loan_guarantors_loan_fk_ins
BEFORE INSERT ON loan_guarantors
FOR EACH ROW WHEN NEW.loan_id IS NOT NULL AND NEW.loan_id <> ''
  AND NOT EXISTS (SELECT 1 FROM loans WHERE loan_id = NEW.loan_id)
BEGIN
  SELECT RAISE(ABORT, 'loan_guarantors.loan_id references a loan that does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_loan_guarantors_loan_fk_upd
BEFORE UPDATE OF loan_id ON loan_guarantors
FOR EACH ROW WHEN NEW.loan_id IS NOT NULL AND NEW.loan_id <> ''
  AND NOT EXISTS (SELECT 1 FROM loans WHERE loan_id = NEW.loan_id)
BEGIN
  SELECT RAISE(ABORT, 'loan_guarantors.loan_id would be re-pointed at a loan that does not exist');
END;
