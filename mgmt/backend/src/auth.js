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

// SHA-256 hex of an arbitrary string. Used to store only the HASH of a session
// token in the audit DB (user_sessions.token_hash) — so that DB never holds a
// value that could be replayed to hijack a live session.
async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return toHex(digest);
}

// last_seen is refreshed at most once per this window, to avoid a D1 write on
// every single authenticated request.
const SESSION_LASTSEEN_THROTTLE_MS = 5 * 60 * 1000; // 5 min

// Records one login attempt (success OR failure) in the audit DB. Best-effort:
// a failure here must NEVER affect the login result. The password is never
// touched; only the identifier that was typed is stored. Attempt volume is
// naturally bounded per IP by the lockout counter + index.js's per-IP rate
// limit, so this can't be used to flood the table.
async function recordLoginAttempt(env, { identifier, name, success, reason, ip, deviceInfo, locked }) {
  try {
    if (!env.DB_AUDIT) return;
    await env.DB_AUDIT.prepare(
      `INSERT INTO login_attempts (identifier, name, success, reason, ip, device_info, locked, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      (identifier || '').toString().slice(0, 120),
      name || null,
      success ? 1 : 0,
      reason || '',
      (ip || '').toString(),
      (deviceInfo || '').toString().slice(0, 400),
      locked ? 1 : 0,
      new Date().toISOString()
    ).run();
  } catch (e) { /* non-fatal */ }
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

export async function login(env, name, password, rememberMe, clientIp, deviceInfo) {
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
    await recordLoginAttempt(env, { identifier: name, name: null, success: false, reason: 'locked_out', ip, deviceInfo, locked: 1 });
    return { success: false, lockedOut: true, message: 'Too many attempts. Try again in a few minutes.' };
  }

  const user = await findLoginRowByIdentifier(env, name);
  // Even when the user does not exist, do the SAME PBKDF2 work against a dummy
  // hash so the response time doesn't reveal whether the identifier is
  // registered (user-enumeration hardening).
  const storedHash = user ? (user.password || '').trim() : DUMMY_PBKDF2_HASH;
  const { ok, needsUpgrade } = await verifyPassword(env, password.toString().trim(), storedHash);

  if (!user || !ok) {
    const newFails = fails + 1;
    await env.KV_SESSIONS.put(lockKey, String(newFails), { expirationTtl: LOGIN_LOCKOUT_SECONDS });
    // `unknown_user` vs `bad_password` is for the Superadmin audit view only —
    // the message returned to the client stays generic (no user enumeration).
    await recordLoginAttempt(env, {
      identifier: name, name: user ? user.name.trim() : null,
      success: false, reason: user ? 'bad_password' : 'unknown_user',
      ip, deviceInfo, locked: newFails >= MAX_LOGIN_ATTEMPTS ? 1 : 0,
    });
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
  const tokenHash = await sha256Hex(token);

  // The KV session also carries its own token hash so verifyToken can look the
  // session up in the audit DB (for remote-logout revocation + last-seen)
  // without ever needing the raw token again.
  await env.KV_SESSIONS.put(
    'session:' + token,
    JSON.stringify({ name: actualName, role: user.role, expiresAt, th: tokenHash }),
    { expirationTtl: Math.floor(ttl / 1000) }
  );

  // Record the session in the audit DB (device/IP/times) so the user — and a
  // Superadmin — can see active devices and remotely log any of them out.
  // Best-effort: a failure here must NEVER block a valid login.
  try {
    if (env.DB_AUDIT) {
      const now = new Date().toISOString();
      await env.DB_AUDIT.prepare(
        `INSERT INTO user_sessions (token_hash, name, role, ip, device_info, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(tokenHash, actualName, user.role, ip || '', (deviceInfo || '').toString().slice(0, 400), now, now, expiresAt).run();
    }
  } catch (e) { /* non-fatal: login still succeeds even if audit write fails */ }

  await recordLoginAttempt(env, { identifier: name, name: actualName, success: true, reason: 'ok', ip, deviceInfo, locked: 0 });

  return { success: true, token, name: actualName, role: user.role, expiresAt };
}

export async function doLogout(env, token) {
  await env.KV_SESSIONS.delete('session:' + token);
  // Mark the audit row revoked (kept for history) — best-effort.
  try {
    if (env.DB_AUDIT && token) {
      const th = await sha256Hex(token);
      await env.DB_AUDIT.prepare('UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(new Date().toISOString(), th).run();
    }
  } catch (e) { /* non-fatal */ }
  return { success: true };
}

export async function verifyToken(env, token) {
  if (!token) return null;
  const cached = await env.KV_SESSIONS.get('session:' + token);
  if (!cached) return null;
  let s;
  try { s = JSON.parse(cached); } catch (e) { return null; } // malformed session -> treat as invalid
  if (!s || Date.now() >= s.expiresAt) return null;

  // SECURITY (session revocation): the role was snapshotted into KV at login and,
  // with "remember me", the session lives up to 30 days. Without this check, a
  // Superadmin demoted to Subadmin — or a user whose login was DELETED — kept
  // their old rights until the session expired. Re-validate against the live
  // login_users row on every authenticated request:
  //   - login row gone   -> session is dead (deleted/renamed user)
  //   - role changed      -> use the CURRENT role, not the stale snapshot
  // This is one indexed single-row read (idx_login_users_name). It FAILS SAFE:
  // on any DB error we fall back to the cached session so a transient D1 blip
  // can't log every admin out mid-session.
  try {
    const row = await env.DB_CORE
      .prepare('SELECT role FROM login_users WHERE name = ? LIMIT 1')
      .bind(s.name).first();
    if (!row) return null;                 // login deleted -> revoke
    if (row.role && row.role !== s.role) {
      return { ...s, role: row.role };     // role changed -> enforce current role
    }
  } catch (e) {
    // Fall through with the cached session (fail-safe, availability over the
    // rare stale-role window during a DB outage).
  }

  // REMOTE LOGOUT: a user (or a Superadmin) can revoke a session from another
  // device. Since we only store the token HASH, we can't delete that other
  // device's KV entry directly — instead the revoke sets user_sessions.revoked_at
  // and this check rejects the session on its next request (its KV entry then
  // expires naturally). Also refresh last_seen, throttled. Best-effort / fail
  // safe: an audit-DB error never logs a valid user out.
  try {
    if (env.DB_AUDIT) {
      const th = s.th || (await sha256Hex(token));
      const row = await env.DB_AUDIT
        .prepare('SELECT revoked_at, last_seen_at FROM user_sessions WHERE token_hash = ? LIMIT 1')
        .bind(th).first();
      if (row && row.revoked_at) return null; // remotely logged out
      // Throttled last-seen update (only if we have a row and it's stale).
      if (row) {
        const last = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
        if (!last || (Date.now() - last) > SESSION_LASTSEEN_THROTTLE_MS) {
          await env.DB_AUDIT.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?')
            .bind(new Date().toISOString(), th).run();
        }
      }
    }
  } catch (e) { /* audit read/write is best-effort; never block a valid session */ }

  return s;
}

// ---- Active sessions / devices (audit DB) ----

// Maps a DB row to the shape the UI shows. `isCurrent` marks the caller's own
// session so the UI can label it and disable "log out this device" for it.
function sessionOut(row, currentHash) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    ip: row.ip || '',
    device: row.device_info || '',
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at || row.created_at,
    isCurrent: currentHash != null && row.token_hash === currentHash,
  };
}

