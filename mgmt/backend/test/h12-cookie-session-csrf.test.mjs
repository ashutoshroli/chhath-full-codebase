// audit H-12 / M-10 — cookie session + double-submit CSRF, added WITHOUT breaking
// the existing body-token path.
//
// What these pin:
//   1. cookies.js helpers (parse, build session cookies, clear) are correct.
//   2. A successful login sets HttpOnly cpm_session + readable cpm_csrf cookies,
//      AND still returns the token in the body (back-compat).
//   3. withAuth authenticates via the cookie when the body has no token.
//   4. A cookie-authenticated MUTATING request WITHOUT a matching CSRF header is
//      rejected 403; WITH a matching header it succeeds.
//   5. The body-token path is NEVER subject to the CSRF check (it is CSRF-immune),
//      so old clients keep working untouched.
//   6. logout clears the cookies.
//
// Run: node --test mgmt/backend/test/h12-cookie-session-csrf.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import worker from '../src/index.js';
import { login, hashPassword } from '../src/auth.js';
import { parseCookies, buildSessionCookies, buildClearCookies, newCsrfToken } from '../src/cookies.js';

// ---------------------------------------------------------------- unit: cookies.js
test('cookies: parseCookies reads a Cookie header into an object', () => {
  const req = new Request('https://x/', { headers: { Cookie: 'cpm_session=abc; cpm_csrf=xyz; other=1' } });
  const c = parseCookies(req);
  assert.equal(c.cpm_session, 'abc');
  assert.equal(c.cpm_csrf, 'xyz');
  assert.equal(c.other, '1');
});

test('cookies: parseCookies is safe on a missing/blank header', () => {
  assert.deepEqual(parseCookies(new Request('https://x/')), {});
});

test('cookies: session cookie is HttpOnly+Secure+SameSite; csrf is readable+Secure+SameSite', () => {
  const [session, csrf] = buildSessionCookies('tok', 'cs', 3600);
  assert.match(session, /^cpm_session=tok;/);
  assert.match(session, /HttpOnly/);
  assert.match(session, /Secure/);
  assert.match(session, /SameSite=Strict/);
  assert.match(session, /Max-Age=3600/);
  assert.match(csrf, /^cpm_csrf=cs;/);
  assert.ok(!/HttpOnly/.test(csrf), 'csrf cookie must be readable by JS (no HttpOnly)');
  assert.match(csrf, /Secure/);
});

test('cookies: clear cookies expire both (Max-Age=0)', () => {
  const [s, c] = buildClearCookies();
  assert.match(s, /cpm_session=;/);
  assert.match(s, /Max-Age=0/);
  assert.match(c, /cpm_csrf=;/);
  assert.match(c, /Max-Age=0/);
});

test('cookies: newCsrfToken returns a long random hex string', () => {
  const a = newCsrfToken(); const b = newCsrfToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------- integration
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

async function fetchJson(env, { body, cookie, csrfHeader }) {
  const { ctx, settle } = makeCtx();
  const headers = { 'Content-Type': 'application/json', Origin: 'https://portal.test' };
  if (cookie) headers.Cookie = cookie;
  if (csrfHeader) headers['X-CSRF-Token'] = csrfHeader;
  const res = await worker.fetch(
    new Request('https://api.test/', { method: 'POST', headers, body: JSON.stringify(body) }),
    env, ctx
  );
  const json = await res.json().catch(() => null);
  await settle();
  return { status: res.status, json, setCookie: res.headers.get('Set-Cookie'), headers: res.headers };
}

test('H-12: a successful login sets HttpOnly session + csrf cookies AND still returns the body token', async () => {
  const env = await makeEnv();
  const r = await fetchJson(env, { body: { action: 'login', name: 'USER0001', password: 'a-good-password' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.ok(r.json.token, 'body token still present (back-compat)');
  assert.equal(r.json.csrf, undefined, 'csrf must NOT leak in the body (it is a cookie)');
  // Set-Cookie header carries the session cookie (getSetCookie merges; single get may show one).
  const all = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie().join(' ') : (r.setCookie || '');
  assert.match(all, /cpm_session=/);
  assert.match(all, /HttpOnly/);
  assert.match(all, /cpm_csrf=/);
});

test('H-12: withAuth authenticates via the session COOKIE when the body has no token', async () => {
  const env = await makeEnv();
  const s = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');
  // A READ action (getYears) with NO body token, only the session cookie.
  const r = await fetchJson(env, { body: { action: 'getYears' }, cookie: `cpm_session=${s.token}` });
  assert.equal(r.status, 200, 'cookie session should authenticate a read');
  assert.ok(Array.isArray(r.json), 'getYears returns an array on success');
});

test('H-12: a cookie-auth MUTATING request WITHOUT a CSRF header is rejected 403', async () => {
  const env = await makeEnv();
  const s = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');
  // addYear is a mutating action; cookie auth + no X-CSRF-Token -> blocked.
  const r = await fetchJson(env, { body: { action: 'addYear', year: '2027' }, cookie: `cpm_session=${s.token}; cpm_csrf=${s.csrf}` });
  assert.equal(r.status, 403);
  assert.match(r.json.message, /CSRF/i);
});

test('H-12: a cookie-auth MUTATING request WITH a matching CSRF header succeeds', async () => {
  const env = await makeEnv();
  const s = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');
  const r = await fetchJson(env, {
    body: { action: 'addYear', year: '2027' },
    cookie: `cpm_session=${s.token}; cpm_csrf=${s.csrf}`,
    csrfHeader: s.csrf,
  });
  assert.equal(r.status, 200, 'matching double-submit CSRF token passes');
  assert.equal(r.json.success, true);
});

test('H-12: the BODY-token path is never subject to CSRF (old clients keep working)', async () => {
  const env = await makeEnv();
  const s = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');
  // Body token, NO cookie, NO csrf header, MUTATING action -> must still succeed.
  const r = await fetchJson(env, { body: { action: 'addYear', year: '2028', token: s.token } });
  assert.equal(r.status, 200, 'body-token mutating request must NOT be CSRF-blocked');
  assert.equal(r.json.success, true);
});

test('H-12: logout clears the cookies', async () => {
  const env = await makeEnv();
  const s = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'FF');
  const r = await fetchJson(env, { body: { action: 'logout', token: s.token } });
  const all = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie().join(' ') : (r.setCookie || '');
  assert.match(all, /cpm_session=;/);
  assert.match(all, /Max-Age=0/);
});
