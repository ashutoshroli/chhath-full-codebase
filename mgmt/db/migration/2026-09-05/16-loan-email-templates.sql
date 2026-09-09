-- ============================================================================
-- Loan email templates (Resend) — 2026-09-05  ·  DB: chhath-loans-expenses
--
--   wrangler d1 execute chhath-loans-expenses --remote --file=./migration/2026-09-05/16-loan-email-templates.sql
--
-- Adds loan_email_templates: the email equivalent of loan_message_templates
-- (same `type` system) plus a `subject` column. Personal loan notifications are
-- also emailed to the loaner/guarantor's users.email. The send side reuses the
-- shared email_messages queue (added by migration 2026-09-05/15) drained by the
-- Worker via Resend — no new queue and no new secret.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS only. Nothing dropped, no row
-- modified. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS loan_email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT,
  type TEXT,
  subject TEXT,
  text TEXT,
  active TEXT,
  created_at TEXT,
  message_type TEXT,
  file_link TEXT
);
CREATE INDEX IF NOT EXISTS idx_loan_email_templates_type ON loan_email_templates(type);
