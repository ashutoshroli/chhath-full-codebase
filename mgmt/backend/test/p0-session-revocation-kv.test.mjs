// ====== AUDIT P0-09 — revoking a session must actually end it ======
//
// "Active Devices → sign out this device", "sign out all other devices" and the
// Superadmin "force logout" only wrote `user_sessions.revoked_at`. The session
// itself stayed in KV, and the revocation check inside verifyToken is explicitly
// best-effort:
//
//     } catch (e) { /* audit read/write is best-effort; never block a valid session */ }
//
// So a revoked device kept working for the whole session TTL (up to 30 days with
// "remember me") whenever that audit-DB read failed — which is exactly the moment
// someone is being cut off. The old comment claimed the KV key could not be
// deleted "since we only store the token HASH", but the KV key IS
// `session:<token_hash>`, so it is reconstructable — revokeSessionsFor (audit
// H-15) had already been doing it for password changes.
//
// Every revoke path now deletes the KV entry as well, and the 2FA
// security-reducing changes revoke other sessions like a password change does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import {
  login, hashPassword, verifyToken,
  revokeSession, revokeAllOtherSessions, revokeUserSession, getMySessions,
} from '../src/auth.js';
import { disable2FA, regenerateBackupCodes } from '../src/twoFactor.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

// The totp_* columns come from migration 2026-09-05/22, not from core.sql — the
// same way test/two-factor-login.test.mjs builds its schema, so code + migration
// are proved to agree.
const TOTP_MIGRATION = readFileSync(
  new URL('../../db/migration/2026-09-05/22-login-users-totp.sql', import.meta.url), 'utf8'
);

async function makeEnv() {
  const core = makeD1(schemaFor('core.sql') + '\n' + TOTP_MIGRATION);
  core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
    .bind('USER0001', '9876543210', 'a@b.test', await hashPassword('a-good-password', 'test-salt'), 'Superadmin', '2026-01-01').run();
  return {
    DB_CORE: core,
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_SESSIONS: makeKV(),
    PASSWORD_SALT: 'test-salt',
  };
}

// login() returns the raw token; the token HASH (what index.js passes as
// `user.th`) lives in the session blob, so read it back the way withAuth does.
async function signIn(env, ip = '203.0.113.5', device = 'FF') {
  const s = await login(env, 'USER0001', 'a-good-password', false, ip, device);
  const session = await verifyToken(env, s.token);
  return { ...s, th: session.th };
}

// The session id the "Active Devices" list shows for a given token hash.
async function sessionIdFor(env, tokenHash) {
  return env.DB_AUDIT.prepare('SELECT id FROM user_sessions WHERE token_hash = ?').bind(tokenHash).first('id');
}

// Simulates the audit DB being unavailable on the NEXT verifyToken — the exact
// condition under which the old revocation silently failed open.
function breakAuditReads(env) {
  const real = env.DB_AUDIT.prepare.bind(env.DB_AUDIT);
  env.DB_AUDIT.prepare = (sql) => {
    if (/FROM user_sessions/i.test(sql)) {
      return { bind: () => ({ async first() { throw new Error('D1_ERROR: audit unavailable'); } }) };
    }
    return real(sql);
  };
}

// ======================================== 1. SIGN OUT ONE OF MY OWN DEVICES

test('P0-09: revoking my own session deletes it from KV, not just the audit row', async () => {
  const env = await makeEnv();
  const a = await signIn(env, '203.0.113.5', 'FF');
  const b = await signIn(env, '203.0.113.9', 'Chrome');
  const idB = await sessionIdFor(env, b.th);

  const res = await revokeSession(env, SUPERADMIN, idB, a.th);
  assert.equal(res.success, true);
  assert.equal(res.wasCurrent, false);

  // The audit row is still marked (history is kept)…
  const row = await env.DB_AUDIT.prepare('SELECT revoked_at FROM user_sessions WHERE id = ?').bind(idB).first();
  assert.ok(row.revoked_at, 'the audit row records the revocation');

  // …and the KV entry is gone, so the device cannot authenticate even if the
  // audit DB is unreachable on its next request.
  breakAuditReads(env);
  assert.equal(await verifyToken(env, b.token), null, 'the revoked device is signed out');
  assert.ok(await verifyToken(env, a.token), 'my current device is untouched');
});

test('P0-09: the revoked device stays out even with a broken audit DB (was fail-open)', async () => {
  const env = await makeEnv();
  const a = await signIn(env);
  const b = await signIn(env, '203.0.113.9', 'Chrome');
  await revokeSession(env, SUPERADMIN, await sessionIdFor(env, b.th), a.th);

  breakAuditReads(env);
  // On `main` this returns a valid session: KV still holds it and the revocation
  // check swallows the audit error.
  assert.equal(await verifyToken(env, b.token), null);
});

// ==================================== 2. SIGN OUT ALL MY OTHER DEVICES

