// ============================================================================
// Forgot / Reset Password — emailed 6-digit code (login page, no session).
//
// Flow (decisions confirmed with the team):
//   1. requestPasswordReset(name): the user types their identifier (name / mobile
//      / email). We FIND it against the Login Management list (login_users) and
//      return a DISTINCT outcome:
//        * found + has email        -> a 6-digit code is emailed; {sent:true,
//                                       maskedEmail} is returned.
//        * found + NO email on file -> {code:'NO_EMAIL'} ("contact committee admin").
//        * not found                -> {code:'NOT_FOUND'} ("no account found").
//        * per-account cap exceeded -> {code:'RATE_LIMITED', retryAfterSeconds}.
//      NOTE: this is intentionally NOT anti-enumeration — the team asked for clear,
//      distinct feedback so a real user immediately knows whether their account
//      exists / can receive a code. Brute-force is still bounded by the per-account
//      3/hour cap, the per-IP 20/min cap (index.js), and the timing floor below.
//   2. resetPassword(name, code, newPassword): verify the code (bound to that
//      exact user), enforce password strength by role, write the new PBKDF2 hash,
//      revoke ALL sessions, and email a "your password was changed" notification.
//      We do NOT auto-log-in — the user returns to the login screen, so a
//      Superadmin's 2FA is still enforced on the next login.
//
// Security additions layered on top of the base flow:
//   (1) TIMING: every response is padded to a random 150–350 ms floor (the
//       not-found path included) so response time doesn't leak extra signal.
//   (2) PER-ACCOUNT RATE LIMIT: max 3 reset requests / account / hour (KV), in
//       addition to the per-IP 20/min cap enforced by index.js. When exceeded we
//       return RATE_LIMITED + retryAfterSeconds for a client-side countdown.
//   (3) NOTIFICATION EMAIL: on a successful change, a second email is sent with
//       the time + IP and a "if this wasn't you, contact the committee admin" note.
//   (5) TOKEN BINDING: the KV challenge stores the login row's id; resetPassword
//       requires BOTH the code AND the matching identifier, and re-checks the
//       resolved row id === the bound id, so a code minted for one user can never
//       reset another.
//   (6) PASSWORD STRENGTH BY ROLE: Superadmin resets require 12+ chars with at
//       least one uppercase, one lowercase and one digit; other roles require 8+.
//
// Mirrors the twoFactor.js emailed-token recovery pattern and reuses auth.js's
// hashPassword / verifyPassword-format / revokeSessionsFor primitives.
// ============================================================================

import { hashPassword, revokeSessionsFor, findLoginRowByIdentifier, timingSafeEqualHex } from './auth.js';
import { sendViaResend } from './email.js';
import { randomOtp } from './random.js';

// ---- KV keys / limits ----
const RESET_PREFIX = 'pwreset:code:';          // pwreset:code:<name> -> challenge JSON
const RESET_TTL_SECONDS = 15 * 60;             // a reset code lives 15 minutes
const RESET_MAX_VERIFY_ATTEMPTS = 5;           // wrong-code attempts before the code is burned

const PER_ACCOUNT_PREFIX = 'pwreset:acct:';    // pwreset:acct:<name> -> count (per hour)
const PER_ACCOUNT_MAX_PER_HOUR = 3;            // addition (2): 3 requests / account / hour
const PER_ACCOUNT_WINDOW_SECONDS = 60 * 60;

const MIN_PASSWORD_LENGTH = 8;                 // matches account.js
const SUPERADMIN_MIN_LENGTH = 12;              // addition (6)

// ---- addition (1): constant-ish timing ----
// Pad every response to at least a random 150–350 ms floor (the not-found path
// included) so response time doesn't leak extra signal.
function randomDelayMs() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return 150 + (buf[0] % 201); // 150..350 ms
}
async function withMinDelay(startedAt, result) {
  const target = randomDelayMs();
  const elapsed = Date.now() - startedAt;
  if (elapsed < target) await new Promise(r => setTimeout(r, target - elapsed));
  return result;
}

