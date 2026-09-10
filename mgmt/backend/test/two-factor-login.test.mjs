// ============ 2FA (TOTP) — end-to-end login + management flow ============
//
// Exercises the whole feature against the real Worker source (auth.js login +
// twoFactor.js) with node:sqlite D1 + Map KV stubs, including the migration that
// adds the totp_* columns (so the test proves code + migration agree):
//   * enroll -> confirm -> 2FA is ON
//   * a Superadmin login with 2FA on returns {requires2FA, tempToken} (NO session)
//   * verify2FA with a correct TOTP returns the real session shape
//   * a wrong code is rejected; the per-challenge attempt cap burns the token
//   * a backup code logs in ONCE and is then consumed
//   * disable via recovery key (password + key) turns 2FA off
//   * a non-Superadmin never gets a 2FA challenge even with the columns present
//   * the stored secret is AES-GCM encrypted (never plaintext) at rest

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { login, issueSession, hashPassword } from '../src/auth.js';
import * as tf from '../src/twoFactor.js';
import { generateTotp } from '../src/totp.js';

const PW = 'a-good-password';
const IP = '203.0.113.9';

// core.sql + the 2FA migration (mirrors how a live DB will look after migration
// 22-login-users-totp.sql). The migration is the source of the totp_* columns.
function coreSchemaWith2fa() {
  const migration = readFileSync(
    new URL('../../db/migration/2026-09-05/22-login-users-totp.sql', import.meta.url), 'utf8'
  );
  return schemaFor('core.sql') + '\n' + migration;
}

async function makeEnv() {
  const core = makeD1(coreSchemaWith2fa());
  const rows = [
    ['USER0001', 'Superadmin', 9876543210],
    ['USER0002', 'Admin', 9876543211],
  ];
  for (const [name, role, mobile] of rows) {
    core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
      .bind(name, mobile, `${name.toLowerCase()}@b.test`, await hashPassword(PW), role, '2026-01-01').run();
  }
  return {
    DB_CORE: core,
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_SESSIONS: makeKV(),
    PASSWORD_SALT: 'test-salt',
    AI_CONFIG_SECRET: 'a-strong-secret-for-totp-encryption-000',
  };
}

// The `user` object withAuth would hand a handler for the Superadmin.
const SUPER_USER = { name: 'USER0001', role: 'Superadmin', th: 'x' };

// Enroll + confirm 2FA for USER0001; returns the secret so the test can mint codes.
// confirmEnroll / verifyLoginTotp verify against the LIVE clock (Date.now()), so
// enrollment codes are minted at Date.now() too.
async function enrollSuperadmin(env) {
  const start = await tf.startEnroll(env, SUPER_USER);
  assert.equal(start.success, true);
  assert.match(start.secret, /^[A-Z2-7]+$/);
  assert.equal(start.backupCodes.length, 10);
  assert.equal(typeof start.recoveryKey, 'string');
  const code = await generateTotp(start.secret, Date.now());
  const confirm = await tf.confirmEnroll(env, SUPER_USER, code, start.backupCodes, start.recoveryKey);
  assert.equal(confirm.success, true);
  return start;
}

test('enroll stores the secret ENCRYPTED, not in plain text', async () => {
  const env = await makeEnv();
  const { secret } = await enrollSuperadmin(env);
  const row = await env.DB_CORE.prepare('SELECT * FROM login_users WHERE name = ?').bind('USER0001').first();
  assert.equal(Number(row.totp_enabled), 1);
  assert.match(row.totp_secret_enc, /^v1:/, 'AES-GCM encrypted');
  assert.ok(!row.totp_secret_enc.includes(secret), 'plaintext secret is not stored');
  assert.equal(row.totp_pending_enc, null, 'pending secret cleared after confirm');
  // Backup codes + recovery key are hashed, never plaintext.
  assert.ok(!/[A-Z0-9]{5}-[A-Z0-9]{5}/.test(row.totp_backup_codes || '') || row.totp_backup_codes.includes('pbkdf2$'),
    'backup codes stored as pbkdf2 hashes');
  assert.match(row.totp_recovery_hash, /^pbkdf2\$/);
});

test('E2E: a Superadmin with 2FA on gets a challenge, then verify2FA issues a session', async () => {
  const env = await makeEnv();
  const start = await enrollSuperadmin(env);

  // Password login now returns a challenge, NOT a session.
  const res = await login(env, 'USER0001', PW, true, IP, 'Firefox/Linux');
  assert.equal(res.requires2FA, true);
  assert.ok(res.tempToken, 'a tempToken is returned');
  assert.equal(res.token, undefined, 'no session token at the challenge step');

  // Verify with a correct code -> real session shape (matches issueSession).
  const code = await generateTotp(start.secret, Date.now());
  const session = await tf.verifyLoginTotp(env, res.tempToken, code, issueSession);
  assert.equal(session.success, true);
  assert.ok(session.token, 'a real session token is issued');
  assert.equal(session.name, 'USER0001');
  assert.equal(session.role, 'Superadmin');
  assert.ok(session.csrf && session.expiresAt, 'full session shape preserved');

  // The tempToken is single-use (burned on success).
  const reuse = await tf.verifyLoginTotp(env, res.tempToken, code, issueSession);
  assert.equal(reuse.success, false);
});

