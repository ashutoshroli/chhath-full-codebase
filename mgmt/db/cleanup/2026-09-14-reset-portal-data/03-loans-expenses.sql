-- ============================================================================
-- RESET PORTAL DATA — SECTION 3 of 8
-- database: chhath-loans-expenses  (binding DB_LOANS_EXPENSES)
--
--   npx wrangler d1 execute chhath-loans-expenses --remote --file mgmt/db/cleanup/2026-09-14-reset-portal-data/03-loans-expenses.sql
--
-- ⚠️ RUN THE FILE-URL EXPORT IN RUNBOOK.md STEP 3 FIRST.
-- loan_consents holds the only pointers to the consent photos and signatures in
-- R2 / Drive. Once these rows are gone those files are unreachable and can never
-- be found again.
--
-- KEEPS (configuration): loan_message_templates, loan_email_templates
-- EMPTIES: loans, expenses, loan_guarantors, loan_consents
-- ============================================================================

DELETE FROM loan_consents;
DELETE FROM sqlite_sequence WHERE name = 'loan_consents';

DELETE FROM loan_guarantors;
DELETE FROM sqlite_sequence WHERE name = 'loan_guarantors';

DELETE FROM loans;
DELETE FROM sqlite_sequence WHERE name = 'loans';

DELETE FROM expenses;
DELETE FROM sqlite_sequence WHERE name = 'expenses';

-- ---------------------------------------------------------------- VERIFY
-- Expected: the four *_rows 0, the two kept_* NON-zero.
SELECT
  (SELECT COUNT(*) FROM loans)                   AS loans_rows,
  (SELECT COUNT(*) FROM expenses)                AS expenses_rows,
  (SELECT COUNT(*) FROM loan_guarantors)         AS guarantors_rows,
  (SELECT COUNT(*) FROM loan_consents)           AS consents_rows,
  (SELECT COUNT(*) FROM loan_message_templates)  AS kept_loan_msg_templates,
  (SELECT COUNT(*) FROM loan_email_templates)    AS kept_loan_email_templates;
