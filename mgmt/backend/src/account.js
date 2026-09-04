import { getSheetDataAsJSON } from './crud.js';
import { requireAdminOrAbove, requireSuperadmin, PermissionError, ValidationError, hashPassword, verifyPassword } from './auth.js';
import { base64ToBytes, MAX_GENERIC_UPLOAD_BYTES } from './base64.js';

const ROLE_PERMISSIONS_KEYS = ['Superadmin', 'Admin', 'Subadmin'];

// Minimum length for any login password set/changed through the portal. The old
// code allowed 4 characters (or, for addLoginUser, no minimum at all) for
// accounts that can edit financial records — far too weak.
const MIN_PASSWORD_LENGTH = 8;

// hashPassword / verifyPassword now come from auth.js (PBKDF2 + per-user salt).

export async function getLoginUsers(env, user) {
  requireAdminOrAbove(user);
  const rows = await getSheetDataAsJSON(env, 'LOGIN');
  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  return rows.map(r => {
    const { password, ...safe } = r;
    return Object.assign({}, safe, {
      personName: (userMap[r.Name] && userMap[r.Name].Name) || r.Name,
      personVillage: (userMap[r.Name] && userMap[r.Name].Village) || '',
    });
  });
}

async function findLoginConflict(env, mobile, email, excludeName) {
  const rows = await getSheetDataAsJSON(env, 'LOGIN');
  for (const r of rows) {
    if (excludeName && (r.Name || '').toString().trim() === excludeName) continue;
    if (mobile && (r.Mobile || '').toString().trim() === mobile) {
      return `This mobile number is already registered to '${r.Name}'s login.`;
    }
    if (email && (r.Email || '').toString().trim().toLowerCase() === email.toLowerCase()) {
      return `This email is already registered to '${r.Name}'s login.`;
    }
  }
  return null;
}

