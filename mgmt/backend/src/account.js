import { getSheetDataAsJSON } from './crud.js';
import { requireAdminOrAbove, requireSuperadmin, PermissionError, ValidationError, hashPassword, verifyPassword, InternalError, revokeSessionsFor } from './auth.js';
import { base64ToBytes, MAX_GENERIC_UPLOAD_BYTES } from './base64.js';
import { assertTenDigits, assertEmail } from './validate.js'; // audit Q-1: shared field validators

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
  // audit Q-1: shared validators (validate.js) — same messages as before, one impl.
  const mobileTrim = assertTenDigits(mobile, 'Mobile number', { required: true });
  const emailTrim = assertEmail(email, { required: true });

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
  // audit Q-1: shared validators (validate.js) — same messages as before, one impl.
  const mobileTrim = assertTenDigits(mobile, 'Mobile number', { required: true });
  const emailTrim = assertEmail(email, { required: true });

  const current = await env.DB_CORE.prepare('SELECT name FROM login_users WHERE id = ?').bind(rowIndex).first();
  const currentName = current ? current.name.trim() : null;
  const conflict = await findLoginConflict(env, mobileTrim, emailTrim, currentName);
  if (conflict) throw ValidationError(conflict);

  let sessionsRevoked = 0;
  if (password) {
    if (password.toString().trim().length < MIN_PASSWORD_LENGTH) {
      throw ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const hashed = await hashPassword(password.toString(), env.PASSWORD_SALT);
    await env.DB_CORE.prepare(
      'UPDATE login_users SET role = ?, mobile = ?, email = ?, password = ?, updated_at = ? WHERE id = ?'
    ).bind(roleVal, mobileTrim, emailTrim, hashed, new Date().toISOString(), rowIndex).run();

    // audit H-15: a Superadmin resetting someone's password is usually doing it
    // BECAUSE that account may be compromised. Leaving the account's existing
    // sessions alive (up to 30 days with "remember me") defeats the reset
    // entirely. Sparing `user.th` means: if the Superadmin is resetting their OWN
    // login here, they stay signed in; for anyone else's login their own hash
    // matches nothing, so every session of the target is revoked. One rule,
    // correct in both cases.
    sessionsRevoked = await revokeSessionsFor(env, currentName, { exceptHash: user.th });
  } else {
    await env.DB_CORE.prepare(
      'UPDATE login_users SET role = ?, mobile = ?, email = ?, updated_at = ? WHERE id = ?'
    ).bind(roleVal, mobileTrim, emailTrim, new Date().toISOString(), rowIndex).run();
    // NOTE: a ROLE change deliberately does not revoke anything — verifyToken
    // re-reads `role` from login_users on every request and enforces the current
    // value, so a demotion takes effect immediately without signing anyone out.
  }
  return { success: true, sessionsRevoked };
}

export async function deleteLoginUser(env, rowIndex, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw ValidationError('rowIndex required');

  // audit H-15: read the name BEFORE deleting so the account's live sessions can
  // be revoked. verifyToken() does already reject a session whose login_users row
  // has vanished — but that check sits inside a try/catch that intentionally
  // falls through to the cached session on a DB error (availability over a stale
  // role window). Revoking explicitly means a deleted login is signed out even
  // during a core-DB wobble, and immediately rather than on its next request.
  const row = await env.DB_CORE.prepare('SELECT name FROM login_users WHERE id = ?').bind(rowIndex).first();

  await env.DB_CORE.prepare('DELETE FROM login_users WHERE id = ?').bind(rowIndex).run();

  const sessionsRevoked = row && row.name
    ? await revokeSessionsFor(env, row.name) // no exception: the login is gone
    : 0;
  return { success: true, sessionsRevoked };
}

