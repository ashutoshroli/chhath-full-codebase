-- D1 database: templates
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "SAMAAN_TEMPLATES"
DROP TABLE IF EXISTS samaan_templates;
CREATE TABLE samaan_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,              -- audit M-33: was REAL. Whole year (equality-matched in UNIQUE(doc_type, year)).
  template_text TEXT,
  page_size TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX idx_samaan_templates_year ON samaan_templates(year);

-- source sheet: "DOCX_TEMPLATES"
DROP TABLE IF EXISTS docx_templates;
CREATE TABLE docx_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT,
  year INTEGER,              -- audit M-33: was REAL. Whole year (equality-matched in UNIQUE(doc_type, year)).
  drive_file_id TEXT,
  file_name TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX idx_docx_templates_doc_type ON docx_templates(doc_type);
CREATE INDEX idx_docx_templates_year ON docx_templates(year);
-- upload/copy use SELECT-then-INSERT, so without this two concurrent uploads
-- could create two rows for the same (doc_type, year) and getDocxTemplate()'s
-- .first() would then pick one arbitrarily.
CREATE UNIQUE INDEX uq_docx_templates_type_year ON docx_templates(doc_type, year);

-- source sheet: "DOC_PDF_TEMPLATES"
DROP TABLE IF EXISTS doc_pdf_templates;
CREATE TABLE doc_pdf_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT,
  year INTEGER,              -- audit M-33: was REAL. Whole year (equality-matched in UNIQUE(doc_type, year)).
  schema_json TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX idx_doc_pdf_templates_doc_type ON doc_pdf_templates(doc_type);
CREATE INDEX idx_doc_pdf_templates_year ON doc_pdf_templates(year);

-- source sheet: "CERTIFICATE_TEMPLATES"
DROP TABLE IF EXISTS certificate_templates;
CREATE TABLE certificate_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,              -- audit M-33: was REAL. Whole year (equality-matched in UNIQUE(doc_type, year)).
  template_text TEXT,
  page_size TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX idx_certificate_templates_year ON certificate_templates(year);

-- source sheet: "RECEIPT_TEMPLATES"
DROP TABLE IF EXISTS receipt_templates;
CREATE TABLE receipt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,              -- audit M-33: was REAL. Whole year (equality-matched in UNIQUE(doc_type, year)).
  template_text TEXT,
  page_size TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX idx_receipt_templates_year ON receipt_templates(year);

-- source sheet: "CONSENT_PAGE_TEMPLATES"
DROP TABLE IF EXISTS consent_page_templates;
CREATE TABLE consent_page_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  text TEXT,
  updated_at TEXT
);

-- source sheet: "PDF_TEMPLATES"
DROP TABLE IF EXISTS pdf_templates;
CREATE TABLE pdf_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT,
  name TEXT,
  schema_json TEXT,
  created_at TEXT,
  updated_at TEXT
);

