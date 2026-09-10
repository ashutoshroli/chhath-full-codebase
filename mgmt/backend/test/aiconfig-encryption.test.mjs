// ============ AI Management — API key encryption at rest ============
//
// API keys must NEVER be stored in plain text. encryptSecret/decryptSecret use
// AES-GCM keyed off AI_CONFIG_SECRET. These pin the round-trip and the critical
// failure modes (no secret, rotated secret) so a regression can't silently start
// storing keys in the clear or make them undecryptable without notice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/aiConfig.js';

const env = { AI_CONFIG_SECRET: 'a-very-strong-random-secret-value-123456' };

test('round-trips a key through encrypt -> decrypt', async () => {
  const key = 'sk-ant-api03-EXAMPLE-KEY-abcdefghijklmnopqrstuvwxyz';
  const enc = await encryptSecret(env, key);
  assert.match(enc, /^v1:/, 'has the versioned prefix');
  assert.ok(!enc.includes(key), 'the ciphertext does not contain the plaintext key');
  const dec = await decryptSecret(env, enc);
  assert.equal(dec, key);
});

test('two encryptions of the same key differ (random IV)', async () => {
  const a = await encryptSecret(env, 'same-key');
  const b = await encryptSecret(env, 'same-key');
  assert.notEqual(a, b, 'IV randomises the ciphertext');
  assert.equal(await decryptSecret(env, a), 'same-key');
  assert.equal(await decryptSecret(env, b), 'same-key');
});

test('refuses to encrypt without AI_CONFIG_SECRET (fail closed)', async () => {
  await assert.rejects(() => encryptSecret({}, 'x'), /AI_CONFIG_SECRET/);
});

test('a rotated/wrong secret can no longer decrypt (documented risk)', async () => {
  const enc = await encryptSecret(env, 'secret-key-value');
  const rotated = { AI_CONFIG_SECRET: 'a-DIFFERENT-secret-value-000000000000' };
  await assert.rejects(() => decryptSecret(rotated, enc), /decrypt/i);
});

test('rejects malformed ciphertext', async () => {
  await assert.rejects(() => decryptSecret(env, 'not-encrypted'), /expected encrypted format/i);
  await assert.rejects(() => decryptSecret(env, ''), /expected encrypted format/i);
});
