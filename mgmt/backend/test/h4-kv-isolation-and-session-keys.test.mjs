// ============ AUDIT H-4 — shared KV namespace + raw-token session keys ============
//
// Both wrangler.toml files carried the SAME KV namespace id, so the PUBLIC,
// unauthenticated Worker held a read/write binding to the namespace storing live
// mgmt sessions, the Drive OAuth token, cached member PII, lockout counters and
// consent OTP proofs. And sessions were keyed by the RAW token, i.e. the namespace
// literally held the value a client presents to authenticate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { login, verifyToken, doLogout, hashPassword } from '../src/auth.js';

const sha256Hex = async (s) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
};

async function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
    .bind('USER0001', 9876543210, 'a@b.test', await hashPassword('a-good-password'), 'Superadmin', '2026-01-01').run();
  return {
    DB_CORE: core,
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    KV_SESSIONS: makeKV(),
    PASSWORD_SALT: 'test-salt',
  };
}

// ------------------------------------------------- SESSIONS ARE KEYED BY HASH

test('H-4: the KV namespace never contains the raw session token', async () => {
  const env = await makeEnv();
  const res = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'Firefox');
  assert.equal(res.success, true);

  const keys = [...env.KV_SESSIONS._store.keys()];
  const sessionKeys = keys.filter(k => k.startsWith('session:'));
  assert.equal(sessionKeys.length, 1, 'exactly one session entry');

  // THE point of the fix: the key is the HASH, not the token.
  assert.equal(sessionKeys[0], 'session:' + await sha256Hex(res.token));
  assert.ok(!keys.includes('session:' + res.token), 'the raw token must not be a key');
  for (const k of keys) {
    assert.ok(!k.includes(res.token), `the raw token leaked into a KV key: ${k}`);
  }
  // …and not into a value either.
  for (const { value } of env.KV_SESSIONS._store.values()) {
    assert.ok(!value.includes(res.token), 'the raw token leaked into a KV value');
  }
});

test('H-4 regression guard: a normal login/verify/logout cycle still works', async () => {
  const env = await makeEnv();
  const { token } = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'Firefox');

  const user = await verifyToken(env, token);
  assert.equal(user.name, 'USER0001');
  assert.equal(user.role, 'Superadmin');

  await doLogout(env, token);
  assert.equal(await verifyToken(env, token), null, 'the session must be gone after logout');
  assert.equal([...env.KV_SESSIONS._store.keys()].filter(k => k.startsWith('session:')).length, 0);
});

test('H-4: a LEGACY raw-token session still verifies (no forced logout on deploy)', async () => {
  // Simulate a session written by the previous deployment.
  const env = await makeEnv();
  const legacyToken = 'legacy-token-abcdef123456';
  const legacyHash = await sha256Hex(legacyToken);
  await env.KV_SESSIONS.put('session:' + legacyToken, JSON.stringify({
    name: 'USER0001', role: 'Superadmin', expiresAt: Date.now() + 3600_000, th: legacyHash,
  }), { expirationTtl: 3600 });

  const user = await verifyToken(env, legacyToken);
  assert.ok(user, 'a session live at deploy time must keep working');
  assert.equal(user.name, 'USER0001');

  // …and logging out must clear the legacy key too.
  await doLogout(env, legacyToken);
  assert.equal(await verifyToken(env, legacyToken), null);
  assert.equal(await env.KV_SESSIONS.get('session:' + legacyToken), null, 'the legacy key must be deleted');
});

test('H-4: reading a legacy session does NOT cost a KV write (write budget is ~1000/day)', async () => {
  const env = await makeEnv();
  const legacyToken = 'legacy-token-xyz';
  await env.KV_SESSIONS.put('session:' + legacyToken, JSON.stringify({
    name: 'USER0001', role: 'Superadmin', expiresAt: Date.now() + 3600_000, th: await sha256Hex(legacyToken),
  }));
  const before = env.KV_SESSIONS._writes();
  for (let i = 0; i < 25; i++) await verifyToken(env, legacyToken);
  assert.equal(env.KV_SESSIONS._writes(), before,
    'migrating legacy keys on read would burn the daily KV write budget — it must be read-only');
});

test('H-4: an unknown or tampered token is rejected under both key schemes', async () => {
  const env = await makeEnv();
  const { token } = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'x');
  for (const bad of ['', 'nope', token + 'x', token.slice(0, -1), await sha256Hex(token)]) {
    assert.equal(await verifyToken(env, bad), null, `must reject: ${JSON.stringify(bad)}`);
  }
});

// -------------------------------------------- THE NAMESPACES ARE ACTUALLY SPLIT