// Masks an email for display: "superadmin@gmail.com" -> "s••••••••n@g•••.com".
// Enough to confirm which address received the code without revealing it in full.
function maskEmail(email) {
  const e = (email || '').toString().trim();
  const at = e.indexOf('@');
  if (at < 1) return '••••';
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const maskPart = (s, keepStart, keepEnd) => {
    if (s.length <= keepStart + keepEnd) return s[0] ? s[0] + '•••' : '•••';
    return s.slice(0, keepStart) + '•'.repeat(Math.max(3, s.length - keepStart - keepEnd)) + s.slice(s.length - keepEnd);
  };
  const dot = domain.lastIndexOf('.');
  const domName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${maskPart(local, 1, 1)}@${maskPart(domName, 1, 0)}${tld}`;
}

// ---- addition (6): role-based password policy ----
export function validatePasswordForRole(role, password) {
  const pw = (password || '').toString();
  const isSuper = (role || '').toString().trim() === 'Superadmin';
  if (isSuper) {
    if (pw.length < SUPERADMIN_MIN_LENGTH) {
      return `Superadmin passwords must be at least ${SUPERADMIN_MIN_LENGTH} characters.`;
    }
    if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw)) {
      return 'Superadmin passwords must include an uppercase letter, a lowercase letter and a number.';
    }
    return null;
  }
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

// ---- addition (2): per-account request cap (3/hour) ----
// Fixed-window counter keyed on the resolved login name. Returns
// { allowed, retryAfterSeconds } — when blocked, retryAfterSeconds is how long
// until the current hour bucket rolls over (for a client-side countdown). Fails
// OPEN on KV trouble so a KV hiccup can never permanently block a legitimate reset.
async function accountRequestAllowed(env, name) {
  if (!env || !env.KV_SESSIONS) return { allowed: true, retryAfterSeconds: 0 };
  try {
    const nowMs = Date.now();
    const windowMs = PER_ACCOUNT_WINDOW_SECONDS * 1000;
    const bucket = Math.floor(nowMs / windowMs);
    const key = `${PER_ACCOUNT_PREFIX}${name}:${bucket}`;
    const current = parseInt((await env.KV_SESSIONS.get(key)) || '0', 10) || 0;
    if (current >= PER_ACCOUNT_MAX_PER_HOUR) {
      const retryAfterSeconds = Math.max(1, Math.ceil(((bucket + 1) * windowMs - nowMs) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    await env.KV_SESSIONS.put(key, String(current + 1), { expirationTtl: PER_ACCOUNT_WINDOW_SECONDS + 5 });
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (e) { return { allowed: true, retryAfterSeconds: 0 }; }
}

// hex of the ASCII bytes of a short string, so digit codes can go through the
// existing constant-time hex comparator.
function asciiHex(str) {
  let out = '';
  const s = (str || '').toString();
  for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}

// ============================================================================
// Step 1 — request a reset code
// ============================================================================
export async function requestPasswordReset(env, name, ip) {
  const startedAt = Date.now();

  if (!name || !name.toString().trim()) {
    return withMinDelay(startedAt, {
      success: false, code: 'NOT_FOUND',
      message: 'Enter your username, mobile, or email.',
    });
  }
  const identifier = name.toString().trim();

  // FIND against the Login Management list (login_users). name / 10-digit mobile /
  // email are all resolved here (email COLLATE NOCASE).
  const row = await findLoginRowByIdentifier(env, identifier);

  // Not found -> distinct NOT_FOUND (team decision: clear feedback, not anti-enum).
  if (!row) {
    return withMinDelay(startedAt, {
      success: false, code: 'NOT_FOUND',
      message: 'No account found with that username, mobile, or email.',
    });
  }

  const loginName = row.name.toString().trim();

  // Found but NO email on file -> can't email a code; tell them to contact an admin.
  if (!row.email || !row.email.toString().trim()) {
    return withMinDelay(startedAt, {
      success: false, code: 'NO_EMAIL',
      message: 'This account has no email on file. Contact a committee admin to reset your password.',
    });
  }

  // addition (2): per-account cap (3/hour). When exceeded, return RATE_LIMITED with
  // retryAfterSeconds for a client-side countdown.
  const cap = await accountRequestAllowed(env, loginName);
  if (!cap.allowed) {
    const mins = Math.max(1, Math.ceil(cap.retryAfterSeconds / 60));
    return withMinDelay(startedAt, {
      success: false, code: 'RATE_LIMITED',
      retryAfterSeconds: cap.retryAfterSeconds,
      message: `Too many reset requests. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
    });
  }

  // addition (5): token binding — the challenge is stored under the login NAME and
  // also records the login row id; resetPassword must match both.
  const code = randomOtp(); // CSPRNG 6-digit
  const challenge = {
    userId: row.id,
    name: loginName,
    role: row.role,
    attempts: 0,
    createdAt: Date.now(),
  };
  const key = RESET_PREFIX + loginName;
  await env.KV_SESSIONS.put(
    key,
    JSON.stringify({ ...challenge, code }),
    { expirationTtl: RESET_TTL_SECONDS }
  );

  const subject = 'Chhath Puja Portal — password reset code';
  const body =
    `A password reset was requested for your Chhath Puja Portal account.\n\n` +
    `Your one-time reset code (valid 15 minutes):\n\n    ${code}\n\n` +
    `Enter it on the "Forgot password" screen along with your new password.\n\n` +
    `If you did NOT request this, ignore this email — your password is unchanged.`;

  // Best-effort send (never throws).
  await sendViaResend(env, { to: row.email.toString().trim(), subject, body }).catch(() => {});

  return withMinDelay(startedAt, {
    success: true,
    sent: true,
    maskedEmail: maskEmail(row.email),
    message: `A 6-digit reset code has been sent to ${maskEmail(row.email)}.`,
  });
}

