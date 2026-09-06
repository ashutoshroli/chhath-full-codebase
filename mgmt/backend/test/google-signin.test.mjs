// ============ Sign in with Google (loginWithGoogle) ============
//
// Verifies the Google ID token path maps a verified Google email to an existing
// login_users row and issues a session that is byte-for-byte the same as the
// password login (so verifyToken, remote logout and the frontend session all
// work unchanged). Google's tokeninfo endpoint is stubbed via globalThis.fetch.
//
// Run: node --test mgmt/backend/test/

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { loginWithGoogle, verifyToken, hashPassword } from '../src/auth.js';

const CLIENT_ID = '123456789-abc.apps.googleusercontent.com';

async function makeEnv(extra = {}) {
  const core = makeD1(schemaFor('core.sql'));
  core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
    .bind('USER0001', 9876543210, 'admin@committee.test', await hashPassword('pw'), 'Superadmin', '2026-01-01').run();
  return {
    DB_CORE: core,
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    KV_SESSIONS: makeKV(),
    GOOGLE_SIGNIN_CLIENT_ID: CLIENT_ID,
    ...extra,
  };
}

// Build a fake tokeninfo response. Good defaults; override any claim.
function tokenInfo(overrides = {}) {
  return {
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    email: 'admin@committee.test',
    email_verified: true,
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    ...overrides,
  };
}

let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(claims, { ok = true } = {}) {
  globalThis.fetch = async () => ({ ok, status: ok ? 200 : 400, json: async () => claims });
}

// ------------------------------------------------------------- HAPPY PATH

test('a verified Google email matching a login issues a working session', async () => {
  const env = await makeEnv();
  stubFetch(tokenInfo());

  const res = await loginWithGoogle(env, 'fake.jwt.token', true, '203.0.113.9', 'Chrome');
  assert.equal(res.success, true);
  assert.equal(res.name, 'USER0001');
  assert.equal(res.role, 'Superadmin');
  assert.ok(res.token, 'a token is issued');
  assert.ok(res.expiresAt > Date.now());

  // The issued session must be identical in shape to a password login: verifyToken
  // resolves it to the same user.
  const user = await verifyToken(env, res.token);
  assert.equal(user.name, 'USER0001');
  assert.equal(user.role, 'Superadmin');
});

test('email match is case-insensitive', async () => {
  const env = await makeEnv();
  stubFetch(tokenInfo({ email: 'ADMIN@Committee.TEST' }));
  const res = await loginWithGoogle(env, 't', false, '', '');
  assert.equal(res.success, true);
  assert.equal(res.name, 'USER0001');
});

test('falls back to DRIVE_OAUTH_CLIENT_ID when GOOGLE_SIGNIN_CLIENT_ID is unset', async () => {
  const env = await makeEnv({ GOOGLE_SIGNIN_CLIENT_ID: '', DRIVE_OAUTH_CLIENT_ID: CLIENT_ID });
  stubFetch(tokenInfo());
  const res = await loginWithGoogle(env, 't', false, '', '');
  assert.equal(res.success, true);
});

// ------------------------------------------------------------- REJECTIONS

test('an email with no matching login is refused (no self-registration)', async () => {
  const env = await makeEnv();
  stubFetch(tokenInfo({ email: 'stranger@gmail.com' }));
  await assert.rejects(() => loginWithGoogle(env, 't', false, '', ''),
    (err) => { assert.equal(err.expected, true); assert.match(err.message, /No committee login is linked/i); return true; });
});

test('a token minted for a DIFFERENT app (wrong aud) is rejected', async () => {
  const env = await makeEnv();
  stubFetch(tokenInfo({ aud: 'someone-elses-client-id.apps.googleusercontent.com' }));
  await assert.rejects(() => loginWithGoogle(env, 't', false, '', ''), /could not be verified/i);
});

test('a wrong issuer is rejected', async () => {
  const env = await makeEnv();
  stubFetch(tokenInfo({ iss: 'https://evil.example.com' }));
  await assert.rejects(() => loginWithGoogle(env, 't', false, '', ''), /could not be verified/i);
});

test('an expired token is rejected', async () => {
  const env = await makeEnv();
  stubFetch(tokenInfo({ exp: String(Math.floor(Date.now() / 1000) - 10) }));
  await assert.rejects(() => loginWithGoogle(env, 't', false, '', ''), /could not be verified/i);
});

test('an unverified Google email is rejected even if it matches a login', async () => {
  const env = await makeEnv();
  stubFetch(tokenInfo({ email_verified: false }));
  await assert.rejects(() => loginWithGoogle(env, 't', false, '', ''), /no verified email/i);
});

test('a missing id token is a validation error', async () => {
  const env = await makeEnv();
  await assert.rejects(() => loginWithGoogle(env, '', false, '', ''), /token missing/i);
});

test('Google tokeninfo returning non-200 is a clean validation error, not a crash', async () => {
  const env = await makeEnv();
  stubFetch({}, { ok: false });
  await assert.rejects(() => loginWithGoogle(env, 't', false, '', ''), /Could not verify/i);
});

test('with no client id configured at all, it is a server config error', async () => {
  const env = await makeEnv({ GOOGLE_SIGNIN_CLIENT_ID: '', DRIVE_OAUTH_CLIENT_ID: '' });
  stubFetch(tokenInfo());
  await assert.rejects(() => loginWithGoogle(env, 't', false, '', ''),
    (err) => { assert.equal(err.internal, true, 'server fault, not user error'); return true; });
});
