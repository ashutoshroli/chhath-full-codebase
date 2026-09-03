// ============ AUTH (ported from Code.js AUTH + ROLE PERMISSIONS + YEAR LOCKING sections) ============
//
// Sessions live in Workers KV (see MIGRATION_NOTES.md for why), not D1.
// Everything else (LOGIN table, LOCKED YEARS, MANUAL YEARS) lives in `core` D1.

const SESSION_SHORT_MS = 8 * 60 * 60 * 1000;      // 8 hours (not "remember me") — matches Code.js exactly
const SESSION_LONG_MS = 30 * 24 * 60 * 60 * 1000; // 30 days ("remember me") — matches Code.js exactly
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 900; // 15 min — matches Code.js exactly

export function AuthError(message) {
  const e = new Error(message);
  e.authError = true;
  e.expected = true; // a session timing out is routine, not a defect
  return e;
}
// A policy denial (wrong role, bad API key). This is NORMAL operation, not a
// defect — a Subadmin opening a Superadmin-only screen must not fill the Error
// Log. Marked `expected` so index.js's top-level catch skips logging it.
export function PermissionError(message) {
  const e = new Error(message);
  e.authError = false;
  e.expected = true;
  e.permission = true; // lets the router map this to HTTP 403 (vs 400 for validation)
  return e;
}

// A message meant FOR THE USER: wrong PIN, wrong OTP, expired link, "already
// exists", "not found", missing required field. Also NOT a defect.
//
// Why this exists: the Error Log filled up with ~50 rows of "Incorrect PIN",
// "Only a Superadmin can perform this action", "Incorrect OTP", "This email is
// already registered" etc., which buried the handful of REAL defects (278 rows, 276
// unreported). Anything thrown as a ValidationError is still returned to the user
// exactly as before — it just isn't recorded as a system error.
export function ValidationError(message) {
  const e = new Error(message);
  e.authError = false;
  e.expected = true;
  return e;
}

// ---- Password hashing ----
//
// SECURITY: passwords used to be stored as a bare SHA-256 hex digest of
// `pw + PASSWORD_SALT` — a single global salt and a fast, unsalted-per-user
// primitive, i.e. trivially GPU-brute-forceable and identical for identical
// passwords if the DB ever leaked.
//
// New hashes use PBKDF2-HMAC-SHA-256 with a per-user random salt and are stored
// in a SELF-DESCRIBING format so the scheme/iterations can be changed later
// without a migration:
//     pbkdf2$<iterations>$<saltHex>$<hashHex>
//
// Legacy bare-hex digests are still ACCEPTED at verify time (so nobody is locked
// out) and transparently UPGRADED to the new format on the next successful login
// or password change. See verifyPassword() / hashPassword() below.
// Cloudflare Workers' Web Crypto caps PBKDF2 at 100,000 iterations — anything
// higher throws "iteration counts above 100000 are not supported", which broke
// every password change / new PIN. 100000 is Cloudflare's max and still a solid
// PBKDF2-SHA256 work factor. Because each hash stores its OWN iteration count in
// the self-describing "pbkdf2$<iterations>$..." format, any existing hashes
// (including old 210000 ones, if any were ever written) still verify correctly —
// only newly GENERATED hashes use this value.
const PBKDF2_ITERATIONS = 100000; // Cloudflare Workers PBKDF2 maximum
const PBKDF2_KEYLEN_BYTES = 32;

// A well-formed PBKDF2 hash (correct format + iteration count) that no real
// password can produce, used ONLY so an unknown-user login still performs one
// full PBKDF2 derivation — keeping response time independent of whether the
// account exists. The salt/hash bytes are fixed placeholders.
const DUMMY_PBKDF2_HASH =
  `pbkdf2$${PBKDF2_ITERATIONS}$` +
  '00000000000000000000000000000000$' +
  '0000000000000000000000000000000000000000000000000000000000000000';

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Constant-time comparison of two hex strings — avoids leaking, via response
// timing, how many leading characters of a hash/token matched.
export function timingSafeEqualHex(a, b) {
  const x = (a || '').toString();
  const y = (b || '').toString();
  // Comparing the full length of the longer string keeps the loop count
  // independent of where the first difference is.
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// Legacy scheme (kept only for verifying + upgrading old rows).
async function legacySha256(pw, salt) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(pw + salt));
  return toHex(digest);
}

async function pbkdf2Hash(pw, saltBytes, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    PBKDF2_KEYLEN_BYTES * 8
  );
  return toHex(bits);
}