export async function updateOwnProfile(env, payload, user) {
  const ALLOWED = ['Mobile', 'Email', 'WhatsApp'];
  const COL_OF = { Mobile: 'mobile', Email: 'email', WhatsApp: 'whatsapp' };
  ['Mobile', 'WhatsApp'].forEach(f => {
    if (payload[f] !== undefined && payload[f] !== null && payload[f].toString().trim() !== '') {
      if (!/^\d{10}$/.test(payload[f].toString().trim())) throw ValidationError(f + ' must be 10 digits');
    }
  });
  // audit M-8: Mobile and WhatsApp were validated; Email was written completely
  // raw, so a member's stored address could be any string at all. It is the
  // address receipts and certificates carry, and the placeholder builders read it
  // straight out of this column, so a typo silently produces a wrong document.
  // Uses the same regex addLoginUser applies, and allows clearing the field.
  //
  // NOTE: my audit report also claimed a duplicate here could hijack email login.
  // That is WRONG and the claim is withdrawn — login resolves the identifier
  // against `login_users` (auth.js:249), while this function writes the `users`
  // table. They are different tables; there is no auth impact. Uniqueness is a
  // data-quality question, so it is deliberately not enforced here (two family
  // members legitimately sharing one email address is normal in this committee).
  if (payload.Email !== undefined && payload.Email !== null && payload.Email.toString().trim() !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.Email.toString().trim())) {
      throw ValidationError('A valid Email is required.');
    }
  }
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

  // audit H-15: sign every OTHER device out. A session is validated against its
  // KV blob and never re-checks the password hash, so before this the old
  // password's sessions stayed alive for their full 8 hours — or THIRTY DAYS with
  // "remember me" — after the change. Anyone who had the old credentials kept
  // access, which is precisely what changing a password is meant to stop.
  //
  // The caller's own session is spared (`exceptHash: user.th`) so changing your
  // password does not immediately log you out of the screen you are on.
  // Best-effort: a failure here must not undo a completed password change.
  const revoked = await revokeSessionsFor(env, user.name, { exceptHash: user.th });

  return {
    success: true,
    otherSessionsRevoked: revoked, // -1 when it could not be determined
    message: revoked > 0
      ? `Password changed. ${revoked} other signed-in device${revoked === 1 ? '' : 's'} ${revoked === 1 ? 'was' : 'were'} signed out.`
      : 'Password changed.',
  };
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
  if (!env.DRIVE_FOLDER_ID) throw InternalError('DRIVE_FOLDER_ID not configured on server');
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
  if (!uploadRes.ok) throw InternalError('Drive upload failed: ' + await uploadRes.text());
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
  // ROBUSTNESS: this used to be a bare `env.KV_SESSIONS.get(...)`, so a KV outage —
  // or simply a deployment where the binding is absent — threw
  // "Cannot read properties of undefined (reading 'get')" and took down EVERY Drive
  // operation: template reads, PDF generation, popup and consent uploads. KV here is
  // only a 55-minute cache in front of a token we can always re-mint, so it must be
  // strictly best-effort. (Found by the P-4 caching tests.)
  const cached = env.KV_SESSIONS
    ? await env.KV_SESSIONS.get(DRIVE_TOKEN_KEY).catch(() => null)
    : null;
  if (cached) return cached;
  if (!env.DRIVE_OAUTH_CLIENT_ID || !env.DRIVE_OAUTH_CLIENT_SECRET || !env.DRIVE_OAUTH_REFRESH_TOKEN) {
    throw InternalError('DRIVE_OAUTH_CLIENT_ID / DRIVE_OAUTH_CLIENT_SECRET / DRIVE_OAUTH_REFRESH_TOKEN not configured');
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
  if (!res.ok) throw InternalError('Drive OAuth token refresh failed: ' + await res.text());
  const { access_token, expires_in } = await res.json();
  // Best-effort, for the same reason as the read above: failing to CACHE a token
  // must never fail the operation that needs the token.
  if (env.KV_SESSIONS) {
    await env.KV_SESSIONS.put(DRIVE_TOKEN_KEY, access_token, { expirationTtl: Math.max(60, expires_in - 300) }).catch(() => {});
  }
  return access_token;
}

// NOTE: pemToArrayBuffer() lived here to parse a service-account private key
// (DRIVE_SA_PRIVATE_KEY). That auth path was replaced by the OAuth refresh-token
// flow in getDriveAccessToken() above and this helper had ZERO callers left, so it
// was removed rather than left as a hint toward a credential the code ignores.
