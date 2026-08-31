import { getSheetDataAsJSON } from './crud.js';
import { requireAdminOrAbove, requireSuperadmin, PermissionError } from './auth.js';

const ROLE_PERMISSIONS_KEYS = ['Superadmin', 'Admin', 'Subadmin'];

async function hashPassword(pw, salt) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(pw + salt));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

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
      return `Ye Mobile number pehle se '${r.Name}' ke login mein registered hai.`;
    }
    if (email && (r.Email || '').toString().trim().toLowerCase() === email.toLowerCase()) {
      return `Ye Email pehle se '${r.Name}' ke login mein registered hai.`;
    }
  }
  return null;
}

export async function addLoginUser(env, userId, password, roleVal, mobile, email, user) {
  requireAdminOrAbove(user);
  if (user.role === 'Admin' && roleVal !== 'Subadmin') {
    throw PermissionError('Aap sirf Subadmin login add kar sakte hain.');
  }
  if (!userId || !password || !roleVal) throw new Error('User, Password aur Role zaroori hai.');
  if (!ROLE_PERMISSIONS_KEYS.includes(roleVal)) throw new Error('Invalid role.');
  const mobileTrim = (mobile || '').toString().trim();
  const emailTrim = (email || '').toString().trim();
  if (!/^\d{10}$/.test(mobileTrim)) throw new Error('Mobile number 10 digits ka hona chahiye.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) throw new Error('Valid Email zaroori hai.');

  const existing = await env.DB_CORE.prepare('SELECT id FROM login_users WHERE name = ?').bind(userId.toString().trim()).first();
  if (existing) throw new Error('Is user ka login pehle se maujood hai — edit karein.');
  const conflict = await findLoginConflict(env, mobileTrim, emailTrim, null);
  if (conflict) throw new Error(conflict);

  const hashed = await hashPassword(password.toString(), env.PASSWORD_SALT);
  await env.DB_CORE.prepare(
    'INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId.toString().trim(), mobileTrim, emailTrim, hashed, roleVal, new Date().toISOString()).run();
  return { success: true };
}

export async function updateLoginUser(env, rowIndex, password, roleVal, mobile, email, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw new Error('rowIndex required');
  if (!roleVal || !ROLE_PERMISSIONS_KEYS.includes(roleVal)) throw new Error('Invalid role.');
  const mobileTrim = (mobile || '').toString().trim();
  const emailTrim = (email || '').toString().trim();
  if (!/^\d{10}$/.test(mobileTrim)) throw new Error('Mobile number 10 digits ka hona chahiye.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) throw new Error('Valid Email zaroori hai.');

  const current = await env.DB_CORE.prepare('SELECT name FROM login_users WHERE id = ?').bind(rowIndex).first();
  const currentName = current ? current.name.trim() : null;
  const conflict = await findLoginConflict(env, mobileTrim, emailTrim, currentName);
  if (conflict) throw new Error(conflict);

  if (password) {
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
  if (!rowIndex) throw new Error('rowIndex required');
  await env.DB_CORE.prepare('DELETE FROM login_users WHERE id = ?').bind(rowIndex).run();
  return { success: true };
}

export async function updateOwnProfile(env, payload, user) {
  const ALLOWED = ['Mobile', 'Email', 'WhatsApp'];
  const COL_OF = { Mobile: 'mobile', Email: 'email', WhatsApp: 'whatsapp' };
  ['Mobile', 'WhatsApp'].forEach(f => {
    if (payload[f] !== undefined && payload[f] !== null && payload[f].toString().trim() !== '') {
      if (!/^\d{10}$/.test(payload[f].toString().trim())) throw new Error(f + ' 10 digits ka hona chahiye');
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
  if (!currentPassword || !newPassword) throw new Error('Current and new password required');
  if (newPassword.toString().trim().length < 4) throw new Error('New password kam se kam 4 characters ka ho');

  const row = await env.DB_CORE.prepare('SELECT id, password FROM login_users WHERE name = ?').bind(user.name).first();
  if (!row) throw new Error('Login record not found');

  const currentHashed = await hashPassword(currentPassword.toString().trim(), env.PASSWORD_SALT);
  if ((row.password || '').toString().trim() !== currentHashed) throw new Error('Current password galat hai');

  const newHashed = await hashPassword(newPassword.toString().trim(), env.PASSWORD_SALT);
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
export async function uploadFileToDrive(env, base64Data, fileName, mimeType) {
  if (!env.DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID not configured on server');
  const accessToken = await getDriveAccessToken(env);
  const boundary = 'chhathmgmt' + crypto.randomUUID();
  const metadata = { name: fileName, parents: [env.DRIVE_FOLDER_ID] };
  const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

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

  await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return {
    success: true,
    url: `https://drive.google.com/file/d/${id}/view`,
    directUrl: `https://drive.google.com/uc?export=view&id=${id}`,
  };
}

// OAuth refresh-token -> access token exchange (Drive scope, personal Gmail account).
// Cached in KV for ~55min (tokens are valid 60min) so we're not hitting Google on every call.
export async function getDriveAccessToken(env) {
  const cached = await env.KV_SESSIONS.get('drive_access_token');
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
  await env.KV_SESSIONS.put('drive_access_token', access_token, { expirationTtl: Math.max(60, expires_in - 300) });
  return access_token;
}

// NOTE: pemToArrayBuffer() lived here to parse a service-account private key
// (DRIVE_SA_PRIVATE_KEY). That auth path was replaced by the OAuth refresh-token
// flow in getDriveAccessToken() above and this helper had ZERO callers left, so it
// was removed rather than left as a hint toward a credential the code ignores.
