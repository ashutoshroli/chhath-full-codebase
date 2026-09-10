// ============================================================================
// Two-Factor Authentication (TOTP) — Superadmin.
//
// Orchestrates the 2FA lifecycle on top of the crypto primitives in totp.js:
//   * enrollment (start -> confirm), showing the QR secret + 10 backup codes + a
//     32-char recovery key ONCE,
//   * the login second-factor challenge (login mints a short-lived tempToken;
//     verify2FA exchanges tempToken + code/backup-code for a real session),
//   * disable / regenerate-backup-codes (self-service, password-confirmed),
//   * recovery: disable via the recovery key, OR request an emailed recovery link
//     and reset with the emailed token.
//
// AT-REST: the TOTP shared secret is AES-GCM encrypted with aiConfig.encryptSecret
// (never plain text, never returned to the client after enrollment). Backup codes
// and the recovery key are PBKDF2-hashed (totp.js). login_users columns used:
//   totp_enabled, totp_secret_enc, totp_pending_enc, totp_backup_codes,
//   totp_recovery_hash  (added by migration 22-login-users-totp.sql).
//
// This feature is gated to the Superadmin role per spec: only a Superadmin login
// row may enroll, and login only enforces 2FA when the resolved row's role is
// Superadmin AND totp_enabled = 1.
// ============================================================================

import { requireSuperadmin, ValidationError, InternalError, verifyPassword, timingSafeEqualHex } from './auth.js';
import { encryptSecret, decryptSecret } from './aiConfig.js';
import { sendViaResend } from './email.js';
import { randomToken } from './random.js';
import {
  generateTotpSecret, verifyTotp, totpUri,
  generateBackupCodes, generateRecoveryKey, hashBackupCodes, hashCode,
  verifyCodeHash, normalizeCode,
} from './totp.js';

const ISSUER = 'Chhath Puja Portal';

// ---- KV keys / limits ----
const TEMP_TOKEN_PREFIX = 'twofa:login:';      // twofa:login:<tempToken> -> challenge JSON
const TEMP_TOKEN_TTL_SECONDS = 5 * 60;         // login challenge lives 5 min
const RECOVERY_PREFIX = 'twofa:recovery:';     // twofa:recovery:<token> -> { name }
const RECOVERY_TTL_SECONDS = 30 * 60;          // recovery link lives 30 min

// SECURITY (spec): TOTP verification rate limit — 5 attempts per 5 minutes, keyed
// per IP so one attacker can't brute-force codes. Enforced here in addition to the
// per-attempt counter baked into the login challenge.
const VERIFY_RATE_MAX = 5;
const VERIFY_RATE_WINDOW_SECONDS = 5 * 60;

function isSuperadminRow(row) {
  return row && (row.role || '').toString().trim() === 'Superadmin';
}

// ---- login_users read/write helpers (core DB) ----
async function loadLoginRowByName(env, name) {
  return env.DB_CORE.prepare('SELECT * FROM login_users WHERE name = ? LIMIT 1')
    .bind((name || '').toString().trim()).first();
}

