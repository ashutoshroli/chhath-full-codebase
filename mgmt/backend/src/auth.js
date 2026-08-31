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
  return e;
}

// A message meant FOR THE USER: wrong PIN, wrong OTP, expired link, "already
// exists", "not found", missing required field. Also NOT a defect.
//
// Why this exists: the Error Log filled up with ~50 rows of "Galat PIN",
// "Sirf Superadmin ye action kar sakta hai", "OTP galat hai", "Ye Email pehle se
// registered hai" etc., which buried the handful of REAL defects (278 rows, 276
// unreported). Anything thrown as a ValidationError is still returned to the user
// exactly as before — it just isn't recorded as a system error.
export function ValidationError(message) {
  const e = new Error(message);
  e.authError = false;
  e.expected = true;
  return e;
}

async function hashPassword(pw, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(pw + salt);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
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

export async function login(env, name, password, rememberMe) {
  if (!name || !password) return { success: false, message: 'Name and password required' };
  name = name.toString().trim();

  const lockKey = 'loginfail:' + name;
  const fails = parseInt((await env.KV_SESSIONS.get(lockKey)) || '0');
  if (fails >= MAX_LOGIN_ATTEMPTS) {
    // `lockedOut` lets index.js log ONLY the lockout instead of every wrong
    // password (see isExpectedError there).
    return { success: false, lockedOut: true, message: 'Too many attempts. Try again in a few minutes.' };
  }

  const user = await findLoginRowByIdentifier(env, name);
  const hashed = await hashPassword(password.toString().trim(), env.PASSWORD_SALT);

  if (!user || user.password.trim() !== hashed) {
    await env.KV_SESSIONS.put(lockKey, String(fails + 1), { expirationTtl: LOGIN_LOCKOUT_SECONDS });
    return { success: false, message: 'Invalid Username/Mobile/Email or Password' };
  }
  await env.KV_SESSIONS.delete(lockKey);

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
  if (!req.apiKey || req.apiKey !== env.WHATSAPP_QUEUE_API_KEY) {
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
    throw PermissionError(`Aapke role (${user.role || 'unknown'}) ko is action ki permission nahi hai.`);
  }
  if (action === 'add' && user.role === 'Subadmin' && sheetName) {
    const normalized = sheetName.toString().trim().toUpperCase();
    if (!SUBADMIN_ADD_SHEETS.includes(normalized)) {
      throw PermissionError('Aapka role sirf User aur Contribution add kar sakta hai.');
    }
  }
}

export function requireSuperadmin(user) {
  if (user.role !== 'Superadmin') throw PermissionError('Sirf Superadmin ye action kar sakta hai.');
}
export function requireAdminOrAbove(user) {
  if (user.role !== 'Superadmin' && user.role !== 'Admin') throw PermissionError('Sirf Admin ya Superadmin ye action kar sakta hai.');
}
export function requireStaffRole(user) {
  if (!['Superadmin', 'Admin', 'Subadmin'].includes(user.role)) {
    throw PermissionError(`Aapke role (${user.role || 'unknown'}) ko is action ki permission nahi hai.`);
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
    throw PermissionError('Ye year lock hai — is year mein add/edit/delete allowed nahi hai.');
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
    throw PermissionError('Aap sirf un saalon ka data add/edit kar sakte hain jis saal aap khud Committee member the.');
  }
}