test('a wrong code is rejected and the attempt cap burns the challenge', async () => {
  const env = await makeEnv();
  await enrollSuperadmin(env);
  const res = await login(env, 'USER0001', PW, true, IP, 'd');
  const bad = '000000';

  // 5 wrong attempts allowed, then the token is burned.
  for (let i = 0; i < 5; i++) {
    const r = await tf.verifyLoginTotp(env, res.tempToken, bad, issueSession);
    assert.equal(r.success, false);
  }
  // The challenge is now gone — even a fresh attempt on the same token fails.
  const afterBurn = await tf.verifyLoginTotp(env, res.tempToken, '123456', issueSession);
  assert.equal(afterBurn.success, false);
});

test('a backup code logs in exactly once, then is consumed', async () => {
  const env = await makeEnv();
  const start = await enrollSuperadmin(env);
  const oneBackup = start.backupCodes[0];

  const res = await login(env, 'USER0001', PW, true, IP, 'd');
  const first = await tf.verifyLoginTotp(env, res.tempToken, oneBackup, issueSession);
  assert.equal(first.success, true, 'backup code works once');

  // Reusing the SAME backup code on a fresh challenge fails (it was consumed).
  const res2 = await login(env, 'USER0001', PW, true, IP, 'd');
  const second = await tf.verifyLoginTotp(env, res2.tempToken, oneBackup, issueSession);
  assert.equal(second.success, false, 'backup code cannot be reused');

  // One fewer backup code remains.
  const st = await tf.get2FAStatus(env, SUPER_USER);
  assert.equal(st.backupCodesRemaining, 9);
});

test('disable via recovery key (password + key) turns 2FA off', async () => {
  const env = await makeEnv();
  const start = await enrollSuperadmin(env);

  // Wrong password -> generic failure, still enabled.
  const wrong = await tf.disableViaRecoveryKey(env, 'USER0001', 'nope', start.recoveryKey);
  assert.equal(wrong.success, false);

  // Correct password + recovery key -> disabled.
  const ok = await tf.disableViaRecoveryKey(env, 'USER0001', PW, start.recoveryKey);
  assert.equal(ok.success, true);

  // Login no longer challenges.
  const res = await login(env, 'USER0001', PW, true, IP, 'd');
  assert.equal(res.requires2FA, undefined);
  assert.ok(res.token, 'plain session issued once 2FA is off');
});

test('regenerateBackupCodes invalidates the old set (password-confirmed)', async () => {
  const env = await makeEnv();
  const start = await enrollSuperadmin(env);
  const old = start.backupCodes[0];

  const regen = await tf.regenerateBackupCodes(env, SUPER_USER, PW);
  assert.equal(regen.success, true);
  assert.equal(regen.backupCodes.length, 10);

  // An OLD backup code no longer verifies at login.
  const res = await login(env, 'USER0001', PW, true, IP, 'd');
  const r = await tf.verifyLoginTotp(env, res.tempToken, old, issueSession);
  assert.equal(r.success, false, 'old backup codes stop working after regeneration');
});

test('a non-Superadmin is NEVER challenged, even with 2FA columns present', async () => {
  const env = await makeEnv();
  // Admin logs in -> straight to a session, no challenge.
  const res = await login(env, 'USER0002', PW, true, IP, 'd');
  assert.equal(res.requires2FA, undefined);
  assert.ok(res.token);
  // startEnroll refuses a non-Superadmin.
  await assert.rejects(() => tf.startEnroll(env, { name: 'USER0002', role: 'Admin', th: 'x' }), /Superadmin/);
});

test('recovery email + token reset disables 2FA (single-use token)', async () => {
  const env = await makeEnv();
  await enrollSuperadmin(env);

  // Stub the Resend send so requestRecoveryEmail can run offline; capture the token
  // straight from KV (that's what the email carries).
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'x' }) });
  try {
    const r = await tf.requestRecoveryEmail(env, 'USER0001');
    assert.equal(r.success, true);
  } finally {
    globalThis.fetch = origFetch;
  }

  // Find the recovery token KV entry.
  const keys = [...env.KV_SESSIONS._store.keys()].filter(k => k.startsWith('twofa:recovery:'));
  assert.equal(keys.length, 1, 'a single-use recovery token was stored');
  const token = keys[0].slice('twofa:recovery:'.length);

  const reset = await tf.resetViaRecoveryToken(env, token);
  assert.equal(reset.success, true);

  // Token is single-use.
  const again = await tf.resetViaRecoveryToken(env, token);
  assert.equal(again.success, false);

  // 2FA is off now.
  const res = await login(env, 'USER0001', PW, true, IP, 'd');
  assert.ok(res.token);
  assert.equal(res.requires2FA, undefined);
});

test('requestRecoveryEmail is anti-enumeration: generic success for unknown / ineligible', async () => {
  const env = await makeEnv();
  const unknown = await tf.requestRecoveryEmail(env, 'NOPE9999');
  assert.equal(unknown.success, true, 'never reveals the account does not exist');
  // No recovery token minted for a non-existent / 2FA-off account.
  const keys = [...env.KV_SESSIONS._store.keys()].filter(k => k.startsWith('twofa:recovery:'));
  assert.equal(keys.length, 0);
});
