-- D1 database: collections
-- Generated from live Google Sheet export (__नवय_वक_छठ_प_ज__सम_त__शहरप_र____-_Web_App.xlsx)

-- source sheet: "Collections"
DROP TABLE IF EXISTS collections;
CREATE TABLE collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,               -- audit M-33: was REAL (Sheet export). Whole year, only ever parseInt-compared.
  sl_no INTEGER,              -- audit M-33: was REAL. Sequential integer allocated via MAX(sl_no)+1.
  name TEXT,
  amount REAL,                -- stays REAL: genuinely fractional money (feeds SUM()).
  created_by TEXT,
  payment_mode TEXT,
  date TEXT,
  contribution_type INTEGER,  -- audit M-33: was REAL. Only ever 1-4, no leading zeros.
  detail TEXT,
  certificate_or_receipt TEXT,
  utr TEXT,                   -- audit M-33: was REAL. A UTR is a long identifier; REAL dropped leading zeros + precision.
  is_resell TEXT,
  announced TEXT,
  announcedcount INTEGER,     -- audit M-33: was REAL. Integer counter (COALESCE(...)+1).
  -- audit M-35: a contribution amount is never negative. NULL allowed (legacy/blank).
  CHECK (amount IS NULL OR amount >= 0)
);
CREATE INDEX idx_collections_year ON collections(year);
CREATE INDEX idx_collections_payment_mode ON collections(payment_mode);
CREATE INDEX idx_collections_contribution_type ON collections(contribution_type);
CREATE INDEX idx_collections_announced ON collections(announced);

