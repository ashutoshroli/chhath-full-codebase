// ============ Forgot / Reset Password — flow + security additions ============
//
// Exercises passwordReset.js against the real login primitives (auth.js hashing +
// session revocation) with SQLite/Map stubs. requestPasswordReset now returns
// DISTINCT outcomes (team decision — not anti-enumeration):
//   found + email        -> { success:true, sent:true, maskedEmail }
//   found + no email     -> { success:false, code:'NO_EMAIL' }
//   not found            -> { success:false, code:'NOT_FOUND' }
//   per-account cap hit   -> { success:false, code:'RATE_LIMITED', retryAfterSeconds }
// Covered here plus the retained additions:
//   (1) timing padding (>= ~140ms floor on every response, 150–350ms target)
//   (2) per-account 3/hour request cap (4th -> RATE_LIMITED + retryAfterSeconds)
//   (3) notification email on a successful change (time + IP)
//   (5) token binding — a code minted for one user cannot reset another
//   (6) password strength by role (Superadmin 12+ upper/lower/digit; others 8+)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { login, hashPassword, verifyPassword } from '../src/auth.js';
import { requestPasswordReset, resetPassword, validatePasswordForRole } from '../src/passwordReset.js';

const PW = 'OldPassw0rd!';
const IP = '203.0.113.44';

async function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  // USER0001: Superadmin WITH email. USER0002: Admin WITH email. USER0003: no email.
  const rows = [
    ['USER0001', 'Superadmin', 9876543210, 'super@b.test'],
    ['USER0002', 'Admin', 9876543211, 'admin@b.test'],
    ['USER0003', 'Subadmin', 9876543212, ''],
  ];
  for (const [name, role, mobile, email] of rows) {
    core.prepare('INSERT INTO login_users (name, mobile, email, password, role, updated_at) VALUES (?,?,?,?,?,?)')
      .bind(name, mobile, email, await hashPassword(PW), role, '2026-01-01').run();
  }
  return {
    DB_CORE: core,
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_SESSIONS: makeKV(),
    PASSWORD_SALT: 'test-salt',
    RESEND_API_KEY: 'test-key',
    RESEND_FROM: 'Chhath <noreply@b.test>',
  };
}

// Capture outbound Resend emails by stubbing globalThis.fetch (sendViaResend POSTs
// to api.resend.com). Returns a restore fn + the captured list.
function captureEmails() {
  const sent = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    try {
      const body = JSON.parse(opts.body);
      sent.push(body);
    } catch (e) { /* ignore */ }
    return { ok: true, status: 200, json: async () => ({ id: 'stub' }) };
  };
  return { sent, restore: () => { globalThis.fetch = orig; } };
}

// Reads the 6-digit code straight out of KV (what the email would carry).
function codeFor(env, name) {
  const key = `pwreset:code:${name}`;
  const raw = env.KV_SESSIONS._store.get(key);
  if (!raw) return null;
  return JSON.parse(raw.value).code;
}

test('happy path: request a code, reset the password, sessions revoked, can log in with new password', async () => {
  const env = await makeEnv();
  const { sent, restore } = captureEmails();
  try {
    // Log in first so there IS a live session to revoke.
    const before = await login(env, 'USER0002', PW, true, IP, 'device');
    assert.equal(before.success, true);

    const req = await requestPasswordReset(env, 'USER0002', IP);
    assert.equal(req.success, true);
    assert.equal(req.sent, true, 'response says a code was sent');
    assert.match(req.maskedEmail || '', /•/, 'masked email is returned (partially hidden)');
    assert.ok(!/admin@b\.test/.test(req.maskedEmail || ''), 'the full email is NOT revealed');
    const code = codeFor(env, 'USER0002');
    assert.match(code, /^\d{6}$/, 'a 6-digit code was minted');
    assert.equal(sent.length, 1, 'a reset-code email was sent');

    const NEW = 'BrandNewPass9';
    const res = await resetPassword(env, 'USER0002', code, NEW, IP);
    assert.equal(res.success, true);

    // Old password no longer works; new one does.
    const row = await env.DB_CORE.prepare('SELECT password FROM login_users WHERE name = ?').bind('USER0002').first();
    assert.equal((await verifyPassword(env, PW, row.password)).ok, false, 'old password rejected');
    assert.equal((await verifyPassword(env, NEW, row.password)).ok, true, 'new password works');

    // The code is single-use — the KV entry is gone.
    assert.equal(codeFor(env, 'USER0002'), null, 'reset code consumed');

    // Addition (3): a notification email was sent (2 emails total: code + notice).
    assert.equal(sent.length, 2, 'a change-notification email followed');
    const notice = sent[1];
    assert.match(JSON.stringify(notice), /changed/i);
    assert.match(JSON.stringify(notice), new RegExp(IP.replace(/\./g, '\\.')), 'notification includes the IP');
  } finally { restore(); }
});

