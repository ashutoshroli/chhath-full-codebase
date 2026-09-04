// ============ AUDIT C-4 — Math.random() for OTPs and bearer tokens ============
//
// The 6-digit consent OTP — the only thing standing between a link-holder and
// accepting a legally binding loan guarantee as somebody else — was drawn from
// V8's xorshift128+ (`Math.random()`), whose state is recoverable from a handful of
// observed outputs. An attacker can harvest outputs freely (requestConsentOtp is
// callable 5x/hour per consent, and every consent_id it returns leaked 4 more
// base36 characters of the same stream).
//
// These tests assert the STATISTICAL properties a CSPRNG-backed generator must
// have, plus the two domain constraints that must be preserved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomHex, randomId, randomToken, randomOtp } from '../src/random.js';

test('C-4: randomHex returns the requested length and only hex', () => {
  for (const bytes of [1, 4, 8, 16, 32]) {
    const v = randomHex(bytes);
    assert.equal(v.length, bytes * 2, `${bytes} bytes -> ${bytes * 2} hex chars`);
    assert.match(v, /^[0-9a-f]+$/, 'lower-case hex only');
  }
});

test('C-4: randomHex is not degenerate — every byte position varies', () => {
  // A broken generator (constant, or seeded per-call from the clock) would show a
  // fixed value in some position. Sample 400 values and require each of the 32 hex
  // positions to take at least 8 distinct characters out of a possible 16.
  const samples = Array.from({ length: 400 }, () => randomHex(16));
  for (let pos = 0; pos < 32; pos++) {
    const distinct = new Set(samples.map(s => s[pos]));
    assert.ok(distinct.size >= 8, `position ${pos} only took ${distinct.size} distinct values`);
  }
});

test('C-4: a consent token is a 256-bit value and never repeats', () => {
  const N = 20000;
  const seen = new Set();
  for (let i = 0; i < N; i++) {
    const t = randomToken();
    assert.equal(t.length, 64, '256 bits of entropy, hex-encoded');
    assert.ok(!seen.has(t), 'a token collision would let one link resolve to another consent');
    seen.add(t);
  }
  assert.equal(seen.size, N);
});

test('C-4: ids minted in the SAME millisecond are distinct', () => {
  // This is the concrete old bug: createLoanConsents mints four consent ids inside
  // one request, and `Date.now().toString(36) + 4 base36 chars` had only ~1.7M
  // combinations for a given millisecond. loan_consents has no UNIQUE constraint on
  // consent_id, so a collision silently corrupted a different person's record.
  const t0 = Date.now();
  const ids = Array.from({ length: 5000 }, () => randomId('CN'));
  assert.ok(Date.now() - t0 < 2000, 'sanity: minted in a tight loop');
  assert.equal(new Set(ids).size, ids.length, 'all ids must be unique');
  assert.ok(ids.every(id => /^CN[0-9a-f]{16}$/.test(id)), 'prefix + 8 random bytes');
});

test('C-4: randomOtp always yields exactly 6 significant digits (REAL-affinity safe)', () => {
  // The `otp` column has REAL affinity, so a code with a leading zero would
  // round-trip as a shorter number and never match. Every code must be 100000+.
  for (let i = 0; i < 30000; i++) {
    const otp = randomOtp();
    assert.equal(otp.length, 6, `got "${otp}"`);
    assert.match(otp, /^[1-9][0-9]{5}$/, `leading zero would be lost by REAL affinity: "${otp}"`);
    const n = Number(otp);
    assert.ok(n >= 100000 && n <= 999999, `out of range: ${n}`);
    // The value must survive the exact round-trip verifyConsentOtp performs.
    assert.equal(String(n).trim().replace(/\.0+$/, ''), otp);
  }
});

test('C-4: randomOtp is uniform — rejection sampling removes the modulo bias', () => {
  // A plain `value % 900000` over a uint32 is biased toward the low end, because
  // 2^32 is not a multiple of 900000. Bucket 90000 samples into 9 decades and
  // require each to land within 15% of the expected 1/9.
  const N = 90000;
  const buckets = new Array(9).fill(0);
  for (let i = 0; i < N; i++) {
    buckets[Math.floor((Number(randomOtp()) - 100000) / 100000)]++;
  }
  const expected = N / 9;
  buckets.forEach((count, i) => {
    const drift = Math.abs(count - expected) / expected;
    assert.ok(drift < 0.15, `decade ${i} drifted ${(drift * 100).toFixed(1)}% (count ${count}, expected ${expected})`);
  });
  assert.equal(buckets.reduce((a, b) => a + b, 0), N);
});

test('C-4: randomOtp has no short cycle and does not repeat trivially', () => {
  // 6 digits only has 900k values, so collisions in a large sample are EXPECTED
  // (birthday paradox). What must not happen is a tiny cycle or a fixed value.
  const samples = Array.from({ length: 5000 }, () => randomOtp());
  const distinct = new Set(samples).size;
  assert.ok(distinct > 4800, `only ${distinct}/5000 distinct — the generator looks cyclic`);
  // No value may dominate.
  const counts = new Map();
  for (const s of samples) counts.set(s, (counts.get(s) || 0) + 1);
  assert.ok(Math.max(...counts.values()) <= 3, 'a repeated value suggests a tiny state space');
});

test('C-4: the generators consume the Web Crypto CSPRNG, not Math.random', () => {
  // Direct behavioural proof: pin Math.random to a constant. A Math.random-backed
  // generator would then emit identical values; a CSPRNG-backed one must not.
  const realRandom = Math.random;
  try {
    Math.random = () => 0.4242424242;
    const otps = new Set(Array.from({ length: 200 }, () => randomOtp()));
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    const ids = new Set(Array.from({ length: 200 }, () => randomId('CN')));
    const hexes = new Set(Array.from({ length: 200 }, () => randomHex(16)));
    assert.ok(otps.size > 150, `OTPs collapsed to ${otps.size} values with Math.random pinned`);
    assert.equal(tokens.size, 200, 'tokens must be unaffected by Math.random');
    assert.equal(ids.size, 200, 'ids must be unaffected by Math.random');
    assert.equal(hexes.size, 200, 'hex must be unaffected by Math.random');
  } finally {
    Math.random = realRandom;
  }
});
