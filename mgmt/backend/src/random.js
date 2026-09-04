// ============ CRYPTOGRAPHICALLY SECURE RANDOM (audit C-4) ============
//
// Every unguessable value in this Worker used to be built from `Math.random()`:
//
//   generateOtp()          String(Math.floor(100000 + Math.random() * 900000))
//   generateConsentToken() crypto.randomUUID() + Math.random().toString(36)
//   generateAnnouncementToken()                 ...the same
//   generateLoanId() / generateConsentId() / 'TPL'/'GRP'/'POP'/'SLD'/'JOB'/'ERR'
//
// `Math.random()` is NOT a CSPRNG. V8 implements it with xorshift128+, whose
// internal state can be recovered from a small number of observed outputs — and an
// attacker can *harvest* outputs freely here:
//   * requestConsentOtp() can be called 5 times an hour per consent, and each call
//     mints an OTP from the same stream;
//   * every consent_id / loan_id it returns embeds 4 more base36 characters of that
//     same stream.
// Once the state is recovered, the next 6-digit OTP is predictable — and the OTP is
// the ONLY thing standing between a link-holder and accepting a legally binding
// loan guarantee on somebody else's behalf.
//
// Appending Math.random() to a crypto.randomUUID() did not help either: it adds no
// real entropy, it just made the value look longer.
//
// Everything now comes from crypto.getRandomValues(), which is a CSPRNG and is
// available in Workers, Node and browsers alike.

/**
 * `bytes` cryptographically secure random bytes, lower-case hex.
 * 16 bytes = 128 bits (ids); 32 bytes = 256 bits (bearer tokens).
 */
export function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += buf[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * A prefixed opaque id, e.g. randomId('CN') -> 'CN3f9a…'. 8 bytes = 64 bits, which
 * makes a collision negligible across the lifetime of this portal — the old
 * `Date.now().toString(36) + 4 base36 chars` collided whenever two ids were minted
 * in the same millisecond, which is exactly what happens when a loan mints four
 * consents in one request.
 */
export function randomId(prefix, bytes = 8) {
  return `${prefix}${randomHex(bytes)}`;
}

/**
 * A 256-bit bearer token (64 hex chars) — used for consent links and announce
 * links, where the token IS the credential.
 */
export function randomToken() {
  return randomHex(32);
}

/**
 * A uniformly distributed 6-digit numeric OTP in the range 100000-999999.
 *
 * Two deliberate properties:
 *   * REJECTION SAMPLING. A plain `value % 900000` is biased toward the low end
 *     because 2^32 is not a multiple of 900000. We discard the short final block
 *     (900000 * 4772 = 4,294,800,000 <= 2^32) so every code is equally likely.
 *   * NO LEADING ZERO. The `otp` column has REAL affinity (see the audit's M-33),
 *     so a code like "012345" would round-trip as 12345 and never match. Starting
 *     at 100000 keeps all six digits significant, which is why the original code
 *     did the same — preserved on purpose.
 */
export function randomOtp() {
  const RANGE = 900000;
  const LIMIT = 4294800000; // largest multiple of RANGE that fits in a uint32
  const buf = new Uint32Array(1);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= LIMIT);
  return String(100000 + (v % RANGE));
}
