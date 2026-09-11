-- ============================================================================
-- One-time cleanup of TEST-DATA ARTIFACTS found in the live databases
-- (QA/Security Audit, 2026-09-11, finding #7 — INFO / DATA CLEANUP).
--
-- Artifacts reported:
--   1. A test DESIGNATION "rtjhy" on a committee member (Sujit Kumar Verma).
--   2. A placeholder PHONE 7282032146 shared by several members.
--   3. Material/donation DETAIL text "Hv uv uv h kya".
--
-- These live in THREE different D1 databases, so this file is split into three
-- clearly-labelled sections. Run each section against the matching database.
--
-- SAFETY:
--   * NOTHING is deleted. Every statement only CLEARS a specific bad value
--     (sets it to '' ) on rows that currently hold exactly that value.
--   * Each section starts with SELECT "preview" queries so you can SEE exactly
--     which rows will change BEFORE running the UPDATEs. Run the SELECTs first;
--     only run the UPDATEs once the preview looks right.
--   * Matching is on the EXACT bad value, so a real member who legitimately has
--     a different designation/phone/detail is never touched.
--
-- HOW TO RUN (from the repo root, with wrangler configured for this account):
--   Preview first (safe, read-only) — copy just the SELECTs, or run the whole
--   file with --command per section. Recommended: run section-by-section.
--
--   # 1) core DB  (users + login_users)
--   npx wrangler d1 execute chhath-core --remote --file mgmt/db/cleanup/2026-09-11-test-data-artifacts.sql
--     ^ WRONG for a mixed file — instead run each section's SQL against its own
--       database with --command, e.g.:
--
--   # --- chhath-core ---
--   npx wrangler d1 execute chhath-core --remote --command "UPDATE users SET designation='' WHERE designation='rtjhy'; UPDATE users SET designation_hindi='' WHERE designation_hindi='rtjhy';"
--   npx wrangler d1 execute chhath-core --remote --command "UPDATE users SET mobile='' WHERE mobile='7282032146'; UPDATE users SET whatsapp='' WHERE whatsapp='7282032146';"
--   npx wrangler d1 execute chhath-core --remote --command "UPDATE login_users SET mobile='' WHERE mobile='7282032146';"
--
--   # --- chhath-collections ---
--   npx wrangler d1 execute chhath-collections --remote --command "UPDATE collections SET detail='' WHERE detail='Hv uv uv h kya';"
--
--   Drop --remote to run against the LOCAL dev DB first if you want a dry run.
--   Always take a backup (Superadmin → Backup & Restore, or `wrangler d1 export`)
--   before running the UPDATEs on --remote.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — database: chhath-core   (binding DB_CORE)
--   users.designation / users.designation_hindi  == 'rtjhy'
--   users.mobile / users.whatsapp                 == '7282032146'
--   login_users.mobile                            == '7282032146'
-- ============================================================================

-- ---- PREVIEW (read-only) — run these first and eyeball the rows ----
SELECT id, id_code, name, designation, designation_hindi
  FROM users
 WHERE designation = 'rtjhy' OR designation_hindi = 'rtjhy';

SELECT id, id_code, name, mobile, whatsapp
  FROM users
 WHERE mobile = '7282032146' OR whatsapp = '7282032146';

SELECT id, name, mobile
  FROM login_users
 WHERE mobile = '7282032146';

-- ---- APPLY — clears ONLY the exact bad values, touches nothing else ----
UPDATE users SET designation      = '' WHERE designation      = 'rtjhy';
UPDATE users SET designation_hindi = '' WHERE designation_hindi = 'rtjhy';

UPDATE users SET mobile   = '' WHERE mobile   = '7282032146';
UPDATE users SET whatsapp = '' WHERE whatsapp = '7282032146';

UPDATE login_users SET mobile = '' WHERE mobile = '7282032146';

-- ---- VERIFY (should all return 0 rows) ----
SELECT COUNT(*) AS remaining_designation FROM users WHERE designation = 'rtjhy' OR designation_hindi = 'rtjhy';
SELECT COUNT(*) AS remaining_phone_users FROM users WHERE mobile = '7282032146' OR whatsapp = '7282032146';
SELECT COUNT(*) AS remaining_phone_login FROM login_users WHERE mobile = '7282032146';


-- ============================================================================
-- SECTION 2 — database: chhath-collections   (binding DB_COLLECTIONS)
--   collections.detail == 'Hv uv uv h kya'
-- ============================================================================

-- ---- PREVIEW (read-only) ----
SELECT id, year, name, amount, detail
  FROM collections
 WHERE detail = 'Hv uv uv h kya';

-- ---- APPLY ----
UPDATE collections SET detail = '' WHERE detail = 'Hv uv uv h kya';

-- ---- VERIFY (should return 0) ----
SELECT COUNT(*) AS remaining_detail FROM collections WHERE detail = 'Hv uv uv h kya';
