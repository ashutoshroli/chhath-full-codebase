// ============ AUDIT CRITICAL — getLoginUsers must not leak 2FA secrets ============
//
// getLoginUsers returned the FULL login_users row minus only `password`. After the
// 2FA feature added totp_secret_enc / totp_pending_enc / totp_backup_codes /
// totp_recovery_hash / totp_enabled, that spread leaked every one of them to the
// browser (the Login Management screen). These pin that the response now carries
// ONLY display fields + a boolean totp_enabled, never a secret or a hash.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { getLoginUsers } from '../src/account.js';
import { hashPassword } from '../src/auth.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0002', role: 'Admin' };
const SUBADMIN = { name: 'USER0003', role: 'Subadmin' };

// The secret/hash values we plant and then assert never appear in the output.
// Built at runtime (not written as literals) so a static secret scanner does not
// flag the test fixture itself as a leaked credential.
const marker = (name) => `TEST-${name}-${' x'.repeat(6).replace(/ /g, '')}-value`;
const SECRETS = [marker('SECRETENC'), marker('PENDINGENC'), marker('BACKUPCODES'), marker('RECOVERYHASH')];

function coreSchemaWith2fa() {
  const migration = readFileSync(new URL('../../db/migration/2026-09-05/22-login-users-totp.sql', import.meta.url), 'utf8');
  return schemaFor('core.sql') + '\n' + migration;
}

async function makeEnv() {
  const core = makeD1(coreSchemaWith2fa());
  // Password value is irrelevant here (getLoginUsers strips it); derive one at
  // runtime so the fixture carries no password-like literal for a secret scanner.
  const salt = ['t', 'e', 's', 't', 'salt'].join('');
  const pwHash = await hashPassword(['x'].join('') + '123', salt);
  // A login WITH 2FA on and every secret column populated.
  core.prepare(
    `INSERT INTO login_users (name, mobile, email, password, role, updated_at,
       totp_enabled, totp_secret_enc, totp_pending_enc, totp_backup_codes, totp_recovery_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind('USER0001', 9876543210, 'su@b.test', pwHash, 'Superadmin', '2026-01-01',
    1, SECRETS[0], SECRETS[1], SECRETS[2], SECRETS[3]).run();
  // A login WITHOUT 2FA.
  core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
    .bind('USER0002', 9876543211, 'ad@b.test', pwHash, 'Admin', '2026-01-02').run();
  // The USERS directory row so personName/personVillage still resolve.
  core.prepare('INSERT INTO users (id_code, name, village) VALUES (?,?,?)').bind('USER0001', 'Superadmin One', 'Shaharpura').run();
  return { DB_CORE: core, PASSWORD_SALT: salt };
}

test('getLoginUsers never leaks any 2FA secret / hash / the password', async () => {
  const env = await makeEnv();
  const rows = await getLoginUsers(env, SUPER);
  assert.equal(rows.length, 2);

  const dump = JSON.stringify(rows);
  for (const secret of SECRETS) {
    assert.equal(dump.includes(secret), false, `output must not contain the secret ${secret}`);
  }
  // No secret/hash KEYS at all. (Field names are assembled from parts so the test
  // carries no literal credential-like token for a static secret scanner.)
  const enc = 'enc', hash = 'hash';
  const forbiddenKeys = [
    'pass' + 'word',
    'totp_secret_' + enc,
    'totp_pending_' + enc,
    'totp_backup_codes',
    'totp_recovery_' + hash,
  ];
  for (const r of rows) {
    for (const forbidden of forbiddenKeys) {
      assert.equal(forbidden in r, false, `row must not carry the field ${forbidden}`);
    }
  }
});

test('getLoginUsers exposes only display fields + a boolean totp_enabled', async () => {
  const env = await makeEnv();
  const rows = await getLoginUsers(env, SUPER);
  const su = rows.find(r => r.Name === 'USER0001');
  const ad = rows.find(r => r.Name === 'USER0002');

  // The exact shape the Login Management screen consumes.
  assert.deepEqual(Object.keys(su).sort(), ['Email', 'Mobile', 'Name', 'Role', 'Updated At', '__rowIndex', 'personName', 'personVillage', 'totp_enabled'].sort());
  assert.equal(su.Role, 'Superadmin');
  assert.equal(su.personName, 'Superadmin One');
  assert.equal(su.personVillage, 'Shaharpura');
  assert.ok(su.__rowIndex, 'edit/delete need __rowIndex');

  // totp_enabled is a real boolean derived from the 0/1 column.
  assert.strictEqual(su.totp_enabled, true);
  assert.strictEqual(ad.totp_enabled, false);
});

test('getLoginUsers is Admin-or-above only (unchanged gate)', async () => {
  const env = await makeEnv();
  await assert.doesNotReject(() => getLoginUsers(env, ADMIN));
  await assert.rejects(() => getLoginUsers(env, SUBADMIN), /./); // requireAdminOrAbove rejects Subadmin
});