test('P0-09: "sign out other devices" ends them in KV and reports how many', async () => {
  const env = await makeEnv();
  const current = await signIn(env, '203.0.113.5', 'FF');
  const other1 = await signIn(env, '203.0.113.9', 'Chrome');
  const other2 = await signIn(env, '203.0.113.10', 'Safari');

  const res = await revokeAllOtherSessions(env, SUPERADMIN, current.th);
  assert.equal(res.success, true);
  assert.equal(res.revoked, 2);

  breakAuditReads(env);
  assert.equal(await verifyToken(env, other1.token), null);
  assert.equal(await verifyToken(env, other2.token), null);
  assert.ok(await verifyToken(env, current.token), 'the current device stays signed in');
});

test('P0-09: the Active Devices list shrinks to just the current device', async () => {
  const env = await makeEnv();
  const current = await signIn(env, '203.0.113.5', 'FF');
  await signIn(env, '203.0.113.9', 'Chrome');

  await revokeAllOtherSessions(env, SUPERADMIN, current.th);

  const { sessions } = await getMySessions(env, SUPERADMIN, current.th);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].isCurrent, true);
});

// ============================================ 3. SUPERADMIN FORCE-LOGOUT

test('P0-09: a Superadmin force-logout of ALL sessions ends them in KV', async () => {
  const env = await makeEnv();
  const victim1 = await signIn(env, '203.0.113.20', 'Phone');
  const victim2 = await signIn(env, '203.0.113.21', 'Tablet');

  const res = await revokeUserSession(env, 'USER0001', null, SUPERADMIN);
  assert.equal(res.revoked, 2);

  breakAuditReads(env);
  assert.equal(await verifyToken(env, victim1.token), null);
  assert.equal(await verifyToken(env, victim2.token), null);
});

test('P0-09: a Superadmin force-logout of ONE session leaves the others alone', async () => {
  const env = await makeEnv();
  const keep = await signIn(env, '203.0.113.20', 'Phone');
  const kill = await signIn(env, '203.0.113.21', 'Tablet');

  const res = await revokeUserSession(env, 'USER0001', await sessionIdFor(env, kill.th), SUPERADMIN);
  assert.equal(res.revoked, 1);

  assert.equal(await verifyToken(env, kill.token), null);
  assert.ok(await verifyToken(env, keep.token), 'the other device is still signed in');
});

test('P0-09: force-logout still requires Superadmin', async () => {
  const env = await makeEnv();
  await assert.rejects(
    () => revokeUserSession(env, 'USER0001', null, { name: 'USER0002', role: 'Admin' }),
    (err) => { assert.equal(err.permission, true); return true; }
  );
});

// ================================ 4. 2FA SECURITY EVENTS END OTHER SESSIONS

async function enable2FA(env) {
  await env.DB_CORE.prepare(
    "UPDATE login_users SET totp_enabled = 1, totp_secret_enc = 'x', totp_backup_codes = '[]' WHERE name = 'USER0001'"
  ).run();
}

test('P0-09: disabling 2FA signs out the other devices', async () => {
  const env = await makeEnv();
  // Sign the devices in first: once 2FA is on, login() returns a challenge rather
  // than a session, and these tests are about the sessions that already exist.
  const current = await signIn(env, '203.0.113.5', 'FF');
  const other = await signIn(env, '203.0.113.9', 'Chrome');
  await enable2FA(env);

  const res = await disable2FA(env, { ...SUPERADMIN, th: current.th }, 'a-good-password');

  assert.equal(res.success, true);
  assert.equal(res.sessionsRevoked, 1);
  assert.match(res.message, /signed out/i);
  assert.equal(await verifyToken(env, other.token), null, 'the other device is out');
  assert.ok(await verifyToken(env, current.token), 'the device that made the change stays in');
});

test('P0-09: regenerating backup codes signs out the other devices', async () => {
  const env = await makeEnv();
  const current = await signIn(env, '203.0.113.5', 'FF');
  const other = await signIn(env, '203.0.113.9', 'Chrome');
  await enable2FA(env);

  const res = await regenerateBackupCodes(env, { ...SUPERADMIN, th: current.th }, 'a-good-password');

  assert.equal(res.success, true);
  assert.equal(res.backupCodes.length, 10);
  assert.equal(res.sessionsRevoked, 1);
  assert.equal(await verifyToken(env, other.token), null);
  assert.ok(await verifyToken(env, current.token));
});

test('P0-09: a wrong password changes nothing (no session is signed out)', async () => {
  const env = await makeEnv();
  const current = await signIn(env, '203.0.113.5', 'FF');
  const other = await signIn(env, '203.0.113.9', 'Chrome');
  await enable2FA(env);

  await assert.rejects(() => disable2FA(env, { ...SUPERADMIN, th: current.th }, 'wrong'), /Password is incorrect/);

  assert.ok(await verifyToken(env, other.token), 'a failed attempt must not sign anyone out');
  assert.ok(await verifyToken(env, current.token));
});
