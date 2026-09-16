-- D1 database: loans_expenses
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "LOAN_CONSENTS"
DROP TABLE IF EXISTS loan_consents;
CREATE TABLE loan_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consent_id TEXT,
  loan_id TEXT,
  person_id TEXT,
  role TEXT,
  token TEXT,
  status TEXT,
  otp INTEGER,                -- audit M-33: was REAL. 6-digit OTP generated without leading zeros (see random.js).
  otp_verified TEXT,
  send_count INTEGER,         -- audit M-33: was REAL. Integer counter.
  created_at TEXT,
  responded_at TEXT,
  device_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  geo_lat REAL,               -- stays REAL: fractional GPS coordinate.
  geo_lng REAL,               -- stays REAL: fractional GPS coordinate.
  geo_accuracy REAL,          -- stays REAL: fractional metres.
  photo_url TEXT,
  signature_url TEXT,
  decline_remarks TEXT,
  verification_status TEXT,
  verification_remarks TEXT,
  verified_by TEXT,
  verified_at TEXT,
  -- audit M-35: role is only ever 'loaner' or 'guarantor' (loans.js writes exactly
  -- these two). CHECK allows NULL/'' for legacy rows but rejects any other value.
  -- Unlike a FK, a CHECK IS reliably enforced by D1, so this is real, not advisory.
  CHECK (role IS NULL OR role IN ('loaner', 'guarantor'))
);
CREATE INDEX idx_loan_consents_loan_id ON loan_consents(loan_id);
CREATE INDEX idx_loan_consents_token ON loan_consents(token);
CREATE INDEX idx_loan_consents_person_id ON loan_consents(person_id);

-- source sheet: "LOAN_MESSAGE_TEMPLATES"
DROP TABLE IF EXISTS loan_message_templates;
CREATE TABLE loan_message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT,
  type TEXT,
  text TEXT,
  active TEXT,
  created_at TEXT,
  message_type TEXT,
  file_link TEXT
);

-- EMAIL channel for loan notifications (Resend). Mirrors loan_message_templates
-- (same `type` system) plus a `subject` column, since email needs a subject.
-- Personal loan notifications (consent link, OTP, accepted/verified, disbursed)
-- are also emailed to the loaner/guarantor's users.email. The send side reuses
-- the shared email_messages queue (in the whatsapp-index DB) drained by the
-- Worker via Resend — see mgmt/backend/src/email.js. Group types are NOT emailed
-- (email has no group concept); they are kept here only for parity/consistency.
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

-- source sheet: "EXPENSES"
DROP TABLE IF EXISTS expenses;
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,              -- audit M-33: was REAL. Whole year.
  discription TEXT,
  amount REAL,               -- stays REAL: fractional money (feeds SUM()).
  created_by TEXT,
  category TEXT,
  discription_hindi TEXT,
  -- audit M-35: money is never negative. NULL allowed (legacy/blank).
  CHECK (amount IS NULL OR amount >= 0)
);
CREATE INDEX idx_expenses_year ON expenses(year);
CREATE INDEX idx_expenses_category ON expenses(category);

-- source sheet: "Loans"
DROP TABLE IF EXISTS loans;
CREATE TABLE loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,              -- audit M-33: was REAL. Whole year.
  name TEXT,
  amount REAL,               -- stays REAL: fractional money (feeds SUM()).
  intrest_rate REAL,         -- stays REAL: percentage, can be fractional.
  tenure INTEGER,            -- audit M-33: was REAL. Whole months.
  signature TEXT,
  loan_documents TEXT,
  created_by TEXT,
  status TEXT,
  loan_id TEXT,
  loan_status TEXT,
  final_repayment_date TEXT,
  cash_amount REAL,          -- stays REAL: fractional money.
  online_amount REAL,        -- stays REAL: fractional money.
  -- audit M-35: money is never negative. NULL allowed (legacy/blank).
  CHECK (amount IS NULL OR amount >= 0)
);
CREATE INDEX idx_loans_year ON loans(year);
CREATE INDEX idx_loans_loan_id ON loans(loan_id);
CREATE INDEX idx_loans_status ON loans(status);

-- source sheet: "Loan Guarantor"
DROP TABLE IF EXISTS loan_guarantors;
CREATE TABLE loan_guarantors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,              -- audit M-33: was REAL. Whole year.
  loaner TEXT,
  guarantor TEXT,
  guarantor_signature TEXT,
  created_by TEXT,
  loan_id TEXT
);
CREATE INDEX idx_loan_guarantors_loan_id ON loan_guarantors(loan_id);



