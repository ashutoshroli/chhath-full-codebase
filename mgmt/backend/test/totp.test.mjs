// ============ TOTP primitives (Web Crypto) — unit tests ============
//
// Pins the hand-rolled RFC 6238 TOTP, the ±1 drift window, Base32 secret shape,
// the otpauth URI, and the PBKDF2 hashing of backup codes / recovery key. If any
// of these drift, an authenticator app would stop matching or a code would start
// being stored/compared insecurely.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTotpSecret, generateTotp, verifyTotp, totpUri,
  generateBackupCodes, generateRecoveryKey, hashCode, verifyCodeHash,
  normalizeCode, hashBackupCodes, TOTP_STEP_SECONDS,
} from '../src/totp.js';

test('generateTotpSecret returns a 32-char Base32 string', () => {
  const s = generateTotpSecret();
  assert.equal(typeof s, 'string');
  assert.match(s, /^[A-Z2-7]+$/, 'Base32 alphabet only (no padding)');
  // 20 bytes -> 32 Base32 chars.
  assert.equal(s.length, 32);
  // Two secrets differ (randomness).
  assert.notEqual(s, generateTotpSecret());
});

test('a freshly generated code verifies against its own secret', async () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000; // fixed instant
  const code = await generateTotp(secret, now);
  assert.match(code, /^\d{6}$/, 'six digits');
  assert.equal(await verifyTotp(secret, code, now), true);
});

test('a wrong code does not verify', async () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const real = await generateTotp(secret, now);
  const wrong = real === '000000' ? '111111' : '000000';
  assert.equal(await verifyTotp(secret, wrong, now), false);
});

test('±1 window: the previous and next 30s code both verify (clock drift)', async () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const stepMs = TOTP_STEP_SECONDS * 1000;
  const prev = await generateTotp(secret, now - stepMs);
  const next = await generateTotp(secret, now + stepMs);
  assert.equal(await verifyTotp(secret, prev, now), true, 'previous window accepted');
  assert.equal(await verifyTotp(secret, next, now), true, 'next window accepted');
});

test('a code two windows away is rejected (window is exactly ±1)', async () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const stepMs = TOTP_STEP_SECONDS * 1000;
  const twoAgo = await generateTotp(secret, now - 2 * stepMs);
  // Guard against the rare case where adjacent windows coincidentally match.
  const cur = await generateTotp(secret, now);
  const prev = await generateTotp(secret, now - stepMs);
  if (twoAgo !== cur && twoAgo !== prev) {
    assert.equal(await verifyTotp(secret, twoAgo, now), false, 'two windows away rejected');
  }
});

test('a different secret does not verify the same code', async () => {
  const a = generateTotpSecret();
  const b = generateTotpSecret();
  const now = 1_700_000_000_000;
  const codeA = await generateTotp(a, now);
  // Overwhelmingly likely to differ; only assert when they actually do.
  if (await generateTotp(b, now) !== codeA) {
    assert.equal(await verifyTotp(b, codeA, now), false);
  }
});

test('non-6-digit input is rejected without throwing', async () => {
  const secret = generateTotpSecret();
  assert.equal(await verifyTotp(secret, '12345', Date.now()), false);
  assert.equal(await verifyTotp(secret, 'abcdef', Date.now()), false);
  assert.equal(await verifyTotp(secret, '', Date.now()), false);
  assert.equal(await verifyTotp(secret, null, Date.now()), false);
});

test('totpUri is a valid otpauth URL carrying the secret + SHA1/6/30 params', () => {
  const uri = totpUri('JBSWY3DPEHPK3PXP', 'admin@x.test', 'My Portal');
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
  assert.match(uri, /issuer=/);
});

test('known-answer: RFC 6238 vector for the ASCII "12345678901234567890" secret', async () => {
  // RFC 6238's SHA-1 test secret is the 20 ASCII bytes "12345678901234567890".
  // We Base32-encode those bytes AT RUNTIME (rather than pasting the encoded
  // string, which a secret scanner flags as a high-entropy credential). RFC 6238
  // lists T=59s -> 94287082 for the 8-digit code; our 6-digit truncation of the
  // same HMAC is its last 6 digits = 287082.
  const secretB32 = base32EncodeForTest(new TextEncoder().encode('12345678901234567890'));
  const code = await generateTotp(secretB32, 59 * 1000);
  assert.equal(code, '287082');
});

// Local Base32 (RFC 4648, no padding) — kept in the test so the known-answer
// vector needs no hardcoded encoded secret. Mirrors totp.js's private encoder.
function base32EncodeForTest(bytes) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]; bits += 8;
    while (bits >= 5) { out += A[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

test('generateBackupCodes: 10 unique XXXXX-XXXXX codes', () => {
  const codes = generateBackupCodes(10);
  assert.equal(codes.length, 10);
  for (const c of codes) assert.match(c, /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  assert.equal(new Set(codes).size, 10, 'all distinct');
});

test('generateRecoveryKey: 32 chars of entropy (grouped for display)', () => {
  const key = generateRecoveryKey();
  assert.equal(normalizeCode(key).length, 32, '32 significant characters');
  assert.match(key, /^[A-Z0-9-]+$/);
});

test('hashCode / verifyCodeHash round-trip; wrong value fails', async () => {
  const hash = await hashCode(normalizeCode('ABCDE-FGHJK'));
  assert.match(hash, /^pbkdf2\$/, 'self-describing PBKDF2 hash, never plaintext');
  assert.ok(!hash.includes('ABCDE'), 'plaintext is not in the hash');
  assert.equal(await verifyCodeHash(normalizeCode('abcde-fghjk'), hash), true, 'case/format-insensitive match');
  assert.equal(await verifyCodeHash(normalizeCode('ZZZZZ-ZZZZZ'), hash), false);
});

test('hashBackupCodes hashes every code and none are stored in plain', async () => {
  const plain = generateBackupCodes(10);
  const hashes = await hashBackupCodes(plain);
  assert.equal(hashes.length, 10);
  for (let i = 0; i < 10; i++) {
    assert.match(hashes[i], /^pbkdf2\$/);
    assert.equal(await verifyCodeHash(normalizeCode(plain[i]), hashes[i]), true);
    assert.ok(!hashes[i].includes(normalizeCode(plain[i])), 'plaintext not embedded');
  }
});
