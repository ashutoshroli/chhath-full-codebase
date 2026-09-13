-- ============================================================================
-- Donation settings — 2026-09-13  ·  DB: chhath-core
--
-- RUN THIS FILE AGAINST **chhath-core** ONLY:
--   wrangler d1 execute chhath-core --remote --file=./migration/2026-09-05/30-donation-settings.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-core --local --file=./migration/2026-09-05/30-donation-settings.sql
--
-- Backs the public "Donate Now" page. Every donation field is DB-driven (edited
-- from the mgmt "Donation" tab), stored in the existing key/value
-- portal_settings table — exactly like journey_tagline_en/_hi:
--   donation_upi_id             UPI VPA shown + used for the QR/ID line
--   donation_qr_url             public R2 URL of the uploaded UPI QR image
--   donation_bank_account_name  bank A/C holder name
--   donation_bank_name          bank name
--   donation_account_number     bank account number
--   donation_ifsc               IFSC code
--   donation_whatsapp           WhatsApp number for sending payment proof
--
-- Values are seeded EMPTY on purpose: there is no real payment data to commit to
-- the repo, and the mgmt "Donation" tab writes the real values via
-- setPortalSetting. The public page hides any field that is still empty (e.g. the
-- QR image is only shown when donation_qr_url is set).
--
-- Fully idempotent: every seed INSERT is guarded by WHERE NOT EXISTS, so a second
-- run adds nothing and never overwrites values an admin has already entered.
-- Nothing is dropped or modified. The portal_settings table itself already exists
-- (schema/core.sql); no schema change here.
-- ============================================================================

INSERT INTO portal_settings ("key", value)
SELECT 'donation_upi_id', ''
WHERE NOT EXISTS (SELECT 1 FROM portal_settings WHERE "key" = 'donation_upi_id');

INSERT INTO portal_settings ("key", value)
SELECT 'donation_qr_url', ''
WHERE NOT EXISTS (SELECT 1 FROM portal_settings WHERE "key" = 'donation_qr_url');

INSERT INTO portal_settings ("key", value)
SELECT 'donation_bank_account_name', ''
WHERE NOT EXISTS (SELECT 1 FROM portal_settings WHERE "key" = 'donation_bank_account_name');

INSERT INTO portal_settings ("key", value)
SELECT 'donation_bank_name', ''
WHERE NOT EXISTS (SELECT 1 FROM portal_settings WHERE "key" = 'donation_bank_name');

INSERT INTO portal_settings ("key", value)
SELECT 'donation_account_number', ''
WHERE NOT EXISTS (SELECT 1 FROM portal_settings WHERE "key" = 'donation_account_number');

INSERT INTO portal_settings ("key", value)
SELECT 'donation_ifsc', ''
WHERE NOT EXISTS (SELECT 1 FROM portal_settings WHERE "key" = 'donation_ifsc');

INSERT INTO portal_settings ("key", value)
SELECT 'donation_whatsapp', ''
WHERE NOT EXISTS (SELECT 1 FROM portal_settings WHERE "key" = 'donation_whatsapp');
