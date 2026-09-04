-- ============================================================================
-- Missing indexes — 2026-09-05  ·  DB: chhath-core        (audit H-10)
--
-- RUN THIS FILE AGAINST **chhath-core** ONLY:
--   wrangler d1 execute chhath-core --remote --file=./migration/2026-09-05/01-core-indexes.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-core --local --file=./migration/2026-09-05/01-core-indexes.sql
--
-- Fully idempotent (CREATE INDEX IF NOT EXISTS only). Nothing is dropped, no row
-- is modified, and it is safe to run twice.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- users.id_code — THE single hottest lookup in the whole portal, and it had no
-- index at all.
--
-- schema/core.sql only indexes `village` and `mobile`. Meanwhile views.js's
-- comment claims "indexed: idx_users... on id_code" — it never existed. Every one
-- of these does `WHERE id_code = ?`:
--     getUserProfile()            the user's own row
--     getUserProfile()            once MORE per referenced loaner
--     getUserHistory()            (via the collections join)
--     senderNumberForLogin()      the WhatsApp "from" number
--     reportErrorToWhatsApp()     the Superadmin numbers
-- so opening one member profile was several FULL SCANS of a 32,000-row table.
--
-- On the free tier D1 allows 5,000,000 row reads per DAY across all nine
-- databases, so a handful of profile opens could previously consume a noticeable
-- slice of the daily budget. Each of those reads also counts as a SUBREQUEST, and
-- the free plan caps a single Worker invocation at 50.
CREATE INDEX IF NOT EXISTS idx_users_id_code ON users (id_code);

-- users.name — the contributor picker and several joins match on the display name.
CREATE INDEX IF NOT EXISTS idx_users_name ON users (name);

-- login_users.role — reportErrorToWhatsApp()'s fallback does
-- `WHERE role = 'Superadmin'`. The table is small, but the index is free.
CREATE INDEX IF NOT EXISTS idx_login_users_role ON login_users (role);

-- portal_settings("key") — every request reads the public data-version through it,
-- and dataVersion.js's atomic UPSERT needs a UNIQUE index for its ON CONFLICT to
-- fire at all. Migration 2026-09-01/08 already creates this; repeated here with
-- IF NOT EXISTS so a deployment that skipped that file is still correct, since
-- without it bumpDataVersion() silently falls back to a racy read-modify-write.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_settings_key ON portal_settings ("key");


-- ---------------------------------------------------------------------------
-- NOT INCLUDED, ON PURPOSE — uniqueness on users.id_code and login_users.name.
--
-- Both SHOULD be unique (a duplicate id_code means two members share an id;
-- a duplicate login_users.name makes findLoginRowByIdentifier()'s LIMIT 1
-- non-deterministic, i.e. which password is checked becomes arbitrary). But a
-- UNIQUE index FAILS if the live data already contains a duplicate, and this
-- portal launches on 25 October — a migration that aborts on production data is
-- not worth the risk right now.
--
-- Check first, and if both queries return no rows, apply the unique variants:
--
--   SELECT id_code, COUNT(*) c FROM users GROUP BY id_code HAVING c > 1;
--   SELECT name,    COUNT(*) c FROM login_users GROUP BY name HAVING c > 1;
--
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_users_id_code    ON users (id_code);
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_login_users_name ON login_users (name);
-- ---------------------------------------------------------------------------
