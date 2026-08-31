-- D1 database: collections
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "Collections"
DROP TABLE IF EXISTS collections;
CREATE TABLE collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year REAL,
  sl_no REAL,
  name TEXT,
  amount REAL,
  created_by TEXT,
  payment_mode TEXT,
  date TEXT,
  contribution_type REAL,
  detail TEXT,
  certificate_or_receipt TEXT,
  utr REAL,
  is_resell TEXT,
  announced TEXT,
  announcedcount REAL
);
CREATE INDEX idx_collections_year ON collections(year);
CREATE INDEX idx_collections_payment_mode ON collections(payment_mode);
CREATE INDEX idx_collections_contribution_type ON collections(contribution_type);
CREATE INDEX idx_collections_announced ON collections(announced);

