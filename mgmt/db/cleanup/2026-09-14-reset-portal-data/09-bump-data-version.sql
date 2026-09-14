-- ============================================================================
-- RESET PORTAL DATA — FINAL STEP. RUN THIS LAST.
-- database: chhath-core            (binding DB_CORE)
--
--   npx wrangler d1 execute chhath-core --remote --file mgmt/db/cleanup/2026-09-14-reset-portal-data/09-bump-data-version.sql
--
-- Without this the public portal keeps serving the OLD data for up to 30 days,
-- and every visitor's browser keeps its own stale copy. Emptying the databases is
-- not enough on its own.
--
-- There are three caches between D1 and a visitor's screen:
--
--   portal_settings.public_data_version     the counter this file bumps
--        |
--   KV  pub:snapshot:portalData             last-known-good snapshot, 30-DAY TTL.
--        |                                  The public Worker rewrites it ONLY
--        |                                  when the version differs from
--        |                                  pub:snapshot:portalData:version, and
--        |                                  serves it whenever D1 fails or the
--        |                                  daily read budget is nearly spent.
--        v
--   browser  cpm_public_portalData_v4       localStorage copy, invalidated by
--                                           cpm_public_dataVersion_v4
--
-- One bump invalidates all three: the Worker sees a new version, rebuilds the
-- snapshot from the now-empty database, and every browser refetches because the
-- version it stored no longer matches. The response ETag changes for the same
-- reason.
--
-- This is the same UPSERT the app itself uses (mgmt/backend/src/dataVersion.js
-- bumpDataVersion). It depends on the UNIQUE index on portal_settings("key")
-- created by migration 2026-09-01/08-public-data-version.sql -- if that index is
-- missing the ON CONFLICT clause has nothing to match and the bump silently does
-- nothing, so the VERIFY below matters.
-- ============================================================================

INSERT INTO portal_settings ("key", value) VALUES ('public_data_version', '1')
  ON CONFLICT("key") DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT);

-- ---------------------------------------------------------------- VERIFY
-- new_version must be HIGHER than it was before this file ran. If it is
-- unchanged, the UNIQUE index is missing: apply
-- mgmt/db/migration/2026-09-01/08-public-data-version.sql and run this again.
SELECT value AS new_version
  FROM portal_settings
 WHERE "key" = 'public_data_version';
