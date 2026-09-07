// audit M-10 / H-12 prerequisite — checkConfig() surfaces a missing ALLOWED_ORIGINS
// as a NON-FATAL warning, so an operator can verify it in production BEFORE enabling
// CORS preflight (M-10) or cookie auth (H-12), either of which turns an unset
// ALLOWED_ORIGINS into a site-wide outage. See docs/CORS_COOKIE_MIGRATION.md.
//
// This is purely advisory: a missing ALLOWED_ORIGINS must NOT make the config
// "not ok" (the portal runs fine without it today), it must only warn.
//
// Run: node --test mgmt/backend/test/h12-m10-allowed-origins-warning.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConfig } from '../src/config.js';

// A fully-wired env so the ONLY variable under test is ALLOWED_ORIGINS.
function baseEnv(extra = {}) {
  return {
    DB_CORE: {}, DB_COLLECTIONS: {}, DB_LOANS_EXPENSES: {}, DB_TEMPLATES: {},
    DB_FILE_INDEX: {}, DB_WHATSAPP_INDEX: {}, DB_LOGS: {}, DB_MISC: {},
    KV_SESSIONS: {},
    PASSWORD_SALT: 'x',
    CONSENT_BASE_URL: 'https://mgmt.example.org/consent',
    // feature secrets present so they don't add noise
    WHATSAPP_QUEUE_API_KEY: 'k', DRIVE_FOLDER_ID: 'f', DRIVE_ROOT_FOLDER_ID: 'r',
    DRIVE_OAUTH_CLIENT_ID: 'c', DRIVE_OAUTH_CLIENT_SECRET: 's', DRIVE_OAUTH_REFRESH_TOKEN: 't',
    ...extra,
  };
}

const hasAllowedOriginsWarning = (cfg) =>
  cfg.featureWarnings.some(w => /ALLOWED_ORIGINS/.test(w));

test('M-10/H-12: an UNSET ALLOWED_ORIGINS produces a warning but keeps config OK', () => {
  const cfg = checkConfig(baseEnv()); // no ALLOWED_ORIGINS
  assert.ok(hasAllowedOriginsWarning(cfg), 'expected an ALLOWED_ORIGINS warning');
  assert.equal(cfg.ok, true, 'a missing ALLOWED_ORIGINS must NOT make the deployment "not ok" today');
});

test('M-10/H-12: a blank ALLOWED_ORIGINS also warns', () => {
  const cfg = checkConfig(baseEnv({ ALLOWED_ORIGINS: '   ' }));
  assert.ok(hasAllowedOriginsWarning(cfg));
});

test('M-10/H-12: a set ALLOWED_ORIGINS is silent (no warning)', () => {
  const cfg = checkConfig(baseEnv({ ALLOWED_ORIGINS: 'https://mgmt.example.org' }));
  assert.ok(!hasAllowedOriginsWarning(cfg), 'no warning once ALLOWED_ORIGINS is configured');
  assert.equal(cfg.ok, true);
});
