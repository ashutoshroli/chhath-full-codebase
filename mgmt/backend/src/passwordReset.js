// ============================================================================
// Forgot / Reset Password — emailed 6-digit code (login page, no session).
//
// Flow (decisions confirmed with the team):
//   1. requestPasswordReset(name): the user types their identifier (name / mobile
//      / email). If it resolves to a login with an email on file, we email a
//      single-use 6-digit CODE (not a link — a scanner-following link could burn
//      the code before the user sees it). The response is ALWAYS generic
//      (anti-enumeration).
//   2. resetPassword(name, code, newPassword): verify the code (bound to that
//      exact user), enforce password strength by role, write the new PBKDF2 hash,
//      revoke ALL sessions, and email a "your password was changed" notification.
//      We do NOT auto-log-in — the user returns to the login screen, so a
//      Superadmin's 2FA is still enforced on the next login.
//
// Six extra security additions layered on top of the base flow:
//   (1) TIMING: every response is padded to a random 100–300 ms floor so valid vs
//       invalid identifiers are indistinguishable by response time.
//   (2) PER-ACCOUNT RATE LIMIT: max 3 reset requests / account / hour (KV), in
//       addition to the per-IP 20/min cap enforced by index.js.
//   (3) NOTIFICATION EMAIL: on a successful change, a second email is sent with
//       the time + IP and a "if this wasn't you, contact the committee admin" note.
//   (4) NO-EMAIL HANDLING: an account with no email on file cannot receive a code;
//       we still return the SAME generic message (no enumeration) — the person is
//       told out-of-band to contact an admin.
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

// One generic message for BOTH request outcomes (exists / doesn't / no email) so
// nothing about the account can be inferred (additions 4 + timing 1).
const GENERIC_REQUEST_MESSAGE =
  'If an account matches and has an email on file, a 6-digit reset code has been sent. '
  + 'If you have no email on file, contact a committee admin to reset your password.';

// ---- addition (1): constant-ish timing ----
// Pad every response to at least a random 100–300 ms floor. Combined with the fact
// that we still do the DB lookup on the not-found path, valid and invalid
// identifiers become indistinguishable by timing.
function randomDelayMs() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return 100 + (buf[0] % 201); // 100..300 ms
}
async function withMinDelay(startedAt, result) {
  const target = randomDelayMs();
  const elapsed = Date.now() - startedAt;
  if (elapsed < target) await new Promise(r => setTimeout(r, target - elapsed));
  return result;
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
// Fixed-window counter keyed on the resolved login name. Fails OPEN on KV trouble
// so a KV hiccup can never permanently block a legitimate reset.
async function accountRequestAllowed(env, name) {
  if (!env || !env.KV_SESSIONS) return true;
  try {
    const bucket = Math.floor(Date.now() / (PER_ACCOUNT_WINDOW_SECONDS * 1000));
    const key = `${PER_ACCOUNT_PREFIX}${name}:${bucket}`;
    const current = parseInt((await env.KV_SESSIONS.get(key)) || '0', 10) || 0;
    if (current >= PER_ACCOUNT_MAX_PER_HOUR) return false;
    await env.KV_SESSIONS.put(key, String(current + 1), { expirationTtl: PER_ACCOUNT_WINDOW_SECONDS + 5 });
    return true;
  } catch (e) { return true; }
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
  const generic = { success: true, message: GENERIC_REQUEST_MESSAGE };

  if (!name || !name.toString().trim()) return withMinDelay(startedAt, generic);
  const identifier = name.toString().trim();

  const row = await findLoginRowByIdentifier(env, identifier);

  // addition (4): unknown account OR account with no email -> same generic path.
  // Still fall through the delay so timing doesn't reveal the difference.
  if (!row || !row.email || !row.email.toString().trim()) {
    return withMinDelay(startedAt, generic);
  }

  // addition (2): per-account cap. Silently succeed (generic) when exceeded so an
  // attacker can't tell they hit the cap.
  if (!(await accountRequestAllowed(env, row.name.toString().trim()))) {
    return withMinDelay(startedAt, generic);
  }

  // addition (5): token binding — the challenge is stored under the login NAME and
  // also records the login row id; resetPassword must match both.
  const code = randomOtp(); // CSPRNG 6-digit
  const challenge = {
    userId: row.id,
    name: row.name.toString().trim(),
    role: row.role,
    attempts: 0,
    createdAt: Date.now(),
  };
  const key = RESET_PREFIX + row.name.toString().trim();
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

  // Best-effort send; generic response returned regardless (can't distinguish send
  // success/failure either).
  await sendViaResend(env, { to: row.email.toString().trim(), subject, body }).catch(() => {});

  return withMinDelay(startedAt, generic);
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
