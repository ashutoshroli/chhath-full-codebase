// ============ AUDIT H-15 — changing a password left every session alive ============
//
// A session is a KV blob plus a `user_sessions` row. verifyToken() validates
// against the blob and NEVER re-checks the password hash, so changing a password
// did nothing at all to sessions already in flight: they kept working for their
// full 8 hours, or THIRTY DAYS with "remember me".
//
// That defeats the only reason anyone changes a password. Whoever had the old
// credentials — or a stolen token — kept full access for up to a month, and the
// user was shown "Password changed successfully."
//
// Same for a Superadmin resetting a compromised account's password, and for
// deleting a login outright.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { login, verifyToken, hashPassword, revokeSessionsFor } from '../src/auth.js';
import { changePassword, updateLoginUser, deleteLoginUser } from '../src/account.js';

const sha256Hex = async (s) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const PW = 'a-good-password';

async function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  // Distinct mobile/email per login: findLoginConflict() rejects a duplicate.
  for (const [name, role, mobile] of [['USER0001', 'Superadmin', 9876543210], ['USER0002', 'Admin', 9876543211]]) {
    core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
      .bind(name, mobile, `${name.toLowerCase()}@b.test`, await hashPassword(PW), role, '2026-01-01').run();
  }
  return {
    DB_CORE: core,
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_SESSIONS: makeKV(),
    PASSWORD_SALT: 'test-salt',
  };
}

// Sign the same account in from N devices and hand back the tokens, plus the
// `user` object the router would build for the FIRST of them.
async function signInFrom(env, name, devices) {
  const tokens = [];
  for (const d of devices) {
    const r = await login(env, name, PW, /* remember */ true, '203.0.113.5', d);
    assert.equal(r.success, true, `login from ${d}`);
    tokens.push(r.token);
  }
  return tokens;
}

const userFor = async (env, token) => await verifyToken(env, token);
const liveRows = async (env, name) => (await env.DB_AUDIT.prepare(
  'SELECT device_info, revoked_at FROM user_sessions WHERE name = ? ORDER BY id'
).bind(name).all()).results.map(r => ({ ...r }));

// ============================ 0. THE OLD BEHAVIOUR, REPRODUCED (the proof)

// `changePassword` on `main` was: verify the current password, hash the new one,
// UPDATE login_users. Nothing else. Replaying exactly those two statements here
// shows what that left behind — asserting the bug rather than describing it.
//
// (This has to be reproduced rather than run against the old module, because the
// old file has no revokeSessionsFor to import.)
test('H-15 proof: the OLD password change left every session fully usable', async () => {
  const env = await makeEnv();
  const [phone, laptop, attacker] = await signInFrom(env, 'USER0001', ['Phone', 'Laptop', 'AttackerBrowser']);

  const row = await env.DB_CORE.prepare('SELECT id FROM login_users WHERE name = ?').bind('USER0001').first();
  await env.DB_CORE.prepare('UPDATE login_users SET password = ?, updated_at = ? WHERE id = ?')
    .bind(await hashPassword('a-brand-new-password'), new Date().toISOString(), row.id).run();

  // The old password can no longer be used to log IN...
  assert.equal((await login(env, 'USER0001', PW, false, '1.1.1.1', 'X')).success, false);

  // ...but every session that was created with it is still completely valid,
  // because a session is validated against its KV blob and the password hash is
  // never re-checked. With "remember me" that lasts THIRTY DAYS.
  for (const [label, t] of [['Phone', phone], ['Laptop', laptop], ['AttackerBrowser', attacker]]) {
    const s = await verifyToken(env, t);
    assert.ok(s, `${label} STILL authenticates after the password change`);
    assert.equal(s.role, 'Superadmin', `${label} still has full Superadmin access`);
  }

  const rows = await liveRows(env, 'USER0001');
  assert.deepEqual(rows.map(r => !!r.revoked_at), [false, false, false],
    'not one session was marked revoked');
});

// ======================================================== 1. THE BUG

test('H-15: changing a password signs every OTHER device out', async () => {
  const env = await makeEnv();
  const [phone, laptop, attacker] = await signInFrom(env, 'USER0001', ['Phone', 'Laptop', 'AttackerBrowser']);

  // All three are valid before the change.
  for (const t of [phone, laptop, attacker]) {
    assert.ok(await verifyToken(env, t), 'session valid before the change');
  }

  const me = await userFor(env, phone);
  const res = await changePassword(env, PW, 'a-brand-new-password', me);

  assert.equal(res.success, true);
  assert.equal(res.otherSessionsRevoked, 2, 'the two other devices were revoked');

  // THE ASSERTIONS THAT FAIL ON `main` — there, all three still verify.
  assert.equal(await verifyToken(env, laptop), null, 'the other legitimate device is signed out');
  assert.equal(await verifyToken(env, attacker), null, 'and so is whoever had the old password');

  // ...but the device that performed the change stays usable.
  const still = await verifyToken(env, phone);
  assert.ok(still, 'you are not logged out of the screen you just used');
  assert.equal(still.name, 'USER0001');
});