test('addition (5) token binding: a code minted for one user cannot reset another', async () => {
  const env = await makeEnv();
  const { restore } = captureEmails();
  try {
    await requestPasswordReset(env, 'USER0001', IP);   // Superadmin code
    const superCode = codeFor(env, 'USER0001');

    // Try to use USER0001's code to reset USER0002 — the challenge is keyed by name,
    // so this looks up USER0002's (absent) challenge and fails generically.
    const cross = await resetPassword(env, 'USER0002', superCode, 'WhateverPass1', IP);
    assert.equal(cross.success, false);

    // USER0001's code is still valid for USER0001 (with a strong Superadmin pw).
    const ok = await resetPassword(env, 'USER0001', superCode, 'StrongPass123', IP);
    assert.equal(ok.success, true);
  } finally { restore(); }
});

test('unknown identifier -> NOT_FOUND, no code, no email', async () => {
  const env = await makeEnv();
  const { sent, restore } = captureEmails();
  try {
    const res = await requestPasswordReset(env, 'NOBODY9999', IP);
    assert.equal(res.success, false);
    assert.equal(res.code, 'NOT_FOUND');
    assert.match(res.message, /no account found/i);
    assert.equal(sent.length, 0, 'no email sent for an unknown account');
  } finally { restore(); }
});

test('found account WITHOUT email -> NO_EMAIL, no code, no email', async () => {
  const env = await makeEnv();
  const { sent, restore } = captureEmails();
  try {
    const res = await requestPasswordReset(env, 'USER0003', IP); // no email on file
    assert.equal(res.success, false);
    assert.equal(res.code, 'NO_EMAIL');
    assert.match(res.message, /committee admin/i);
    assert.equal(codeFor(env, 'USER0003'), null, 'no reset code stored');
    assert.equal(sent.length, 0, 'no email sent');
  } finally { restore(); }
});

test('found account WITH email -> code sent + masked email', async () => {
  const env = await makeEnv();
  const { sent, restore } = captureEmails();
  try {
    const res = await requestPasswordReset(env, 'super@b.test', IP); // by email
    assert.equal(res.success, true);
    assert.equal(res.sent, true);
    assert.match(res.maskedEmail, /•/, 'email is masked');
    assert.ok(!res.maskedEmail.includes('super@b.test'), 'full email not revealed');
    assert.equal(sent.length, 1, 'a reset-code email was sent');
    assert.match(codeFor(env, 'USER0001'), /^\d{6}$/, 'a code was minted for the resolved account');
  } finally { restore(); }
});