// The caller's own active (non-revoked, non-expired) sessions.
export async function getMySessions(env, user, currentHash) {
  if (!env.DB_AUDIT) return { sessions: [] };
  const now = Date.now();
  const { results } = await env.DB_AUDIT.prepare(
    `SELECT * FROM user_sessions WHERE name = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY last_seen_at DESC`
  ).bind(user.name, now).all();
  return { sessions: (results || []).map(r => sessionOut(r, currentHash)) };
}

// Revoke ONE of the caller's own sessions by row id (can't revoke someone
// else's — the WHERE name = ? binds it to the caller).
export async function revokeSession(env, user, sessionId, currentHash) {
  if (!env.DB_AUDIT) throw ValidationError('Audit store not configured.');
  const row = await env.DB_AUDIT.prepare('SELECT token_hash FROM user_sessions WHERE id = ? AND name = ? LIMIT 1')
    .bind(sessionId, user.name).first();
  if (!row) throw ValidationError('Session not found.');
  await env.DB_AUDIT.prepare('UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND name = ?')
    .bind(new Date().toISOString(), sessionId, user.name).run();
  return { success: true, wasCurrent: currentHash != null && row.token_hash === currentHash };
}

// Revoke every OTHER session of the caller (keep the current device signed in).
export async function revokeAllOtherSessions(env, user, currentHash) {
  if (!env.DB_AUDIT) throw ValidationError('Audit store not configured.');
  await env.DB_AUDIT.prepare(
    'UPDATE user_sessions SET revoked_at = ? WHERE name = ? AND revoked_at IS NULL AND token_hash != ?'
  ).bind(new Date().toISOString(), user.name, currentHash || '').run();
  return { success: true };
}

// ---- Superadmin: view / force-logout ANY user's sessions ----

export async function getUserSessions(env, targetName, user) {
  requireSuperadmin(user);
  if (!env.DB_AUDIT) return { sessions: [] };
  const now = Date.now();
  const { results } = await env.DB_AUDIT.prepare(
    `SELECT * FROM user_sessions WHERE name = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY last_seen_at DESC`
  ).bind((targetName || '').toString().trim(), now).all();
  return { sessions: (results || []).map(r => sessionOut(r, null)) };
}

