-- ============================================================================
-- push_subscriptions table — 2026-09-14  ·  DB: chhath-core
--
-- RUN THIS FILE AGAINST **chhath-core** ONLY:
--   wrangler d1 execute chhath-core --remote --file=./migration/2026-09-05/31-push-subscriptions.sql
--
-- Test locally first (safe, hits the local replica):
--   wrangler d1 execute chhath-core --local --file=./migration/2026-09-05/31-push-subscriptions.sql
--
-- Web Push subscriptions for the PUBLIC portal. A visitor opts in from the portal
-- (guide page), the browser hands us a PushSubscription, and the PUBLIC worker
-- upserts it here (?action=savePushSubscription). The MGMT worker later reads this
-- table to broadcast — automatically when a new contribution is added, and
-- manually from the "Custom Notification" tab.
--
-- Both workers bind this same physical database (chhath-core), which is why the
-- table lives here rather than in a per-feature DB.
--
-- Columns:
--   endpoint    the push service URL — the subscription's identity (UNIQUE).
--   p256dh/auth the subscription's public key + auth secret, used to encrypt the
--               payload (RFC 8291 aes128gcm). Opaque base64url strings.
--   user_agent  coarse UA string, only to help debug delivery per browser.
--   active      0 after the push service reports the endpoint is gone (404/410),
--               so dead endpoints stop being retried but stay auditable.
--   last_error  last delivery error, for the same reason.
--
-- NOTE: no personal data is stored — an endpoint is an opaque browser handle, not
-- an identity, and it is never joined to a contributor/user row.
--
-- Fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS only). Nothing is dropped,
-- no row is modified, and it is safe to run twice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT,
  user_agent TEXT,
  active INTEGER DEFAULT 1,
  last_error TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active ON push_subscriptions(active);
