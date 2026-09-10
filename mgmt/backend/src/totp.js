// ============================================================================
// TOTP (RFC 6238) + backup codes + recovery key — pure Web Crypto.
//
// SECURITY / PORTABILITY: this Worker runs on Cloudflare's V8 isolate, which has
// Web Crypto (crypto.subtle, crypto.getRandomValues) but NOT Node's `crypto`
// module or Buffer. The usual Node TOTP libraries (speakeasy, otplib) and bcrypt
// depend on those, so they are NOT used here — the whole primitive is hand-rolled
// on Web Crypto (HMAC-SHA1) and matches Google Authenticator / Authy byte-for-byte.
//
//   * TOTP: HMAC-SHA1 over an 8-byte big-endian counter = floor(unixSeconds / 30),
//     6 digits, dynamic truncation (RFC 4226 §5.3 / RFC 6238).
//   * Verification allows a ±1 step drift window (±30 s) to tolerate clock skew.
//   * The shared secret is 20 random bytes (160 bits, RFC 4226 recommended),
//     surfaced to the authenticator app as Base32 (no padding).
//   * Backup codes and the 32-char recovery key are hashed with PBKDF2-SHA256
//     (the same primitive auth.js already uses for passwords) — never stored in
//     plain text — and compared in constant time.
//
// This module holds ONLY the crypto/codec. Enrollment, DB storage (encrypted via
// aiConfig.encryptSecret), the login challenge and the recovery email live in
// twoFactor.js.
// ============================================================================

import { randomHex } from './random.js';
import { timingSafeEqualHex } from './auth.js';

// ---- Config (RFC 6238) ----
export const TOTP_STEP_SECONDS = 30;   // one code every 30 s
export const TOTP_DIGITS = 6;          // 6-digit code
export const TOTP_DRIFT_WINDOWS = 1;   // accept the code from ±1 step (±30 s)
const TOTP_SECRET_BYTES = 20;          // 160-bit shared secret (RFC 4226)

// PBKDF2 for backup codes + recovery key. Cloudflare Workers cap PBKDF2 at
// 100 000 iterations (same as auth.js password hashing).
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN_BYTES = 32;

// ---- Base32 (RFC 4648, no padding) — what authenticator apps expect ----
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = (str || '').toString().toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// ---- Secret generation ----
// Returns a Base32-encoded 160-bit random secret (the value stored — encrypted —
// and shown to the user during enrollment).
export function generateTotpSecret() {
  const buf = new Uint8Array(TOTP_SECRET_BYTES);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}

// ---- HMAC-SHA1 (Web Crypto) ----
async function hmacSha1(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
  return new Uint8Array(sig);
}

// 8-byte big-endian counter for a given step (RFC 4226 §5.1).
function counterBytes(counter) {
  const buf = new Uint8Array(8);
  // JS bitwise is 32-bit; split into hi/lo 32-bit halves.
  let hi = Math.floor(counter / 0x100000000);
  let lo = counter >>> 0;
  for (let i = 7; i >= 0; i--) {
    if (i >= 4) { buf[i] = lo & 0xff; lo = Math.floor(lo / 256); }
    else { buf[i] = hi & 0xff; hi = Math.floor(hi / 256); }
  }
  return buf;
}

// Dynamic truncation (RFC 4226 §5.3) -> zero-padded N-digit string.
function truncate(hmac, digits) {
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = bin % Math.pow(10, digits);
  return mod.toString().padStart(digits, '0');
}

// The TOTP code for a Base32 secret at a given step index.
async function totpAtStep(secretBase32, step) {
  const keyBytes = base32Decode(secretBase32);
  const hmac = await hmacSha1(keyBytes, counterBytes(step));
  return truncate(hmac, TOTP_DIGITS);
}

// Current TOTP code (used only in tests / diagnostics — the client never needs it).
export async function generateTotp(secretBase32, atMs = Date.now()) {
  const step = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  return totpAtStep(secretBase32, step);
}