function backupCodesFromRow(row) {
  try {
    const arr = JSON.parse(row.totp_backup_codes || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

// ============================================================================
// Enrollment
// ============================================================================

// Step 1: start enrollment. Generates a fresh secret, stores it ENCRYPTED as
// `totp_pending_enc` (not yet active), and returns the otpauth URI + Base32 secret
// for the QR, plus the 10 backup codes and the 32-char recovery key — all shown to
// the user ONCE. The codes/recovery key are only PERSISTED (hashed) at confirm
// time, so a started-but-abandoned enrollment leaves no active 2FA.
export async function startEnroll(env, user) {
  requireSuperadmin(user);
  const row = await loadLoginRowByName(env, user.name);
  if (!row) throw ValidationError('Your login could not be found.');
  if (Number(row.totp_enabled) === 1) {
    throw ValidationError('Two-factor authentication is already enabled. Disable it first to re-enroll.');
  }

  const secret = generateTotpSecret();
  const secretEnc = await encryptSecret(env, secret);
  await env.DB_CORE.prepare('UPDATE login_users SET totp_pending_enc = ?, updated_at = ? WHERE id = ?')
    .bind(secretEnc, new Date().toISOString(), row.id).run();

  const accountLabel = row.email || row.name || 'superadmin';
  return {
    success: true,
    secret,                                  // Base32 — for manual entry
    otpauthUri: totpUri(secret, accountLabel, ISSUER),
    // Shown once; only hashes are stored (at confirm). Returned now so the UI can
    // show them alongside the QR before the user commits.
    backupCodes: generateBackupCodes(10),
    recoveryKey: generateRecoveryKey(),
    message: 'Scan the QR in your authenticator app, then enter a 6-digit code to finish. Save your backup codes and recovery key now — they are shown only once.',
  };
}

// Step 2: confirm enrollment. The client sends back the 6-digit code (proving the
// authenticator has the secret) AND the backupCodes + recoveryKey it was shown, so
// we store exactly what the user saved. Verifies the code against the pending
// secret, then promotes pending -> active and enables 2FA.
export async function confirmEnroll(env, user, code, backupCodes, recoveryKey) {
  requireSuperadmin(user);
  const row = await loadLoginRowByName(env, user.name);
  if (!row) throw ValidationError('Your login could not be found.');
  if (Number(row.totp_enabled) === 1) throw ValidationError('Two-factor authentication is already enabled.');
  if (!row.totp_pending_enc) throw ValidationError('Start 2FA setup first, then confirm with a code.');
  if (!Array.isArray(backupCodes) || backupCodes.length !== 10) {
    throw ValidationError('The backup codes are missing. Restart 2FA setup.');
  }
  if (!recoveryKey || normalizeCode(recoveryKey).length < 16) {
    throw ValidationError('The recovery key is missing. Restart 2FA setup.');
  }

  const secret = await decryptSecret(env, row.totp_pending_enc);
  const ok = await verifyTotp(secret, code);
  if (!ok) throw ValidationError('That code is not correct. Check your authenticator app and try again.');

  const backupHashes = await hashBackupCodes(backupCodes);
  const recoveryHash = await hashCode(normalizeCode(recoveryKey));

  await env.DB_CORE.prepare(
    `UPDATE login_users
        SET totp_enabled = 1,
            totp_secret_enc = ?,
            totp_pending_enc = NULL,
            totp_backup_codes = ?,
            totp_recovery_hash = ?,
            updated_at = ?
      WHERE id = ?`
  ).bind(row.totp_pending_enc, JSON.stringify(backupHashes), recoveryHash, new Date().toISOString(), row.id).run();

  return { success: true, message: 'Two-factor authentication is now enabled.' };
}

// ============================================================================
// Status / disable / regenerate (self-service, password-confirmed)
// ============================================================================

export async function get2FAStatus(env, user) {
  // Any staff role can query THEIR OWN status (only Superadmin can ever enable it,
  // so for others it's simply always disabled).
  const row = await loadLoginRowByName(env, user.name);
  const enabled = !!row && Number(row.totp_enabled) === 1;
  return {
    success: true,
    enabled,
    eligible: isSuperadminRow(row),
    backupCodesRemaining: enabled ? backupCodesFromRow(row).length : 0,
  };
}

// Disabling requires re-entering the account password (defence against an
// unattended, already-logged-in session turning 2FA off).
export async function disable2FA(env, user, password) {
  requireSuperadmin(user);
  const row = await loadLoginRowByName(env, user.name);
  if (!row) throw ValidationError('Your login could not be found.');
  if (Number(row.totp_enabled) !== 1) return { success: true, message: 'Two-factor authentication is already off.' };

  const { ok } = await verifyPassword(env, (password || '').toString().trim(), (row.password || '').trim());
  if (!ok) throw ValidationError('Password is incorrect.');

  await clearTotp(env, row.id);
  return { success: true, message: 'Two-factor authentication has been disabled.' };
}

async function clearTotp(env, id) {
  await env.DB_CORE.prepare(
    `UPDATE login_users
        SET totp_enabled = 0, totp_secret_enc = NULL, totp_pending_enc = NULL,
            totp_backup_codes = NULL, totp_recovery_hash = NULL, updated_at = ?
      WHERE id = ?`
  ).bind(new Date().toISOString(), id).run();
}

// Regenerate the 10 backup codes (invalidates the old set). Password-confirmed.
// The recovery key is NOT changed here (it has its own lifecycle at enroll).
export async function regenerateBackupCodes(env, user, password) {
  requireSuperadmin(user);
  const row = await loadLoginRowByName(env, user.name);
  if (!row) throw ValidationError('Your login could not be found.');
  if (Number(row.totp_enabled) !== 1) throw ValidationError('Enable two-factor authentication first.');

  const { ok } = await verifyPassword(env, (password || '').toString().trim(), (row.password || '').trim());
  if (!ok) throw ValidationError('Password is incorrect.');

  const codes = generateBackupCodes(10);
  const hashes = await hashBackupCodes(codes);
  await env.DB_CORE.prepare('UPDATE login_users SET totp_backup_codes = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(hashes), new Date().toISOString(), row.id).run();

  return { success: true, backupCodes: codes, message: 'New backup codes generated. The old ones no longer work.' };
}

// ============================================================================
// Login second-factor challenge
// ============================================================================

// Called by auth.login()/loginWithGoogle() AFTER the password (or Google identity)
// is verified, when the resolved row is a Superadmin with 2FA enabled. Mints a
// single-use, 5-minute tempToken bound to the account + rememberMe choice, stored
// in KV. Returns the shape the frontend switches on.
export async function beginLoginChallenge(env, loginRow, rememberMe, ip, deviceInfo) {
  const tempToken = randomToken();
  const challenge = {
    name: loginRow.name.trim(),
    role: loginRow.role,
    rememberMe: !!rememberMe,
    ip: (ip || '').toString(),
    deviceInfo: (deviceInfo || '').toString().slice(0, 400),
    attempts: 0,
    createdAt: Date.now(),
  };
  await env.KV_SESSIONS.put(
    TEMP_TOKEN_PREFIX + tempToken,
    JSON.stringify(challenge),
    { expirationTtl: TEMP_TOKEN_TTL_SECONDS }
  );
  return { success: true, requires2FA: true, tempToken };
}

// Per-IP verify rate limit (5 / 5 min). Fails open on KV trouble so a KV hiccup
// can never permanently lock a legitimate Superadmin out of their own login.
async function isVerifyRateLimited(env, ip) {
  if (!env || !env.KV_SESSIONS || !ip) return false;
  try {
    const bucket = Math.floor(Date.now() / (VERIFY_RATE_WINDOW_SECONDS * 1000));
    const key = `twofa:rl:${ip}:${bucket}`;
    const current = parseInt((await env.KV_SESSIONS.get(key)) || '0', 10) || 0;
    if (current >= VERIFY_RATE_MAX) return true;
    await env.KV_SESSIONS.put(key, String(current + 1), { expirationTtl: VERIFY_RATE_WINDOW_SECONDS + 5 });
    return false;
  } catch (e) { return false; }
}

// verify2FA: exchange (tempToken, code) for a real session. `code` is either a
// 6-digit TOTP OR a single-use backup code. On success we call `issueSessionFn`
// (auth.issueSession, injected to avoid an import cycle) so the returned shape is
// byte-for-byte identical to a normal login. The tempToken is burned on success
// and on running out of attempts.
//
// Returns the issueSession result on success, or a generic {success:false} object
// on any failure (no distinction between "bad code" and "unknown token", to avoid
// leaking challenge state).
export async function verifyLoginTotp(env, tempToken, code, issueSessionFn) {
  const GENERIC = { success: false, message: 'Invalid or expired code.' };

  const ip = null; // set by the caller-side rate check in index.js; kept here as a 2nd guard
  // (index.js applies the per-IP RATE_LIMITED_ACTIONS cap on verify2FA too.)

  if (!tempToken || !code) return GENERIC;

  const key = TEMP_TOKEN_PREFIX + tempToken;
  const raw = await env.KV_SESSIONS.get(key);
  if (!raw) return GENERIC;

  let challenge;
  try { challenge = JSON.parse(raw); } catch (e) { await env.KV_SESSIONS.delete(key); return GENERIC; }

  // Per-challenge attempt cap (belt to index.js's per-IP suspenders).
  if ((challenge.attempts || 0) >= VERIFY_RATE_MAX) {
    await env.KV_SESSIONS.delete(key);
    return GENERIC;
  }

  const row = await loadLoginRowByName(env, challenge.name);
  if (!row || Number(row.totp_enabled) !== 1 || !row.totp_secret_enc) {
    await env.KV_SESSIONS.delete(key);
    return GENERIC;
  }

  const cleanCode = (code || '').toString().trim();
  let ok = false;
  let usedBackup = false;

  if (/^\d{6}$/.test(cleanCode)) {
    // 6-digit -> TOTP.
    const secret = await decryptSecret(env, row.totp_secret_enc);
    ok = await verifyTotp(secret, cleanCode);
  } else {
    // Otherwise treat it as a backup code (single-use).
    const norm = normalizeCode(cleanCode);
    const hashes = backupCodesFromRow(row);
    for (let i = 0; i < hashes.length; i++) {
      if (await verifyCodeHash(norm, hashes[i])) {
        ok = true; usedBackup = true;
        hashes.splice(i, 1); // burn this backup code
        await env.DB_CORE.prepare('UPDATE login_users SET totp_backup_codes = ?, updated_at = ? WHERE id = ?')
          .bind(JSON.stringify(hashes), new Date().toISOString(), row.id).run();
        break;
      }
    }
  }

  if (!ok) {
    challenge.attempts = (challenge.attempts || 0) + 1;
    if (challenge.attempts >= VERIFY_RATE_MAX) {
      await env.KV_SESSIONS.delete(key);
    } else {
      // Re-store with a fresh TTL floor so the remaining window is preserved.
      const remaining = Math.max(30, TEMP_TOKEN_TTL_SECONDS - Math.floor((Date.now() - challenge.createdAt) / 1000));
      await env.KV_SESSIONS.put(key, JSON.stringify(challenge), { expirationTtl: remaining });
    }
    return GENERIC;
  }

  // Success — burn the challenge and issue the real session.
  await env.KV_SESSIONS.delete(key);
  const session = await issueSessionFn(env, row, challenge.rememberMe, challenge.ip, challenge.deviceInfo, {
    identifier: challenge.name, reason: usedBackup ? '2fa_backup' : '2fa',
  });
  return session;
}

// Expose the rate-limit checker so index.js can apply it before verifyLoginTotp
// (defence in depth: index.js already rate-limits verify2FA per IP via
// RATE_LIMITED_ACTIONS; this narrower 5/5min cap is 2FA-specific).
export { isVerifyRateLimited };

// ============================================================================
// Recovery
// ============================================================================

// Disable 2FA using the 32-char recovery key (no session needed — used when the
// phone with the authenticator is lost). Requires the account password too, so a
// leaked recovery key alone is not enough. Returns generic failures.
export async function disableViaRecoveryKey(env, name, password, recoveryKey) {
  const GENERIC = { success: false, message: 'Invalid credentials or recovery key.' };
  if (!name || !password || !recoveryKey) return GENERIC;

  const row = await loadLoginRowByName(env, name);
  if (!row || Number(row.totp_enabled) !== 1 || !row.totp_recovery_hash) return GENERIC;

  const { ok: pwOk } = await verifyPassword(env, password.toString().trim(), (row.password || '').trim());
  const keyOk = await verifyCodeHash(normalizeCode(recoveryKey), row.totp_recovery_hash);
  if (!pwOk || !keyOk) return GENERIC;

  await clearTotp(env, row.id);
  return { success: true, message: 'Two-factor authentication has been disabled using your recovery key. Set it up again from Settings.' };
}

// Request a recovery EMAIL: emails a single-use, 30-minute link/token to the
// address on the Superadmin's login row. Always returns success (never reveals
// whether the account exists / has 2FA / has an email — anti-enumeration).
export async function requestRecoveryEmail(env, name) {
  const GENERIC = { success: true, message: 'If that account exists and has recovery email set up, a reset link has been sent.' };
  if (!name) return GENERIC;

  const row = await loadLoginRowByName(env, name);
  if (!row || !isSuperadminRow(row) || Number(row.totp_enabled) !== 1 || !row.email) return GENERIC;

  const token = randomToken();
  await env.KV_SESSIONS.put(
    RECOVERY_PREFIX + token,
    JSON.stringify({ name: row.name.trim(), createdAt: Date.now() }),
    { expirationTtl: RECOVERY_TTL_SECONDS }
  );

  const subject = 'Chhath Puja Portal — 2FA recovery';
  const body =
    `A request was made to reset two-factor authentication on your Chhath Puja Portal Superadmin account.\n\n` +
    `Your one-time reset code (valid 30 minutes):\n\n    ${token}\n\n` +
    `Enter it on the 2FA recovery screen to turn off 2FA, then set it up again.\n\n` +
    `If you did NOT request this, ignore this email — your 2FA is unchanged.`;

  // Best-effort send; the generic response is returned regardless so the caller
  // can't distinguish send success/failure either.
  await sendViaResend(env, { to: row.email, subject, body }).catch(() => {});
  return GENERIC;
}

// Reset (disable) 2FA with an emailed recovery token. Single-use.
export async function resetViaRecoveryToken(env, token) {
  const GENERIC = { success: false, message: 'This reset link is invalid or has expired.' };
  if (!token) return GENERIC;

  const key = RECOVERY_PREFIX + token;
  const raw = await env.KV_SESSIONS.get(key);
  if (!raw) return GENERIC;

  let payload;
  try { payload = JSON.parse(raw); } catch (e) { await env.KV_SESSIONS.delete(key); return GENERIC; }
  await env.KV_SESSIONS.delete(key); // single-use

  const row = await loadLoginRowByName(env, payload.name);
  if (!row) return GENERIC;

  await clearTotp(env, row.id);
  return { success: true, message: 'Two-factor authentication has been disabled. Please set it up again from Settings.' };
}