// Superadmin: recent login attempts for the audit page. Optional filters:
// name (login id), successOnly/failedOnly, limit (capped).
export async function getLoginAttempts(env, opts, user) {
  requireSuperadmin(user);
  if (!env.DB_AUDIT) return { attempts: [] };
  const o = opts || {};
  const limit = Math.min(Math.max(parseInt(o.limit) || 200, 1), 1000);
  const where = [];
  const args = [];
  if (o.name) { where.push('name = ?'); args.push(o.name.toString().trim()); }
  if (o.failedOnly) where.push('success = 0');
  else if (o.successOnly) where.push('success = 1');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { results } = await env.DB_AUDIT.prepare(
    `SELECT id, identifier, name, success, reason, ip, device_info, locked, created_at
       FROM login_attempts ${clause} ORDER BY id DESC LIMIT ?`
  ).bind(...args, limit).all();
  return { attempts: results || [] };
}

// ---- Superadmin: locked accounts + unlock ----

// Lists the accounts/IPs currently locked out. Lockout state lives in KV as
// `loginfail:<name>[:<ip>]` counters; an account is LOCKED when its counter has
// reached MAX_LOGIN_ATTEMPTS. We list that prefix and return only the locked
// ones, parsing name + ip out of the key.
export async function getLockedAccounts(env, user) {
  requireSuperadmin(user);
  if (!env.KV_SESSIONS || !env.KV_SESSIONS.list) return { locked: [] };
  const out = [];
  let cursor;
  do {
    const res = await env.KV_SESSIONS.list({ prefix: 'loginfail:', cursor });
    for (const k of res.keys || []) {
      const count = parseInt((await env.KV_SESSIONS.get(k.name)) || '0', 10) || 0;
      if (count >= MAX_LOGIN_ATTEMPTS) {
        // key = loginfail:<name>[:<ip>]  — name may itself contain no ':'.
        const rest = k.name.slice('loginfail:'.length);
        const lastColon = rest.lastIndexOf(':');
        // Heuristic: if the tail looks like an IP, split it off; else it's name-only.
        let name = rest, ip = '';
        if (lastColon > 0) {
          const tail = rest.slice(lastColon + 1);
          if (/^[0-9a-fA-F:.]+$/.test(tail)) { name = rest.slice(0, lastColon); ip = tail; }
        }
        out.push({ key: k.name, name, ip, attempts: count });
      }
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return { locked: out };
}

// Unlock ONE locked account/IP by deleting its KV counter (immediate — no 15-min
// wait). `key` is the exact KV key from getLockedAccounts; if not supplied it is
// rebuilt from name (+ optional ip).
export async function revokeLock(env, key, name, ip, user) {
  requireSuperadmin(user);
  let k = (key || '').toString().trim();
  if (!k) {
    const nm = (name || '').toString().trim();
    if (!nm) throw ValidationError('An account name or lock key is required.');
    k = ip ? `loginfail:${nm}:${ip}` : `loginfail:${nm}`;
  }
  if (!k.startsWith('loginfail:')) throw ValidationError('Invalid lock key.');
  await env.KV_SESSIONS.delete(k);
  return { success: true };
}

// Emergency: clear ALL lockout counters.
export async function revokeAllLocks(env, user) {
  requireSuperadmin(user);
  if (!env.KV_SESSIONS || !env.KV_SESSIONS.list) return { success: true, cleared: 0 };
  let cursor, cleared = 0;
  do {
    const res = await env.KV_SESSIONS.list({ prefix: 'loginfail:', cursor });
    for (const k of res.keys || []) { await env.KV_SESSIONS.delete(k.name); cleared++; }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return { success: true, cleared };
}

// Force-logout: revoke one session (by id) OR every active session of a user.
export async function revokeUserSession(env, targetName, sessionId, user) {
  requireSuperadmin(user);
  if (!env.DB_AUDIT) throw ValidationError('Audit store not configured.');
  const name = (targetName || '').toString().trim();
  const now = new Date().toISOString();
  if (sessionId) {
    await env.DB_AUDIT.prepare('UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND name = ?')
      .bind(now, sessionId, name).run();
  } else {
    await env.DB_AUDIT.prepare('UPDATE user_sessions SET revoked_at = ? WHERE name = ? AND revoked_at IS NULL')
      .bind(now, name).run();
  }
  return { success: true };
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
  const allowed = ROLE_PERMISSIONS[user && user.role] || [];
  if (!allowed.includes(action)) {
    throw PermissionError(`Your role (${(user && user.role) || 'unknown'}) does not have permission for this action.`);
  }
  // SECURITY (audit C-1): this restriction used to be gated on
  // `action === 'add'`, so a Subadmin's sheet scope silently disappeared for any
  // other action. A Subadmin holds only 'add' today, so that was not directly
  // exploitable — but the omission is exactly the shape of the Admin-level hole
  // fixed in crud.js (see GENERIC_CRUD_SHEETS), and granting a Subadmin 'edit'
  // later would have reopened it. Scope EVERY action.
  if ((user && user.role) === 'Subadmin' && sheetName) {
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
