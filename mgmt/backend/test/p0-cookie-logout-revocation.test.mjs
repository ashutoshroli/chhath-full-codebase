// ====== AUDIT P0-05 — logout must revoke the session it authenticated with ======
//
// withAuth accepts EITHER a body token (old localStorage clients) or the HttpOnly
// cpm_session cookie (cookie-only clients). The logout handler, however, called:
//
//     doLogout(env, req.token)
//
// `req.token` is EMPTY for a cookie-only client. doLogout then hashed '' and
// deleted a KV key that never existed, and returned success. The response cleared
// the browser cookies, so the UI looked signed out — while the session stayed
// valid in KV for its full TTL (up to 30 days). Anyone replaying that cookie
// (browser history, a shared machine, a captured header, a stolen backup) stayed
// signed in.
//
// The handler now revokes `effectiveSessionToken(req)` — whatever the request
// actually authenticated with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import worker from '../src/index.js';
import { login, hashPassword, verifyToken, doLogout, effectiveSessionToken } from '../src/auth.js';

function makeCtx() {
  const pending = [];
  return { ctx: { waitUntil: (p) => pending.push(p) }, settle: () => Promise.all(pending.map(p => Promise.resolve(p).catch(() => {}))) };
}

async function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
    .bind('USER0001', '9876543210', 'a@b.test', await hashPassword('a-good-password', 'test-salt'), 'Superadmin', '2026-01-01').run();
  return {
    DB_CORE: core,
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    KV_SESSIONS: makeKV(),
    PASSWORD_SALT: 'test-salt',
    ALLOWED_ORIGINS: 'https://portal.test',
  };
}

async function call(env, { body, cookie, csrfHeader }) {
  const { ctx, settle } = makeCtx();
  const headers = { 'Content-Type': 'application/json', Origin: 'https://portal.test' };
  if (cookie) headers.Cookie = cookie;
  if (csrfHeader) headers['X-CSRF-Token'] = csrfHeader;
  const res = await worker.fetch(
    new Request('https://api.test/', { method: 'POST', headers, body: JSON.stringify(body) }), env, ctx
  );
  const json = await res.json().catch(() => null);
  await settle();
  return { status: res.status, json, headers: res.headers };
}

// ============================================ 1. THE COOKIE-ONLY LOGOUT BUG

test('P0-05: a cookie-only logout actually revokes the session', async () => {
  const env = await makeEnv();
  const s = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');
  assert.ok(await verifyToken(env, s.token), 'the session is live before logout');

  // No body token at all — exactly what a cookie-only client sends.
  const r = await call(env, {
    body: { action: 'logout' },
    cookie: `cpm_session=${s.token}; cpm_csrf=${s.csrf || 'c'}`,
    csrfHeader: s.csrf || 'c',
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);

  // THE ASSERTION THAT FAILS ON `main`: the token still authenticates there.
  assert.equal(await verifyToken(env, s.token), null,
    'the session must be gone from KV — clearing the cookie is not revocation');
});

test('P0-05: the revoked cookie cannot be replayed on a later request', async () => {
  const env = await makeEnv();
  const s = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');

  await call(env, {
    body: { action: 'logout' },
    cookie: `cpm_session=${s.token}; cpm_csrf=${s.csrf || 'c'}`,
    csrfHeader: s.csrf || 'c',
  });

  // Replay the same cookie against a normal read.
  const replay = await call(env, { body: { action: 'getYears' }, cookie: `cpm_session=${s.token}` });
  assert.equal(replay.json.success, false, 'a logged-out cookie must not authenticate');
  assert.match(replay.json.message || '', /session expired/i);
});

test('P0-05: the audit row is marked revoked for a cookie-only logout too', async () => {
  const env = await makeEnv();
  const s = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');

  await call(env, {
    body: { action: 'logout' },
    cookie: `cpm_session=${s.token}; cpm_csrf=${s.csrf || 'c'}`,
    csrfHeader: s.csrf || 'c',
  });

  const open = await env.DB_AUDIT
    .prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE revoked_at IS NULL').first('n');
  assert.equal(open, 0, 'no session row may be left open');
});

// ======================================== 2. THE BODY-TOKEN PATH IS UNCHANGED

test('P0-05 regression guard: a body-token logout still revokes and still clears cookies', async () => {
  const env = await makeEnv();
  const s = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');

  const r = await call(env, { body: { action: 'logout', token: s.token } });

  assert.equal(r.json.success, true);
  assert.equal(await verifyToken(env, s.token), null);
  const all = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie().join(' ') : '';
  assert.match(all, /cpm_session=;/);
  assert.match(all, /Max-Age=0/);
});

test('P0-05: logging out one session leaves the other sessions alone', async () => {
  const env = await makeEnv();
  const a = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');
  const b = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.9', 'Chrome');

  await call(env, {
    body: { action: 'logout' },
    cookie: `cpm_session=${a.token}; cpm_csrf=${a.csrf || 'c'}`,
    csrfHeader: a.csrf || 'c',
  });

  assert.equal(await verifyToken(env, a.token), null, 'this device is signed out');
  assert.ok(await verifyToken(env, b.token), 'the other device is untouched');
});

// ================================================ 3. THE HELPERS THEMSELVES

test('P0-05: effectiveSessionToken prefers the body token, then the cookie', () => {
  assert.equal(effectiveSessionToken({ token: 'body', __cookieSessionToken: 'cookie' }), 'body');
  assert.equal(effectiveSessionToken({ __cookieSessionToken: 'cookie' }), 'cookie');
  assert.equal(effectiveSessionToken({}), '');
  assert.equal(effectiveSessionToken(null), '');
});

test('P0-05: doLogout reports a missing token instead of faking success', async () => {
  const env = await makeEnv();
  const res = await doLogout(env, '', { name: 'USER0001' });
  assert.equal(res.success, false);
  assert.equal(res.revoked, false);
  assert.equal(res.reason, 'no-session-token');
});

test('P0-05: doLogout reports a real revocation', async () => {
  const env = await makeEnv();
  const s = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');
  const res = await doLogout(env, s.token);
  assert.equal(res.success, true);
  assert.equal(res.revoked, true);
});