// Produces a new-format PBKDF2 hash with a fresh random per-user salt.
export async function hashPassword(pw, _globalSaltUnused) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await pbkdf2Hash(pw, saltBytes, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(saltBytes)}$${hashHex}`;
}

// Verifies a supplied password against a stored hash of EITHER format.
// Returns { ok, needsUpgrade } — needsUpgrade is true when a legacy bare-hex
// hash matched and should be re-hashed into the new format by the caller.
export async function verifyPassword(env, pw, storedHash) {
  const stored = (storedHash || '').toString().trim();
  if (!stored) return { ok: false, needsUpgrade: false };

  if (stored.startsWith('pbkdf2$')) {
    const parts = stored.split('$');
    if (parts.length !== 4) return { ok: false, needsUpgrade: false };
    const iterations = parseInt(parts[1], 10);
    const saltBytes = fromHex(parts[2]);
    const expected = parts[3];
    if (!iterations || !saltBytes.length) return { ok: false, needsUpgrade: false };
    const actual = await pbkdf2Hash(pw, saltBytes, iterations);
    return { ok: timingSafeEqualHex(actual, expected), needsUpgrade: false };
  }

  // Legacy bare SHA-256 hex digest.
  const legacy = await legacySha256(pw, env.PASSWORD_SALT);
  return { ok: timingSafeEqualHex(legacy, stored), needsUpgrade: true };
}

function detectLoginIdentifierType(v) {
  const s = v.toString().trim();
  if (/^\d{10}$/.test(s)) return 'mobile';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'email';
  return 'name';
}

async function findLoginRowByIdentifier(env, identifier) {
  const type = detectLoginIdentifierType(identifier);
  const val = identifier.toString().trim();
  const col = type === 'mobile' ? 'mobile' : type === 'email' ? 'email' : 'name';
  const collate = type === 'email' ? 'COLLATE NOCASE' : '';
  const row = await env.DB_CORE.prepare(
    `SELECT * FROM login_users WHERE ${col} = ? ${collate} LIMIT 1`
  ).bind(val).first();
  return row || null;
}

export async function login(env, name, password, rememberMe, clientIp) {
  if (!name || !password) return { success: false, message: 'Name and password required' };
  name = name.toString().trim();

  // SECURITY (audit 1.1): the lockout counter used to key on the raw supplied
  // identifier ALONE ('loginfail:' + name). That let an attacker lock any known
  // user out for 15 min just by sending 5 bad attempts against their
  // name/mobile/email (an account-lockout DoS). Keying on identifier + edge IP
  // means an attacker's bad guesses only lock out THEIR OWN IP, never a
  // legitimate user's login, while a real user hammering their own password from
  // one device is still throttled. The per-IP request rate limit in index.js is
  // the second layer against distributed guessing. (Falls back to the old
  // identifier-only key if the edge IP is somehow unavailable.)
  const ip = (clientIp || '').toString().trim();
  const lockKey = ip ? `loginfail:${name}:${ip}` : `loginfail:${name}`;
  const fails = parseInt((await env.KV_SESSIONS.get(lockKey)) || '0');
  if (fails >= MAX_LOGIN_ATTEMPTS) {
    // `lockedOut` lets index.js log ONLY the lockout instead of every wrong
    // password (see isExpectedError there).
    return { success: false, lockedOut: true, message: 'Too many attempts. Try again in a few minutes.' };
  }

  const user = await findLoginRowByIdentifier(env, name);
  // Even when the user does not exist, do the SAME PBKDF2 work against a dummy
  // hash so the response time doesn't reveal whether the identifier is
  // registered (user-enumeration hardening).
  const storedHash = user ? (user.password || '').trim() : DUMMY_PBKDF2_HASH;
  const { ok, needsUpgrade } = await verifyPassword(env, password.toString().trim(), storedHash);

  if (!user || !ok) {
    await env.KV_SESSIONS.put(lockKey, String(fails + 1), { expirationTtl: LOGIN_LOCKOUT_SECONDS });
    return { success: false, message: 'Invalid Username/Mobile/Email or Password' };
  }
  await env.KV_SESSIONS.delete(lockKey);

  // Transparently migrate a legacy bare-SHA-256 row to PBKDF2 now that we hold
  // the plaintext and know it's correct. Best-effort — a failure here must never
  // block a valid login.
  if (needsUpgrade) {
    try {
      const upgraded = await hashPassword(password.toString().trim());
      await env.DB_CORE.prepare('UPDATE login_users SET password = ?, updated_at = ? WHERE id = ?')
        .bind(upgraded, new Date().toISOString(), user.id).run();
    } catch (e) { /* non-fatal: login still succeeds, upgrade retried next time */ }
  }

  const actualName = user.name.trim();
  const token = crypto.randomUUID();
  const ttl = rememberMe ? SESSION_LONG_MS : SESSION_SHORT_MS;
  const expiresAt = Date.now() + ttl;

  await env.KV_SESSIONS.put(
    'session:' + token,
    JSON.stringify({ name: actualName, role: user.role, expiresAt }),
    { expirationTtl: Math.floor(ttl / 1000) }
  );

  return { success: true, token, name: actualName, role: user.role, expiresAt };
}

export async function doLogout(env, token) {
  await env.KV_SESSIONS.delete('session:' + token);
  return { success: true };
}

export async function verifyToken(env, token) {
  if (!token) return null;
  const cached = await env.KV_SESSIONS.get('session:' + token);
  if (!cached) return null;
  const s = JSON.parse(cached);
  if (Date.now() >= s.expiresAt) return null;
  return s;
}

export async function withAuth(env, req, fn) {
  const user = await verifyToken(env, req.token);
  if (!user) throw AuthError('Session expired, please login again');
  return fn(user);
}

export function withApiKey(env, req, fn) {
  // Constant-time compare so the queue API key can't be recovered one character
  // at a time via response-timing differences.
  if (!req.apiKey || !env.WHATSAPP_QUEUE_API_KEY || !timingSafeEqualHex(
    Array.from(req.apiKey.toString()).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    Array.from(env.WHATSAPP_QUEUE_API_KEY.toString()).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  )) {
    throw PermissionError('Invalid API key');
  }
  return fn();
}

// ---- Role permissions (unchanged from Code.js ROLE_PERMISSIONS) ----
const ROLE_PERMISSIONS = {
  Superadmin: ['add', 'edit', 'delete'],
  Admin: ['add', 'edit'],
  Subadmin: ['add'],
};
const SUBADMIN_ADD_SHEETS = ['USERS', 'COLLECTIONS'];

export function requireRole(user, action, sheetName) {
  const allowed = ROLE_PERMISSIONS[user.role] || [];
  if (!allowed.includes(action)) {
    throw PermissionError(`Your role (${user.role || 'unknown'}) does not have permission for this action.`);
  }
  if (action === 'add' && user.role === 'Subadmin' && sheetName) {
    const normalized = sheetName.toString().trim().toUpperCase();
    if (!SUBADMIN_ADD_SHEETS.includes(normalized)) {
      throw PermissionError('Your role can only add Users and Contributions.');
    }
  }
}

export function requireSuperadmin(user) {
  if (user.role !== 'Superadmin') throw PermissionError('Only a Superadmin can perform this action.');
}
export function requireAdminOrAbove(user) {
  if (user.role !== 'Superadmin' && user.role !== 'Admin') throw PermissionError('Only an Admin or Superadmin can perform this action.');
}
export function requireStaffRole(user) {
  if (!['Superadmin', 'Admin', 'Subadmin'].includes(user.role)) {
    throw PermissionError(`Your role (${user.role || 'unknown'}) does not have permission for this action.`);
  }
}

// ---- Year locking ----
export async function getLockedYearsSet(env) {
  const { results } = await env.DB_CORE.prepare('SELECT year FROM locked_years').all();
  return new Set(results.map(r => parseInt(r.year)));
}

export async function lockYear(env, year, user) {
  requireSuperadmin(user);
  const y = parseInt(year);
  if (!y) throw new Error('Valid year required');
  const existing = await env.DB_CORE.prepare('SELECT id FROM locked_years WHERE year = ?').bind(y).first();
  if (!existing) {
    await env.DB_CORE.prepare('INSERT INTO locked_years (year, lockedby, lockedat) VALUES (?, ?, ?)')
      .bind(y, user.name, new Date().toISOString()).run();
  }
  return { success: true };
}

export async function unlockYear(env, year, user) {
  requireSuperadmin(user);
  const y = parseInt(year);
  await env.DB_CORE.prepare('DELETE FROM locked_years WHERE year = ?').bind(y).run();
  return { success: true };
}

export async function requireYearUnlocked(env, year) {
  if (!year || year === 'All') return;
  const y = parseInt(year);
  if (!y) return;
  const locked = await getLockedYearsSet(env);
  if (locked.has(y)) {
    throw PermissionError('This year is locked — add/edit/delete is not allowed for this year.');
  }
}

export async function getCommitteeYearsForName(env, name) {
  const n = (name || '').toString().trim();
  const { results } = await env.DB_CORE.prepare('SELECT DISTINCT year FROM committee_members WHERE name = ?').bind(n).all();
  return new Set(results.map(r => parseInt(r.year)).filter(y => !isNaN(y)));
}

export async function requireYearAccess(env, user, year) {
  if (!year || year === 'All') return;
  if (user.role === 'Superadmin') return;
  const y = parseInt(year);
  if (!y) return;
  const years = await getCommitteeYearsForName(env, user.name);
  if (!years.has(y)) {
    throw PermissionError('You can only add/edit data for the years in which you were a Committee member.');
  }
}
