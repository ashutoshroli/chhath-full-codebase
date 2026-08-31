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
  otp REAL,
  otp_verified TEXT,
  send_count REAL,
  created_at TEXT,
  responded_at TEXT,
  device_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  geo_lat REAL,
  geo_lng REAL,
  geo_accuracy REAL,
  photo_url TEXT,
  signature_url TEXT,
  decline_remarks TEXT,
  verification_status TEXT,
  verification_remarks TEXT,
  verified_by TEXT,
  verified_at TEXT
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

-- source sheet: "EXPENSES"
DROP TABLE IF EXISTS expenses;
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year REAL,
  discription TEXT,
  amount REAL,
  created_by TEXT,
  category TEXT,
  discription_hindi TEXT
);
CREATE INDEX idx_expenses_year ON expenses(year);
CREATE INDEX idx_expenses_category ON expenses(category);

-- source sheet: "Loans"
DROP TABLE IF EXISTS loans;
CREATE TABLE loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year REAL,
  name TEXT,
  amount REAL,
  intrest_rate REAL,
  tenure REAL,
  signature TEXT,
  loan_documents TEXT,
  created_by TEXT,
  status TEXT,
  loan_id TEXT,
  loan_status TEXT,
  final_repayment_date TEXT,
  cash_amount REAL,
  online_amount REAL
);
CREATE INDEX idx_loans_year ON loans(year);
CREATE INDEX idx_loans_loan_id ON loans(loan_id);
CREATE INDEX idx_loans_status ON loans(status);

-- source sheet: "Loan Guarantor"
DROP TABLE IF EXISTS loan_guarantors;
CREATE TABLE loan_guarantors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year REAL,
  loaner TEXT,
  guarantor TEXT,
  guarantor_signature TEXT,
  created_by TEXT,
  loan_id TEXT
);
CREATE INDEX idx_loan_guarantors_loan_id ON loan_guarantors(loan_id);