export async function addLoginUser(env, userId, password, roleVal, mobile, email, user) {
  requireAdminOrAbove(user);
  if (user.role === 'Admin' && roleVal !== 'Subadmin') {
    throw PermissionError('You can only add Subadmin logins.');
  }
  if (!userId || !password || !roleVal) throw ValidationError('User, Password and Role are required.');
  if (password.toString().trim().length < MIN_PASSWORD_LENGTH) {
    throw ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (!ROLE_PERMISSIONS_KEYS.includes(roleVal)) throw ValidationError('Invalid role.');
  const mobileTrim = (mobile || '').toString().trim();
  const emailTrim = (email || '').toString().trim();
  if (!/^\d{10}$/.test(mobileTrim)) throw ValidationError('Mobile number must be 10 digits.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) throw ValidationError('A valid Email is required.');

  const existing = await env.DB_CORE.prepare('SELECT id FROM login_users WHERE name = ?').bind(userId.toString().trim()).first();
  if (existing) throw ValidationError('A login for this user already exists — please edit it instead.');
  const conflict = await findLoginConflict(env, mobileTrim, emailTrim, null);
  if (conflict) throw ValidationError(conflict);

  const hashed = await hashPassword(password.toString(), env.PASSWORD_SALT);
  await env.DB_CORE.prepare(
    'INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId.toString().trim(), mobileTrim, emailTrim, hashed, roleVal, new Date().toISOString()).run();
  return { success: true };
}

export async function updateLoginUser(env, rowIndex, password, roleVal, mobile, email, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw ValidationError('rowIndex required');
  if (!roleVal || !ROLE_PERMISSIONS_KEYS.includes(roleVal)) throw ValidationError('Invalid role.');
  const mobileTrim = (mobile || '').toString().trim();
  const emailTrim = (email || '').toString().trim();
  if (!/^\d{10}$/.test(mobileTrim)) throw ValidationError('Mobile number must be 10 digits.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) throw ValidationError('A valid Email is required.');

  const current = await env.DB_CORE.prepare('SELECT name FROM login_users WHERE id = ?').bind(rowIndex).first();
  const currentName = current ? current.name.trim() : null;
  const conflict = await findLoginConflict(env, mobileTrim, emailTrim, currentName);
  if (conflict) throw ValidationError(conflict);

  if (password) {
    if (password.toString().trim().length < MIN_PASSWORD_LENGTH) {
      throw ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const hashed = await hashPassword(password.toString(), env.PASSWORD_SALT);
    await env.DB_CORE.prepare(
      'UPDATE login_users SET role = ?, mobile = ?, email = ?, password = ?, updated_at = ? WHERE id = ?'
    ).bind(roleVal, mobileTrim, emailTrim, hashed, new Date().toISOString(), rowIndex).run();
  } else {
    await env.DB_CORE.prepare(
      'UPDATE login_users SET role = ?, mobile = ?, email = ?, updated_at = ? WHERE id = ?'
    ).bind(roleVal, mobileTrim, emailTrim, new Date().toISOString(), rowIndex).run();
  }
  return { success: true };
}

export async function deleteLoginUser(env, rowIndex, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw ValidationError('rowIndex required');
  await env.DB_CORE.prepare('DELETE FROM login_users WHERE id = ?').bind(rowIndex).run();
  return { success: true };
}

export async function updateOwnProfile(env, payload, user) {
  const ALLOWED = ['Mobile', 'Email', 'WhatsApp'];
  const COL_OF = { Mobile: 'mobile', Email: 'email', WhatsApp: 'whatsapp' };
  ['Mobile', 'WhatsApp'].forEach(f => {
    if (payload[f] !== undefined && payload[f] !== null && payload[f].toString().trim() !== '') {
      if (!/^\d{10}$/.test(payload[f].toString().trim())) throw ValidationError(f + ' must be 10 digits');
    }
  });
  const sets = [];
  const vals = [];
  ALLOWED.forEach(f => {
    if (payload[f] !== undefined) { sets.push(`${COL_OF[f]} = ?`); vals.push(payload[f]); }
  });
  if (!sets.length) return { success: true };
  vals.push(user.name.toString().trim());
  await env.DB_CORE.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id_code = ?`).bind(...vals).run();
  return { success: true };
}

export async function changePassword(env, currentPassword, newPassword, user) {
  if (!currentPassword || !newPassword) throw ValidationError('Current and new password required');
  if (newPassword.toString().trim().length < MIN_PASSWORD_LENGTH) {
    throw ValidationError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const row = await env.DB_CORE.prepare('SELECT id, password FROM login_users WHERE name = ?').bind(user.name).first();
  if (!row) throw ValidationError('Login record not found');

  // verifyPassword accepts both the legacy bare-SHA-256 hash and the new PBKDF2
  // format, and does a constant-time comparison.
  const { ok } = await verifyPassword(env, currentPassword.toString().trim(), row.password);
  if (!ok) throw ValidationError('Current password is incorrect');

  // The new password is always written in the new PBKDF2 format.
  const newHashed = await hashPassword(newPassword.toString().trim());
  await env.DB_CORE.prepare('UPDATE login_users SET password = ?, updated_at = ? WHERE id = ?')
    .bind(newHashed, new Date().toISOString(), row.id).run();
  return { success: true };
}

// ============ FILE UPLOAD (Drive REST API) ============
//
// Required Worker secrets: DRIVE_FOLDER_ID plus the three DRIVE_OAUTH_* values
// consumed by getDriveAccessToken() below.
// NOTE: the old TODO here named DRIVE_SA_EMAIL / DRIVE_SA_PRIVATE_KEY — that
// service-account path was replaced by the OAuth refresh-token flow and those two
// names are read by NO code anywhere. Don't set them; they do nothing.
// This mirrors Code.js's uploadFileToDrive() but over the REST API since Workers
// has no DriveApp equivalent.
// `opts.makePublic` (default true, to preserve the existing popup-image behaviour)
// controls whether the uploaded file is shared as {role:'reader', type:'anyone'}.
// SECURITY (audit S6): consent PHOTOS and SIGNATURES are sensitive personal data
// and must NOT be world-readable — the loans.js consent path now passes
// makePublic:false so those objects stay private to the Drive account.
export async function uploadFileToDrive(env, base64Data, fileName, mimeType, opts) {
  const makePublic = !opts || opts.makePublic !== false;
  if (!env.DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID not configured on server');
  const accessToken = await getDriveAccessToken(env);
  const boundary = 'chhathmgmt' + crypto.randomUUID();
  const metadata = { name: fileName, parents: [env.DRIVE_FOLDER_ID] };
  // Was: Uint8Array.from(atob(base64Data), c => c.charCodeAt(0)) — the per-char
  // callback is 15-23x slower than an indexed loop (552ms vs 24ms CPU for an 8 MB photo).
  // This helper also strips the data-URL prefix/whitespace; otherwise atob throws a
  // raw TypeError (4 rows in the log).
  // audit H-6: the generic upload path had no size limit at all.
  const bytes = base64ToBytes(base64Data, { label: fileName || 'File', maxBytes: MAX_GENERIC_UPLOAD_BYTES });

  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ]);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!uploadRes.ok) throw new Error('Drive upload failed: ' + await uploadRes.text());
  const { id } = await uploadRes.json();

  // Only grant public read when explicitly allowed (popup images). Sensitive
  // consent media is uploaded with makePublic:false and stays private.
  if (makePublic) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  }

  return {
    success: true,
    // Human-facing link (Drive's viewer page) — this does not work in <img src>.
    url: `https://drive.google.com/file/d/${id}/view`,
    // For <img src>. This was previously `uc?export=view&id=`, which 303-redirects
    // to `drive.usercontent.google.com`, where the response carries
    // `cross-origin-resource-policy: same-site` — meaning the browser BLOCKS it
    // when embedded from another site. This caused both popup images AND consent
    // photos/signatures to silently appear blank.
    // `lh3.googleusercontent.com` is Google's image CDN (ACAO *, no CORP).
    // Details: mgmt/frontend/src/driveUrl.js
    directUrl: `https://lh3.googleusercontent.com/d/${id}=w1600`,
    // If lh3 ever fails, this is another CORP-free endpoint.
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
    fileId: id,
  };
}

// OAuth refresh-token -> access token exchange (Drive scope, personal Gmail account).
// Cached in KV for ~55min (tokens are valid 60min) so we're not hitting Google on every call.
// Namespaced like every other key in this store (rl:, mgmtcache:, loginfail:,
// consentotp:, session:) so the contents are self-describing. The previous bare
// 'drive_access_token' key simply expires on its own within the hour.
const DRIVE_TOKEN_KEY = 'drive:access_token';

export async function getDriveAccessToken(env) {
  const cached = await env.KV_SESSIONS.get(DRIVE_TOKEN_KEY);
  if (cached) return cached;
  if (!env.DRIVE_OAUTH_CLIENT_ID || !env.DRIVE_OAUTH_CLIENT_SECRET || !env.DRIVE_OAUTH_REFRESH_TOKEN) {
    throw new Error('DRIVE_OAUTH_CLIENT_ID / DRIVE_OAUTH_CLIENT_SECRET / DRIVE_OAUTH_REFRESH_TOKEN not configured');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DRIVE_OAUTH_CLIENT_ID,
      client_secret: env.DRIVE_OAUTH_CLIENT_SECRET,
      refresh_token: env.DRIVE_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) throw new Error('Drive OAuth token refresh failed: ' + await res.text());
  const { access_token, expires_in } = await res.json();
  await env.KV_SESSIONS.put(DRIVE_TOKEN_KEY, access_token, { expirationTtl: Math.max(60, expires_in - 300) });
  return access_token;
}

// NOTE: pemToArrayBuffer() lived here to parse a service-account private key
// (DRIVE_SA_PRIVATE_KEY). That auth path was replaced by the OAuth refresh-token
// flow in getDriveAccessToken() above and this helper had ZERO callers left, so it
// was removed rather than left as a hint toward a credential the code ignores.