// Verify a user-supplied code against the secret, allowing ±TOTP_DRIFT_WINDOWS
// steps of clock drift. Constant-time per candidate (compares the ASCII-hex of the
// digit strings so timing doesn't leak which window matched). Returns true/false.
export async function verifyTotp(secretBase32, code, atMs = Date.now()) {
  const clean = (code || '').toString().replace(/\D/g, '');
  if (clean.length !== TOTP_DIGITS) return false;
  const currentStep = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  const suppliedHex = asciiHex(clean);
  let matched = false;
  for (let w = -TOTP_DRIFT_WINDOWS; w <= TOTP_DRIFT_WINDOWS; w++) {
    const candidate = await totpAtStep(secretBase32, currentStep + w);
    // OR into `matched` without short-circuiting so every window is always
    // checked (no early-return timing signal).
    matched = timingSafeEqualHex(asciiHex(candidate), suppliedHex) || matched;
  }
  return matched;
}

// hex of the ASCII bytes of a short string — lets us feed digit strings to the
// existing constant-time hex comparator without adding a second comparator.
function asciiHex(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) out += str.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}

// ---- otpauth:// URI for the enrollment QR (rendered by `qrcode` on the client) ----
export function totpUri(secretBase32, accountLabel, issuer) {
  const iss = encodeURIComponent(issuer || 'Chhath Puja Portal');
  const label = encodeURIComponent(`${issuer || 'Chhath Puja Portal'}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: iss,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---- Backup codes (10 single-use) + recovery key (32-char) ----
// Backup codes: 10 chars from an unambiguous alphabet, shown as XXXXX-XXXXX.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function randomFromAlphabet(len, alphabet) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

// Returns { plain: ['ABCDE-FGHJK', ...], } — the PLAIN codes (shown once). Hashing
// is done separately so the caller stores only hashes.
export function generateBackupCodes(count = 10) {
  const plain = [];
  for (let i = 0; i < count; i++) {
    const raw = randomFromAlphabet(10, CODE_ALPHABET);
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return plain;
}

// A 32-character recovery key (shown once at enroll; can disable 2FA if the phone
// is lost). Grouped for readability but stored/compared normalised.
export function generateRecoveryKey() {
  const raw = randomFromAlphabet(32, CODE_ALPHABET);
  return raw.replace(/(.{4})/g, '$1-').replace(/-$/, ''); // XXXX-XXXX-...
}

// Normalise a user-typed backup code / recovery key: strip separators + spaces,
// upper-case, so "abcde-fghjk" and "ABCDEFGHJK" match.
export function normalizeCode(v) {
  return (v || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ---- PBKDF2 hashing for backup codes + recovery key ----
function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function pbkdf2(value, saltBytes) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(value), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    key, PBKDF2_KEYLEN_BYTES * 8
  );
  return toHex(bits);
}

// Self-describing hash: "pbkdf2$<iters>$<saltHex>$<hashHex>" (same format as
// auth.js). `value` is normalised by the caller before hashing.
export async function hashCode(value) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await pbkdf2(value, saltBytes);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(saltBytes)}$${hashHex}`;
}

// Constant-time verify of a normalised value against a stored pbkdf2$ hash.
export async function verifyCodeHash(value, storedHash) {
  const stored = (storedHash || '').toString();
  if (!stored.startsWith('pbkdf2$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const iterations = parseInt(parts[1], 10);
  const saltBytes = fromHex(parts[2]);
  const expected = parts[3];
  if (!iterations || !saltBytes.length) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(value), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key, PBKDF2_KEYLEN_BYTES * 8
  );
  return timingSafeEqualHex(toHex(bits), expected);
}

// Hash an array of plain backup codes (normalised) -> array of stored hashes.
export async function hashBackupCodes(plainCodes) {
  const out = [];
  for (const c of plainCodes) out.push(await hashCode(normalizeCode(c)));
  return out;
}
