-- D1 database: file_index
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "GENERATED_FILES"
DROP TABLE IF EXISTS generated_files;
CREATE TABLE generated_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT,
  year REAL,
  record_id TEXT,
  file_name TEXT,
  public_link TEXT,
  drive_path TEXT,
  generated_at TEXT
);
CREATE INDEX idx_generated_files_doc_type ON generated_files(doc_type);
CREATE INDEX idx_generated_files_year ON generated_files(year);
CREATE INDEX idx_generated_files_record_id ON generated_files(record_id);