test('addition (2) per-account cap: 4th request within the hour -> RATE_LIMITED + retryAfterSeconds', async () => {
  const env = await makeEnv();
  const { restore } = captureEmails();
  try {
    for (let i = 0; i < 3; i++) {
      const r = await requestPasswordReset(env, 'USER0002', IP);
      assert.equal(r.success, true, `request ${i + 1} allowed`);
      assert.equal(r.sent, true);
      assert.ok(codeFor(env, 'USER0002'), `request ${i + 1} minted a code`);
    }
    const before = codeFor(env, 'USER0002');
    // 4th request within the hour -> RATE_LIMITED, no new code minted.
    const fourth = await requestPasswordReset(env, 'USER0002', IP);
    assert.equal(fourth.success, false);
    assert.equal(fourth.code, 'RATE_LIMITED');
    assert.ok(Number(fourth.retryAfterSeconds) > 0, 'retryAfterSeconds provided for a countdown');
    assert.ok(fourth.retryAfterSeconds <= 3600, 'retryAfterSeconds within the 1-hour window');
    assert.match(fourth.message, /try again in/i);
    assert.equal(codeFor(env, 'USER0002'), before, 'no new code minted past the 3/hour cap');
  } finally { restore(); }
});

test('addition (6) password strength by role', () => {
  // Superadmin: 12+ with upper + lower + digit.
  assert.match(validatePasswordForRole('Superadmin', 'short1A'), /12 characters/);
  assert.match(validatePasswordForRole('Superadmin', 'alllowercase123'), /uppercase/);
  assert.match(validatePasswordForRole('Superadmin', 'ALLUPPERCASE123'), /lowercase/);
  assert.match(validatePasswordForRole('Superadmin', 'NoDigitsHereAA'), /number/);
  assert.equal(validatePasswordForRole('Superadmin', 'StrongPass123'), null, 'valid Superadmin pw accepted');
  // Others: 8+ only.
  assert.match(validatePasswordForRole('Admin', 'short'), /8 characters/);
  assert.equal(validatePasswordForRole('Admin', 'eightchr'), null, '8-char non-super pw accepted');
  assert.equal(validatePasswordForRole('Subadmin', 'password'), null);
});

test('addition (6) enforced in resetPassword: a weak Superadmin password is rejected but the code survives for retry', async () => {
  const env = await makeEnv();
  const { restore } = captureEmails();
  try {
    await requestPasswordReset(env, 'USER0001', IP);
    const code = codeFor(env, 'USER0001');

    // Weak (no uppercase, < 12) -> rejected with a specific message, code NOT burned.
    const weak = await resetPassword(env, 'USER0001', code, 'weakpass', IP);
    assert.equal(weak.success, false);
    assert.match(weak.message, /12 characters|uppercase|lowercase|number/);
    assert.equal(codeFor(env, 'USER0001'), code, 'code preserved for a retry after a strength failure');

    // Strong retry with the SAME code succeeds.
    const strong = await resetPassword(env, 'USER0001', code, 'StrongPass123', IP);
    assert.equal(strong.success, true);
  } finally { restore(); }
});

test('wrong code is rejected; the attempt cap (5) then burns the code', async () => {
  const env = await makeEnv();
  const { restore } = captureEmails();
  try {
    await requestPasswordReset(env, 'USER0002', IP);
    const good = codeFor(env, 'USER0002');
    const bad = good === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      const r = await resetPassword(env, 'USER0002', bad, 'BrandNewPass9', IP);
      assert.equal(r.success, false);
    }
    // Code is now burned — even the correct code no longer works.
    const after = await resetPassword(env, 'USER0002', good, 'BrandNewPass9', IP);
    assert.equal(after.success, false, 'code burned after 5 wrong attempts');
  } finally { restore(); }
});

test('addition (1) timing: every response is padded to a ~150ms+ floor (found + not-found alike)', async () => {
  const env = await makeEnv();
  const { restore } = captureEmails();
  try {
    // Found account (with email).
    let t = Date.now();
    await requestPasswordReset(env, 'USER0001', IP);
    const foundMs = Date.now() - t;
    // Unknown account (NOT_FOUND) — must be padded the same way.
    t = Date.now();
    await requestPasswordReset(env, 'NOBODY9999', IP);
    const notFoundMs = Date.now() - t;

    assert.ok(foundMs >= 140, `found path padded (${foundMs}ms)`);
    assert.ok(notFoundMs >= 140, `not-found path padded (${notFoundMs}ms)`);
  } finally { restore(); }
});