// ============================================================================
// Step 2 — reset with the emailed code
// ============================================================================
export async function resetPassword(env, name, code, newPassword, ip) {
  const startedAt = Date.now();
  const GENERIC_FAIL = { success: false, message: 'The reset code is invalid or has expired.' };

  if (!name || !code || !newPassword) return withMinDelay(startedAt, GENERIC_FAIL);
  const identifier = name.toString().trim();

  // Resolve the identifier the SAME way the request did.
  const row = await findLoginRowByIdentifier(env, identifier);
  if (!row || !row.name) return withMinDelay(startedAt, GENERIC_FAIL);

  const key = RESET_PREFIX + row.name.toString().trim();
  const raw = await env.KV_SESSIONS.get(key);
  if (!raw) return withMinDelay(startedAt, GENERIC_FAIL);

  let challenge;
  try { challenge = JSON.parse(raw); }
  catch (e) { await env.KV_SESSIONS.delete(key); return withMinDelay(startedAt, GENERIC_FAIL); }

  // addition (5): token binding — the challenge's bound userId MUST equal the
  // resolved row id. A code minted for one account can never reset another.
  if (challenge.userId !== row.id) {
    await env.KV_SESSIONS.delete(key);
    return withMinDelay(startedAt, GENERIC_FAIL);
  }

  // Attempt cap: burn the code after too many wrong tries.
  if ((challenge.attempts || 0) >= RESET_MAX_VERIFY_ATTEMPTS) {
    await env.KV_SESSIONS.delete(key);
    return withMinDelay(startedAt, GENERIC_FAIL);
  }

  // Constant-time compare of the 6-digit code.
  const supplied = (code || '').toString().replace(/\D/g, '');
  const ok = supplied.length === 6 && timingSafeEqualHex(asciiHex(supplied), asciiHex(challenge.code));
  if (!ok) {
    challenge.attempts = (challenge.attempts || 0) + 1;
    if (challenge.attempts >= RESET_MAX_VERIFY_ATTEMPTS) {
      await env.KV_SESSIONS.delete(key);
    } else {
      const remaining = Math.max(30, RESET_TTL_SECONDS - Math.floor((Date.now() - challenge.createdAt) / 1000));
      await env.KV_SESSIONS.put(key, JSON.stringify(challenge), { expirationTtl: remaining });
    }
    return withMinDelay(startedAt, GENERIC_FAIL);
  }

  // addition (6): password strength by role. This is a REAL user-facing message
  // (the code was already correct), so surface the specific rule.
  const strengthErr = validatePasswordForRole(row.role, newPassword.toString());
  if (strengthErr) {
    // Do NOT burn the code — let the user retry with a stronger password. The
    // attempt counter is not incremented (the code was valid).
    return withMinDelay(startedAt, { success: false, message: strengthErr });
  }

  // Success — burn the code (single-use), write the new hash, revoke ALL sessions.
  await env.KV_SESSIONS.delete(key);
  const newHash = await hashPassword(newPassword.toString().trim());
  await env.DB_CORE.prepare('UPDATE login_users SET password = ?, updated_at = ? WHERE id = ?')
    .bind(newHash, new Date().toISOString(), row.id).run();

  // Revoke every session for this account (a reset-because-compromised must cut
  // any existing session — no exception, this is an unauthenticated reset).
  let revoked = 0;
  try { revoked = await revokeSessionsFor(env, row.name.toString().trim(), {}); }
  catch (e) { revoked = -1; }

  // addition (3): notification email with time + IP.
  if (row.email && row.email.toString().trim()) {
    const when = new Date().toISOString();
    const fromIp = (ip || '').toString().trim() || 'unknown';
    const subject = 'Chhath Puja Portal — your password was changed';
    const body =
      `Your Chhath Puja Portal password was just changed.\n\n` +
      `Time: ${when}\n` +
      `IP:   ${fromIp}\n\n` +
      `If this was you, no action is needed — sign in with your new password.\n\n` +
      `If this was NOT you, contact a committee admin immediately: your account may be compromised.`;
    await sendViaResend(env, { to: row.email.toString().trim(), subject, body }).catch(() => {});
  }

  // No auto-login (confirmed) — the user returns to the login screen, so a
  // Superadmin's 2FA is still enforced on the next sign-in.
  return withMinDelay(startedAt, {
    success: true,
    message: 'Your password has been reset. Please sign in with your new password.',
    sessionsRevoked: revoked,
  });
}
