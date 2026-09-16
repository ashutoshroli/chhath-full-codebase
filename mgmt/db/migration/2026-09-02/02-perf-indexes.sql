-- ============================================================================
-- Performance indexes on hot lookup columns (audit 5.2)
--
-- Several high-frequency predicates were doing full table scans on D1/SQLite:
--   * loan_consents.token   — looked up on EVERY public consent request
--                             (getConsentByToken / requestConsentOtp /
--                             verifyConsentOtp / respondConsent / the public
--                             docx routes all call findConsentRowByToken).
--   * loan_consents.loan_id — joined on nearly every loan/consent read.
--   * login_users.mobile / login_users.email — the login path resolves a user by
--                             mobile or email (name is already indexed in core.sql).
--   * collections.year      — filtered on almost every collections read.
--
-- These are additive CREATE INDEX IF NOT EXISTS statements — nothing is dropped
-- or modified, and they are safe to run more than once.
--
-- ⚠️ This migration spans THREE databases. Run EACH section against the DB named
-- in its header, NOT all at once:
--
--   Section A -> chhath-loans-expenses
--   Section B -> chhath-core
--   Section C -> chhath-collections
--
-- Example (remote):
--   wrangler d1 execute chhath-loans-expenses --remote --command "CREATE INDEX IF NOT EXISTS idx_loan_consents_token ON loan_consents(token);"
--   ...or split this file into per-DB files and use --file. Test with --local first.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Section A — DB: chhath-loans-expenses
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_loan_consents_token   ON loan_consents(token);
CREATE INDEX IF NOT EXISTS idx_loan_consents_loan_id ON loan_consents(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_consents_status  ON loan_consents(status);
CREATE INDEX IF NOT EXISTS idx_loans_loan_id         ON loans(loan_id);
CREATE INDEX IF NOT EXISTS idx_loans_year            ON loans(year);
CREATE INDEX IF NOT EXISTS idx_loan_guarantors_loan_id ON loan_guarantors(loan_id);


-- ---------------------------------------------------------------------------
-- Section B — DB: chhath-core
-- (login_users.name is already indexed in schema/core.sql; add mobile + email.)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_login_users_mobile ON login_users(mobile);
CREATE INDEX IF NOT EXISTS idx_login_users_email  ON login_users(email);


-- ---------------------------------------------------------------------------
-- Section C — DB: chhath-collections
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_collections_year ON collections(year);
