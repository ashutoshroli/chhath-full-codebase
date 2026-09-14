-- ============================================================================
-- RESET PORTAL DATA — SECTION 1 of 8
-- database: chhath-core            (binding DB_CORE)
--
-- Run ONLY after the previews in RUNBOOK.md look right and a backup exists.
--   npx wrangler d1 execute chhath-core --remote --file mgmt/db/cleanup/2026-09-14-reset-portal-data/01-core.sql
--
-- KEEPS (untouched — these are configuration, not test data):
--   portal_settings   donation details, SEO, Journey page text, public_data_version
--   journey_entries   the 2017-2026 Journey story
--   dropdown_lists    every mgmt dropdown (payment mode, category, designation, ...)
--
-- TRIMS to one row:
--   users             keeps id_code = 'USER0001'
--   login_users       keeps name    = 'USER0001'   (login name == users.id_code)
--
-- EMPTIES:
--   committee_members, push_subscriptions, manual_years, locked_years,
--   festival_dates
-- ============================================================================


-- ---------------------------------------------------------------- users
-- Keeps the single LOWEST-id row whose id_code is 'USER0001' and deletes every
-- other row.
--
-- FAILS SAFE: if no USER0001 row exists, the subquery is NULL, `id NOT IN (NULL)`
-- is NULL, and NOTHING is deleted. So a wrong/missing id_code cannot wipe the
-- table -- you get an unchanged table and the VERIFY count at the bottom tells
-- you. Fix the identity and re-run rather than editing this to be less careful.
--
-- Using MIN(id) also survives the duplicate-id_code case that migration
-- 2026-09-05/07 warns about.
DELETE FROM users
 WHERE id NOT IN (
   SELECT MIN(id) FROM users WHERE TRIM(COALESCE(id_code, '')) = 'USER0001'
 );

-- Renumber the survivor to id 1.
--
-- The `COUNT(*) = 1` guard is essential, not decorative. On the fail-safe path
-- above (no USER0001, nothing deleted) the table still holds many rows, and
-- without this guard the UPDATE would try to give them all id 1 and abort the
-- whole file with "UNIQUE constraint failed: users.id". With the guard, the
-- renumber simply does not happen and the file completes, leaving the data
-- untouched for you to inspect.
UPDATE users SET id = 1
 WHERE id <> 1 AND (SELECT COUNT(*) FROM users) = 1;

-- AUTOINCREMENT reset. With the sqlite_sequence row gone, SQLite recomputes the
-- next rowid from MAX(id), so the next member created becomes id 2.
-- id_code needs no reset: it is allocated as MAX(SUBSTR(id_code,5))+1, so keeping
-- USER0001 makes the next member USER0002 automatically.
DELETE FROM sqlite_sequence WHERE name = 'users';


-- ---------------------------------------------------------------- login_users
-- Same shape as users. The login name IS the member's id_code (see
-- mgmt/backend/src/whatsapp.js:589 and :450).
--
-- ⚠️ If the preview showed this account's `name` is NOT literally 'USER0001',
-- change the literal below to whatever the preview printed BEFORE running this
-- file. Getting it wrong deletes nothing (fails safe), it does not lock you out.
DELETE FROM login_users
 WHERE id NOT IN (
   SELECT MIN(id) FROM login_users WHERE TRIM(COALESCE(name, '')) = 'USER0001'
 );

-- Same COUNT(*) = 1 guard as users, for the same reason.
UPDATE login_users SET id = 1
 WHERE id <> 1 AND (SELECT COUNT(*) FROM login_users) = 1;

DELETE FROM sqlite_sequence WHERE name = 'login_users';


-- ---------------------------------------------------------------- full clears
DELETE FROM committee_members;
DELETE FROM sqlite_sequence WHERE name = 'committee_members';

DELETE FROM push_subscriptions;
DELETE FROM sqlite_sequence WHERE name = 'push_subscriptions';

DELETE FROM manual_years;
DELETE FROM sqlite_sequence WHERE name = 'manual_years';

DELETE FROM locked_years;
DELETE FROM sqlite_sequence WHERE name = 'locked_years';

DELETE FROM festival_dates;
DELETE FROM sqlite_sequence WHERE name = 'festival_dates';


-- ---------------------------------------------------------------- VERIFY
-- Expected: users_kept 1, users_id 1, login_kept 1, login_id 1,
--           every *_rows 0, and the three config tables NON-zero.
SELECT
  (SELECT COUNT(*) FROM users)                                  AS users_kept,
  (SELECT COALESCE(MIN(id), 0) FROM users)                      AS users_id,
  (SELECT COALESCE(MIN(id_code), '') FROM users)                AS users_id_code,
  (SELECT COUNT(*) FROM login_users)                            AS login_kept,
  (SELECT COALESCE(MIN(id), 0) FROM login_users)                AS login_id,
  (SELECT COALESCE(MIN(role), '') FROM login_users)             AS login_role,
  (SELECT COUNT(*) FROM committee_members)                      AS committee_rows,
  (SELECT COUNT(*) FROM push_subscriptions)                     AS push_rows,
  (SELECT COUNT(*) FROM manual_years)                           AS manual_years_rows,
  (SELECT COUNT(*) FROM locked_years)                           AS locked_years_rows,
  (SELECT COUNT(*) FROM festival_dates)                         AS festival_dates_rows,
  (SELECT COUNT(*) FROM portal_settings)                        AS kept_portal_settings,
  (SELECT COUNT(*) FROM journey_entries)                        AS kept_journey_entries,
  (SELECT COUNT(*) FROM dropdown_lists)                         AS kept_dropdown_lists;