test('H-15: the new password works and the old one does not', async () => {
  const env = await makeEnv();
  const [phone] = await signInFrom(env, 'USER0001', ['Phone']);
  await changePassword(env, PW, 'a-brand-new-password', await userFor(env, phone));

  assert.equal((await login(env, 'USER0001', PW, false, '1.1.1.1', 'X')).success, false,
    'the old password is dead');
  assert.equal((await login(env, 'USER0001', 'a-brand-new-password', false, '1.1.1.1', 'X')).success, true,
    'the new one works');
});

test('H-15: revocation happens on BOTH layers, so it does not depend on one', async () => {
  const env = await makeEnv();
  const [phone, laptop] = await signInFrom(env, 'USER0001', ['Phone', 'Laptop']);
  const laptopHash = await sha256Hex(laptop);

  assert.ok(await env.KV_SESSIONS.get('session:' + laptopHash), 'the KV entry exists first');

  await changePassword(env, PW, 'a-brand-new-password', await userFor(env, phone));

  // (a) the KV entry is gone — immediate, and independent of the audit DB.
  assert.equal(await env.KV_SESSIONS.get('session:' + laptopHash), null);
  // (b) the audit row is marked revoked — this is what catches legacy sessions
  //     still keyed by the raw token, whose KV key cannot be derived from a hash.
  const rows = await liveRows(env, 'USER0001');
  const byDevice = Object.fromEntries(rows.map(r => [r.device_info, !!r.revoked_at]));
  assert.deepEqual(byDevice, { Phone: false, Laptop: true });
});

test('H-15: a wrong current password changes nothing and revokes nothing', async () => {
  const env = await makeEnv();
  const [phone, laptop] = await signInFrom(env, 'USER0001', ['Phone', 'Laptop']);

  const me = await userFor(env, phone);
  await assert.rejects(
    () => changePassword(env, 'not-my-password', 'a-brand-new-password', me),
    /Current password is incorrect/
  );
  assert.ok(await verifyToken(env, laptop), 'a failed attempt must not sign anyone out');
  assert.equal((await login(env, 'USER0001', PW, false, '1.1.1.1', 'X')).success, true,
    'and must not change the password');
});

test('H-15: another user\'s sessions are never touched', async () => {
  const env = await makeEnv();
  const [mine] = await signInFrom(env, 'USER0001', ['Phone']);
  const [theirs] = await signInFrom(env, 'USER0002', ['TheirPhone']);

  await changePassword(env, PW, 'a-brand-new-password', await userFor(env, mine));

  assert.ok(await verifyToken(env, theirs), 'USER0002 is unaffected');
});

// ==================================== 2. A SUPERADMIN RESET LOCKS THE ACCOUNT OUT

test('H-15: a Superadmin password reset revokes ALL of the target\'s sessions', async () => {
  const env = await makeEnv();
  const [sa] = await signInFrom(env, 'USER0001', ['SuperadminLaptop']);
  const [victimA, victimB] = await signInFrom(env, 'USER0002', ['VictimPhone', 'AttackerBrowser']);

  const target = await env.DB_CORE.prepare('SELECT id FROM login_users WHERE name = ?').bind('USER0002').first();
  const res = await updateLoginUser(
    env, target.id, 'reset-by-superadmin', 'Admin', '9876543211', 'user0002@b.test',
    await userFor(env, sa)
  );

  assert.equal(res.sessionsRevoked, 2, 'both of the target\'s devices are cut off');
  assert.equal(await verifyToken(env, victimA), null);
  assert.equal(await verifyToken(env, victimB), null, 'the point of the reset actually happens');
  assert.ok(await verifyToken(env, sa), 'the Superadmin doing the reset stays signed in');
});

test('H-15: a Superadmin resetting their OWN password is not logged out', async () => {
  const env = await makeEnv();
  const [sa, saOther] = await signInFrom(env, 'USER0001', ['ThisLaptop', 'OldPhone']);
  const self = await env.DB_CORE.prepare('SELECT id FROM login_users WHERE name = ?').bind('USER0001').first();

  const res = await updateLoginUser(
    env, self.id, 'my-new-password', 'Superadmin', '9876543210', 'user0001@b.test',
    await userFor(env, sa)
  );

  assert.equal(res.sessionsRevoked, 1, 'the other device only');
  assert.ok(await verifyToken(env, sa), 'the session performing the reset survives');
  assert.equal(await verifyToken(env, saOther), null);
});