-- ============================================================================
-- INDEXES AND CONSTRAINTS THAT USED TO EXIST ONLY IN A MIGRATION
--
-- Everything below was created by a file under db/migration/ and was NOT in this
-- schema, which meant a database built from this file alone was missing it. That is
-- the wrong direction of drift: the test suite applies THIS file, so it was more
-- permissive than production -- a duplicate the live database rejects, the tests
-- accepted. (Proven at the time: a duplicate `error_log.error_id` inserted cleanly
-- against the committed schema while production has uq_error_log_error_id.)
--
-- This file is now the END STATE. A fresh database needs this file and nothing else.
-- schema-is-the-end-state.test.mjs fails if a migration ever creates an index or adds
-- a column that is not also here.
-- ============================================================================

-- from migration/02-perf-indexes.sql
CREATE INDEX IF NOT EXISTS idx_loan_consents_status
  ON loan_consents (status);

-- from migration/03-scalability-indexes.sql
CREATE INDEX IF NOT EXISTS idx_loans_name
  ON loans (name);

-- from migration/03-scalability-indexes.sql
CREATE INDEX IF NOT EXISTS idx_loan_guarantors_guarantor
  ON loan_guarantors (guarantor);

-- from migration/02-loans-expenses-indexes.sql
CREATE INDEX IF NOT EXISTS idx_loan_consents_consent_id
  ON loan_consents (consent_id);

-- from migration/02-loans-expenses-indexes.sql
CREATE INDEX IF NOT EXISTS idx_loan_consents_role
  ON loan_consents (role);

-- from migration/02-loans-expenses-indexes.sql
CREATE INDEX IF NOT EXISTS idx_loan_consents_verification_status
  ON loan_consents (verification_status);

-- from migration/02-loans-expenses-indexes.sql
CREATE INDEX IF NOT EXISTS idx_loan_consents_responded_at
  ON loan_consents (responded_at);

-- from migration/02-loans-expenses-indexes.sql
CREATE INDEX IF NOT EXISTS idx_loan_message_templates_type
  ON loan_message_templates (type);

-- from migration/02-loans-expenses-indexes.sql
CREATE INDEX IF NOT EXISTS idx_loan_guarantors_year_loaner
  ON loan_guarantors (year, loaner);

-- from migration/36-loans-keys-and-relations.sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_loans_loan_id
  ON loans (loan_id) WHERE loan_id IS NOT NULL AND loan_id <> '';


-- ============================================================================
-- THE LOAN RELATIONS (audit M-34 / H-8) — enforced, not described
--
-- These four triggers used to exist only in migration 36-loans-keys-and-relations.sql,
-- so a database built from this schema alone had NO enforcement of the relationship at
-- all: a consent or guarantor row could name a loan that does not exist, which is
-- exactly the H-8 orphan the audit found.
--
-- Why triggers rather than a FOREIGN KEY: D1 does not persist `PRAGMA foreign_keys`
-- across requests, so a declared FK would be documentation and these would still be
-- what actually enforces it. The blank/NULL exemption is deliberate — legacy rows
-- predate `loan_id`, and a row with no reference is not a broken reference.
--
-- Both verbs are covered. An insert-only guard is half a guard: it stops a row being
-- created against a missing loan and then allows the same row to be re-pointed at one
-- a moment later.
--
-- NOTE: there is deliberately NO `BEFORE DELETE ON loans` guard. `deleteLoan`
-- (loans.js) sends one batch whose FIRST statement deletes the loan and whose last two
-- delete the children, so a delete guard would abort the application's own correct
-- deletion. See migration 36 for the full reasoning.
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS trg_loan_consents_loan_fk_ins
BEFORE INSERT ON loan_consents
FOR EACH ROW WHEN NEW.loan_id IS NOT NULL AND NEW.loan_id <> ''
  AND NOT EXISTS (SELECT 1 FROM loans WHERE loan_id = NEW.loan_id)
BEGIN
  SELECT RAISE(ABORT, 'loan_consents.loan_id references a loan that does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_loan_consents_loan_fk_upd
BEFORE UPDATE OF loan_id ON loan_consents
FOR EACH ROW WHEN NEW.loan_id IS NOT NULL AND NEW.loan_id <> ''
  AND NOT EXISTS (SELECT 1 FROM loans WHERE loan_id = NEW.loan_id)
BEGIN
  SELECT RAISE(ABORT, 'loan_consents.loan_id would be re-pointed at a loan that does not exist');
END;

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
