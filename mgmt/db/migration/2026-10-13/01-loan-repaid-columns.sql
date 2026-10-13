-- ============================================================================
-- Loan repayment columns — 2026-10-13  ·  DB: chhath-loans-expenses
--
-- RUN THIS FILE AGAINST **chhath-loans-expenses** ONLY, BEFORE deploying the code
-- that adds "Mark as Repaid" (the Worker reads and writes these columns):
--   npx wrangler d1 execute chhath-loans-expenses --remote --file=mgmt/db/migration/2026-10-13/01-loan-repaid-columns.sql
--
-- Check first that they are not already there:
--   npx wrangler d1 execute chhath-loans-expenses --remote --command "PRAGMA table_info(loans)"
--
-- The DISBURSEMENT split already lives in cash_amount / online_amount. Repayment
-- gets its own columns so recording the money coming back never overwrites the
-- record of the money going out.
--
--   repaid_cash_amount, repaid_online_amount  Cash + Online = principal + interest
--                                             (no partial repayment)
--   repaid_date   YYYY-MM-DD (IST) — the date the money came back (form field)
--   repaid_at     UTC ISO — when the entry was recorded
--   repaid_by     login name that recorded it
--
-- Only new NULL columns are added. No existing row or value changes.
--
-- NOTE: SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so this file is
-- NOT idempotent — a second run fails with "duplicate column name", which is
-- harmless (the column is already there). The committed schema
-- (schema/loans_expenses.sql) already declares these columns, which is how the
-- migration test records this file. Run it ONCE.
-- ============================================================================

ALTER TABLE loans ADD COLUMN repaid_cash_amount REAL CHECK (repaid_cash_amount IS NULL OR repaid_cash_amount >= 0);
ALTER TABLE loans ADD COLUMN repaid_online_amount REAL CHECK (repaid_online_amount IS NULL OR repaid_online_amount >= 0);
ALTER TABLE loans ADD COLUMN repaid_date TEXT;
ALTER TABLE loans ADD COLUMN repaid_at TEXT;
ALTER TABLE loans ADD COLUMN repaid_by TEXT;
