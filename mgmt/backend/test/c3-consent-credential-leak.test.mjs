// ============ AUDIT C-3 — consent credentials handed to admin screens ============
//
// getLoanConsents / getConsentsForReview used `SELECT *`, which returned the
// consent `token` AND `otp`. Together those two values are enough to impersonate
// the consenting person:
//     verifyConsentOtp(token, otp)                       -> mints a verifyToken
//     respondConsent(token, 'accepted', ..., verifyToken) -> records the consent
// i.e. accept a loan guarantee on someone else's behalf, with a fabricated photo,
// signature and geolocation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { getLoanConsents, getConsentsForReview, verifyConsentOtp } from '../src/loans.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0002', role: 'Admin' };
const SUBADMIN = { name: 'USER0003', role: 'Subadmin' };

const SECRET_TOKEN = 'a'.repeat(64);
const SECRET_OTP = '424242';

function makeEnv() {
  const loansExpenses = makeD1(schemaFor('loans_expenses.sql'));
  const core = makeD1(schemaFor('core.sql'));

  core.prepare('INSERT INTO users (id_code, name, village, mobile) VALUES (?,?,?,?)')
    .bind('USER0009', 'Guarantor One', 'Shaharpura', 9876543210).run();

  loansExpenses.prepare('INSERT INTO loans (year, name, amount, loan_id, loan_status) VALUES (?,?,?,?,?)')
    .bind(2026, 'USER0008', 50000, 'LN1', 'Created').run();

  // An ACCEPTED consent carrying the full evidence set + the live credentials.
  loansExpenses.prepare(
    `INSERT INTO loan_consents
      (consent_id, loan_id, person_id, role, token, status, otp, otp_verified, send_count,
       created_at, responded_at, device_id, ip_address, user_agent,
       geo_lat, geo_lng, geo_accuracy, photo_url, signature_url, verification_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind('CN1', 'LN1', 'USER0009', 'guarantor', SECRET_TOKEN, 'accepted', SECRET_OTP, 1, 1,
    '2026-09-01', '2026-09-02', 'dev-1', '203.0.113.7', 'Mozilla/5.0',
    24.18, 86.30, 12, 'https://files/photo.jpg', 'https://files/sig.jpg', 'pending').run();

  // A PENDING consent with a live, unverified OTP.
  loansExpenses.prepare(
    `INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status, otp, otp_verified, send_count, created_at, responded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind('CN2', 'LN1', 'USER0010', 'guarantor', 'b'.repeat(64), 'pending', '999888', 0, 1, '2026-09-01', '').run();

  return { DB_LOANS_EXPENSES: loansExpenses, DB_CORE: core, DB_LOGS: makeD1(schemaFor('logs.sql')), KV_SESSIONS: makeKV() };
}

// ------------------------------------------------------------------ THE LEAK

test('C-3: getLoanConsents never returns a consent token or OTP, for any staff role', async () => {
  const env = makeEnv();
  for (const actor of [SUBADMIN, ADMIN, SUPERADMIN]) {
    const rows = await getLoanConsents(env, 'LN1', actor);
    assert.ok(rows.length >= 2, 'the consents must still be listed');

    const serialised = JSON.stringify(rows);
    assert.ok(!serialised.includes(SECRET_TOKEN), `${actor.role}: the consent token leaked`);
    assert.ok(!serialised.includes(SECRET_OTP), `${actor.role}: the OTP leaked`);
    assert.ok(!serialised.includes('999888'), `${actor.role}: the pending OTP leaked`);
    for (const row of rows) {
      assert.ok(!('token' in row), 'no `token` key may be present');
      assert.ok(!('otp' in row), 'no `otp` key may be present');
    }
  }
});

test('C-3: getLoanConsents also drops third-party evidence the modal never renders', async () => {
  const env = makeEnv();
  const rows = await getLoanConsents(env, 'LN1', SUBADMIN);
  const serialised = JSON.stringify(rows);
  // Data minimisation: the Loan Consents modal shows six fields, so a Subadmin has
  // no reason to receive a named person's GPS position, selfie, signature or IP.
  for (const secret of ['203.0.113.7', 'photo.jpg', 'sig.jpg', 'Mozilla/5.0', '24.18', '86.3']) {
    assert.ok(!serialised.includes(secret), `evidence leaked to the list endpoint: ${secret}`);
  }
  for (const col of ['ip_address', 'photo_url', 'signature_url', 'geo_lat', 'geo_lng', 'user_agent', 'device_id']) {
    assert.ok(!(col in rows[0]), `${col} must not be in the list projection`);
  }
});

test('C-3: getConsentsForReview never returns a token or OTP', async () => {
  const env = makeEnv();
  for (const actor of [ADMIN, SUPERADMIN]) {
    const rows = await getConsentsForReview(env, actor);
    assert.equal(rows.length, 1, 'only the accepted/declined consent is in the queue');
    const serialised = JSON.stringify(rows);
    assert.ok(!serialised.includes(SECRET_TOKEN), 'the consent token leaked');
    assert.ok(!serialised.includes(SECRET_OTP), 'the OTP leaked');
    assert.ok(!('token' in rows[0]) && !('otp' in rows[0]));
  }
});

test('C-3: a Subadmin still cannot reach the review queue at all', async () => {
  const env = makeEnv();
  await assert.rejects(() => getConsentsForReview(env, SUBADMIN), /Only an Admin or Superadmin/);
});

// ------------------------------------------------- THE FIX DID NOT BREAK THINGS

test('C-3 regression guard: the Loan Consents modal still gets every field it renders', async () => {
  const env = makeEnv();
  const rows = await getLoanConsents(env, 'LN1', SUBADMIN);
  const accepted = rows.find(r => r.consent_id === 'CN1');
  // Exactly the six fields LoanConsentModal.jsx reads, plus what drives its logic.
  assert.equal(accepted.consent_id, 'CN1');
  assert.equal(accepted.personName, 'Guarantor One', 'the joined display name must survive');
  assert.equal(accepted.personNameHindi, '');
  assert.equal(accepted.role, 'guarantor');
  assert.equal(Number(accepted.send_count), 1);
  assert.equal(accepted.status, 'accepted');
  // …and the fields the surrounding UI needs for its counters/badges.
  assert.equal(accepted.loan_id, 'LN1');
  // `otp_verified` is a TEXT column, so it reads back as the STRING '1' — which is
  // exactly why the frontend parses it with isTruthyFlag() rather than `=== 1`.
  assert.equal(String(accepted.otp_verified), '1');
  assert.equal(accepted.verification_status, 'pending');
  assert.ok(accepted.id > 0, 'the row id is still present for downstream actions');
});

test('C-3 regression guard: Consent Review still gets the full evidence set it inspects', async () => {
  const env = makeEnv();
  const [row] = await getConsentsForReview(env, ADMIN);
  // Every field ConsentReview.jsx renders (verified by grep against the view).
  for (const [col, expected] of [
    ['consent_id', 'CN1'], ['role', 'guarantor'], ['status', 'accepted'],
    ['device_id', 'dev-1'], ['ip_address', '203.0.113.7'],
    ['geo_lat', 24.18], ['geo_lng', 86.3], ['geo_accuracy', 12],
    ['photo_url', 'https://files/photo.jpg'], ['signature_url', 'https://files/sig.jpg'],
    ['verification_status', 'pending'], ['responded_at', '2026-09-02'],
  ]) {
    assert.equal(row[col], expected, `${col} must still reach the review screen`);
  }
  // …plus the joined display fields.
  assert.equal(row.personName, 'Guarantor One');
  assert.equal(row.loanAmount, 50000);
  assert.equal(row.loanYear, 2026);
});

test('C-3: the review queue is capped and newest-first', async () => {
  const env = makeEnv();
  // 600 responded consents — more than the 500 cap.
  for (let i = 0; i < 600; i++) {
    env.DB_LOANS_EXPENSES.prepare(
      `INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status, otp, created_at, responded_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(`CX${i}`, 'LN1', 'USER0009', 'guarantor', `t${i}`, 'accepted', '111111',
      '2026-01-01', `2026-01-${String((i % 28) + 1).padStart(2, '0')}`).run();
  }
  const rows = await getConsentsForReview(env, ADMIN);
  assert.equal(rows.length, 500, 'the queue must be capped at 500 rows');
  // Newest first — the cap must keep the most recent responses, not an arbitrary page.
  const dates = rows.map(r => r.responded_at);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'must be ordered newest-first');
  assert.ok(!JSON.stringify(rows).includes('111111'), 'still no OTP at scale');
});

// ------------------------------------------------------------ THE OTP IS BURNED

test('C-3: a verified OTP is cleared from the database, not just from KV', async () => {
  const env = makeEnv();
  // NOTE: `otp` is a REAL column in the committed schema (see the audit's M-33), so
  // SQLite's numeric affinity turns the stored '999888' back into the NUMBER 999888
  // on read. That is real production behaviour — it is precisely why
  // verifyConsentOtp normalises with `.toString().replace(/\.0+$/, '')`. Compare as
  // a string so the assertion is about the value, not the affinity.
  const before = await env.DB_LOANS_EXPENSES
    .prepare("SELECT otp, otp_verified FROM loan_consents WHERE consent_id = 'CN2'").first();
  assert.equal(String(before.otp), '999888', 'precondition: the code is live');
  assert.equal(String(before.otp_verified), '0');

  const res = await verifyConsentOtp(env, 'b'.repeat(64), '999888');
  assert.equal(res.success, true);
  assert.ok(res.verifyToken && res.verifyToken.length > 20, 'a session-bound verifyToken is returned');

  const after = await env.DB_LOANS_EXPENSES
    .prepare("SELECT otp, otp_verified FROM loan_consents WHERE consent_id = 'CN2'").first();
  assert.equal(String(after.otp), '', 'the OTP must be BURNED in the database');
  assert.equal(String(after.otp_verified), '1');

  // The same code cannot be replayed.
  await assert.rejects(() => verifyConsentOtp(env, 'b'.repeat(64), '999888'), /request an OTP first/);
});

test('C-3: a wrong OTP is still rejected and does not burn the code', async () => {
  const env = makeEnv();
  await assert.rejects(() => verifyConsentOtp(env, 'b'.repeat(64), '000000'), /incorrect/i);
  const row = await env.DB_LOANS_EXPENSES
    .prepare("SELECT otp, otp_verified FROM loan_consents WHERE consent_id = 'CN2'").first();
  assert.equal(String(row.otp), '999888', 'a failed attempt must not clear the code');
  assert.equal(String(row.otp_verified), '0');
});