test('H-15: a role-only edit revokes NOTHING (verifyToken enforces the new role live)', async () => {
  const env = await makeEnv();
  const [sa] = await signInFrom(env, 'USER0001', ['SuperadminLaptop']);
  const [theirs] = await signInFrom(env, 'USER0002', ['TheirPhone']);
  const target = await env.DB_CORE.prepare('SELECT id FROM login_users WHERE name = ?').bind('USER0002').first();

  // No password argument -> a plain role/contact edit.
  const res = await updateLoginUser(
    env, target.id, '', 'Subadmin', '9876543211', 'user0002@b.test', await userFor(env, sa));

  assert.equal(res.sessionsRevoked, 0, 'nobody is signed out for a demotion');
  const still = await verifyToken(env, theirs);
  assert.ok(still, 'they stay signed in...');
  assert.equal(still.role, 'Subadmin', '...but with the NEW role, enforced on this very request');
});

// ============================================ 3. DELETING A LOGIN CUTS IT OFF

test('H-15: deleting a login revokes its sessions immediately', async () => {
  const env = await makeEnv();
  const [sa] = await signInFrom(env, 'USER0001', ['SuperadminLaptop']);
  const [theirs] = await signInFrom(env, 'USER0002', ['TheirPhone']);
  const target = await env.DB_CORE.prepare('SELECT id FROM login_users WHERE name = ?').bind('USER0002').first();

  const res = await deleteLoginUser(env, target.id, await userFor(env, sa));
  assert.equal(res.sessionsRevoked, 1);
  assert.equal(await verifyToken(env, theirs), null);

  // And it holds even if the core DB is unreachable afterwards — verifyToken's
  // "login row vanished" check lives in a try/catch that deliberately falls
  // through to the cached session on error, so the KV delete is what guarantees it.
  const [saAgain] = [sa];
  env.DB_CORE = { prepare() { throw new Error('D1_ERROR: core unreachable'); } };
  assert.equal(await verifyToken(env, theirs), null, 'still signed out during a core-DB outage');
  assert.ok(await verifyToken(env, saAgain), 'and an untouched session still works');
});

// ================================== 4. FAIL-SAFE: A PASSWORD CHANGE MUST STILL WORK

test('H-15: an audit-store failure does not undo a completed password change', async () => {
  const env = await makeEnv();
  const [phone] = await signInFrom(env, 'USER0001', ['Phone']);
  const me = await userFor(env, phone);

  env.DB_AUDIT = { prepare() { throw new Error('D1_ERROR: audit unreachable'); } };

  const res = await changePassword(env, PW, 'a-brand-new-password', me);
  assert.equal(res.success, true, 'the change still succeeds');
  assert.equal(res.otherSessionsRevoked, -1, 'reported as "could not determine", not as 0');
  assert.equal((await login(env, 'USER0001', 'a-brand-new-password', false, '1.1.1.1', 'X')).success, true,
    'the new password really was written');
});

test('H-15: no audit store at all (older deployment) still allows a password change', async () => {
  const env = await makeEnv();
  const [phone] = await signInFrom(env, 'USER0001', ['Phone']);
  const me = await userFor(env, phone);
  delete env.DB_AUDIT;

  const res = await changePassword(env, PW, 'a-brand-new-password', me);
  assert.equal(res.success, true);
  assert.equal(res.otherSessionsRevoked, -1);
});

test('H-15: revokeSessionsFor is a no-op for an unknown or blank name', async () => {
  const env = await makeEnv();
  await signInFrom(env, 'USER0001', ['Phone']);
  assert.equal(await revokeSessionsFor(env, 'USER9999'), 0);
  assert.equal(await revokeSessionsFor(env, ''), -1, 'a blank name is refused, not treated as a wildcard');
  assert.equal(await revokeSessionsFor(env, null), -1);
  const rows = await liveRows(env, 'USER0001');
  assert.deepEqual(rows.map(r => !!r.revoked_at), [false], 'the real session is untouched');
});

// ============================================================ 5. FREE TIER

test('H-15: the KV write cost is bounded by the number of signed-in devices', async () => {
  const env = await makeEnv();
  const tokens = await signInFrom(env, 'USER0001', ['A', 'B', 'C', 'D']);
  const before = env.KV_SESSIONS._writeOps();

  await changePassword(env, PW, 'a-brand-new-password', await userFor(env, tokens[0]));

  // KV DELETEs count against the ~1000 writes/day budget. Three deletes for three
  // other devices — and this runs only on a password change, not on a hot path.
  assert.equal(env.KV_SESSIONS._writeOps() - before, 3);
});

test('H-15: a user with only one device costs ZERO extra KV writes', async () => {
  const env = await makeEnv();
  const [only] = await signInFrom(env, 'USER0001', ['Phone']);
  const before = env.KV_SESSIONS._writeOps();
  const res = await changePassword(env, PW, 'a-brand-new-password', await userFor(env, only));
  assert.equal(res.otherSessionsRevoked, 0);
  assert.equal(env.KV_SESSIONS._writeOps() - before, 0, 'nothing to revoke, nothing written');
});