const readToml = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('H-4: the two Workers no longer share a KV namespace id', () => {
  const mgmt = readToml('../wrangler.toml');
  const pub = readToml('../../../Public/backend/wrangler.toml');

  const ids = (toml) => [...toml.matchAll(/^\s*id\s*=\s*"([^"]+)"/gm)].map(m => m[1]);
  const mgmtIds = ids(mgmt).filter(v => /^[0-9a-f]{32}$/.test(v));
  const pubIds = ids(pub).filter(v => /^[0-9a-f]{32}$/.test(v));

  assert.ok(mgmtIds.length >= 1, 'the mgmt Worker still binds its KV namespace');
  for (const id of pubIds) {
    assert.ok(!mgmtIds.includes(id),
      `the public Worker still shares KV namespace ${id} with mgmt`);
  }
});

test('H-4: the public Worker binds KV_PUBLIC and no longer binds KV_SESSIONS', () => {
  const pub = readToml('../../../Public/backend/wrangler.toml');
  // Only look at real binding declarations, not prose in the comments.
  const bindings = [...pub.matchAll(/^\s*binding\s*=\s*"([^"]+)"/gm)].map(m => m[1]);
  assert.ok(bindings.includes('KV_PUBLIC'), 'KV_PUBLIC must be bound');
  assert.ok(!bindings.includes('KV_SESSIONS'),
    'the public Worker must not bind the mgmt session namespace');
});

test('H-4: the public Worker touches KV only through pubKv(), and only pub:* keys', () => {
  const src = readFileSync(new URL('../../../Public/backend/src/index.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // No direct binding access anywhere in the code.
  assert.ok(!/env\.KV_SESSIONS\s*\./.test(code), 'must not use env.KV_SESSIONS directly');
  assert.ok(!/env\.KV_PUBLIC\s*\./.test(code), 'must go through pubKv() so the fallback stays in one place');

  // Every key literal it reads or writes must be pub:-prefixed. This is what makes
  // the isolation real rather than a convention held up by a comment.
  const keys = [...code.matchAll(/kv\.(?:get|put)\(\s*[`'"]([^`'"$]*)/g)].map(m => m[1]);
  assert.ok(keys.length > 0, 'sanity: some literal keys were found');
  for (const k of keys) {
    assert.ok(k.startsWith('pub:'), `public Worker key is not namespaced: "${k}"`);
  }
  // The constants it uses for the snapshot are pub:-prefixed too.
  assert.match(code, /SNAPSHOT_KEY\s*=\s*'pub:/);
  assert.match(code, /SNAPSHOT_META_KEY\s*=\s*'pub:/);
});

test('H-5: the snapshot has a KV size guard instead of a silent failure', () => {
  const src = readFileSync(new URL('../../../Public/backend/src/index.js', import.meta.url), 'utf8');
  assert.match(src, /SNAPSHOT_MAX_BYTES/, 'a size guard must exist');
  // It must LOG rather than swallow — the old bare catch {} meant the operator only
  // discovered the missing fallback during an actual D1 outage.
  const guard = src.slice(src.indexOf('SNAPSHOT_MAX_BYTES'), src.indexOf('const writes = Promise.all'));
  assert.match(guard, /logPublicError/, 'crossing the cap must be reported, not swallowed');
  assert.match(guard, /audit H-5|paginating/i, 'the message must point at the real fix');
});


test('H-4: a token HASH cannot be presented as a token (found by this suite)', async () => {
  // This hole was introduced by the dual-read migration window itself and caught
  // here before merge. The legacy lookup is `get('session:' + <presented value>)`,
  // and the new key is `'session:' + sha256(token)` — so presenting the HASH would
  // land on the new key and authenticate. The hash is NOT secret: it is stored in
  // user_sessions.token_hash, the audit DB whose entire design goal is to hold
  // nothing replayable. An audit-DB leak would therefore have yielded working
  // sessions, handing back exactly the attack this change removes.
  const env = await makeEnv();
  const { token } = await login(env, 'USER0001', 'a-good-password', false, '203.0.113.5', 'x');
  const hash = await sha256Hex(token);

  // Sanity: that hash really is the live KV key, so this is a genuine attempt.
  assert.ok(env.KV_SESSIONS._store.has('session:' + hash), 'the hash is the storage key');
  // Sanity: it is also exactly what the audit DB stores.
  const row = await env.DB_AUDIT.prepare('SELECT token_hash FROM user_sessions LIMIT 1').first();
  assert.equal(row.token_hash, hash, 'the audit DB holds this same value');

  assert.equal(await verifyToken(env, hash), null,
    'presenting the stored hash as a token must NOT authenticate');
  // The real token still works.
  assert.ok(await verifyToken(env, token));
});

test('H-4: a legacy session missing its `th` binding is refused', async () => {
  // Defence in depth for the migration window: without `th` we cannot prove the
  // presented value is the raw token rather than some other key that happens to
  // exist, so such an entry is not trusted. Every session written since the audit DB
  // landed carries `th`, so this logs nobody out.
  const env = await makeEnv();
  await env.KV_SESSIONS.put('session:raw-token-without-th', JSON.stringify({
    name: 'USER0001', role: 'Superadmin', expiresAt: Date.now() + 3600_000,
  }));
  assert.equal(await verifyToken(env, 'raw-token-without-th'), null);
});
