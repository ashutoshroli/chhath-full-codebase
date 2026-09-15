// ====== AUDIT MGMT-BE-01 — resend / replace / disburse must not half-apply ======
//
// Three multi-step loan mutations each had the same shape of bug:
//
//   resendConsent      rotated the token, reset the status and spent one of the
//                      five allowed sends BEFORE checking that a template and a
//                      usable WhatsApp number exist. On failure the caller saw an
//                      error while the person's previous link was already dead.
//   replaceGuarantor   three separate awaited writes (retire old consent, swap the
//                      guarantor row, insert the new consent). A failure in
//                      between left a loan with two active guarantors, which can
//                      never satisfy the "all three accepted + verified" gate.
//   markLoanDisbursed  read loan_status, then wrote unconditionally, so two
//                      admins could both disburse — last split wins, two
//                      confirmations sent for one payment.
//
// All three now validate first, write conditionally, and (for the swap) use one
// batch so the state cannot be observed half-changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { resendConsent, replaceGuarantor, markLoanDisbursed } from '../src/loans.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

function makeEnv({ withTemplate = true, whatsapp = 9800000001 } = {}) {
  const core = makeD1(schemaFor('core.sql'));
  const le = makeD1(schemaFor('loans_expenses.sql'));
  for (const [code, name] of [['USER0002', 'Ram'], ['USER0003', 'Shyam'], ['USER0004', 'Gita'], ['USER0005', 'Sita'], ['USER0006', 'Mohan']]) {
    core.prepare('INSERT INTO users (id_code, name, mobile, whatsapp) VALUES (?,?,?,?)')
      .bind(code, name, whatsapp, whatsapp).run();
  }
  if (withTemplate) {
    for (const type of ['consent_personal_loaner', 'consent_personal_guarantor']) {
      le.prepare('INSERT INTO loan_message_templates (template_id, type, text, active) VALUES (?,?,?,?)')
        .bind('T-' + type, type, 'Please sign: {ConsentLink}', 'TRUE').run();
    }
  }
  return {
    DB_CORE: core,
    DB_LOANS_EXPENSES: le,
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    KV_SESSIONS: makeKV(),
    CONSENT_BASE_URL: 'https://portal.test',
  };
}

// A loan with its four consents, as a save leaves it.
async function seedLoan(env, { loanId = 'LN-1', status = 'Created', amount = 3000 } = {}) {
  await env.DB_LOANS_EXPENSES
    .prepare('INSERT INTO loans (year, name, amount, intrest_rate, tenure, loan_id, loan_status) VALUES (?,?,?,?,?,?,?)')
    .bind(2026, 'USER0002', amount, 10, 11, loanId, status).run();
  for (const g of ['USER0003', 'USER0004', 'USER0005']) {
    await env.DB_LOANS_EXPENSES
      .prepare('INSERT INTO loan_guarantors (year, loaner, guarantor, loan_id) VALUES (?,?,?,?)')
      .bind(2026, 'USER0002', g, loanId).run();
  }
  for (const [person, role, cid] of [
    ['USER0002', 'loaner', 'CN-loaner'], ['USER0003', 'guarantor', 'CN-g1'],
    ['USER0004', 'guarantor', 'CN-g2'], ['USER0005', 'guarantor', 'CN-g3'],
  ]) {
    await env.DB_LOANS_EXPENSES.prepare(
      'INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status, send_count) VALUES (?,?,?,?,?,?,?)'
    ).bind(cid, loanId, person, role, 'tok-' + cid, 'sent', 1).run();
  }
  return loanId;
}

const consent = (env, cid) => env.DB_LOANS_EXPENSES
  .prepare('SELECT consent_id, status, token, send_count FROM loan_consents WHERE consent_id = ?').bind(cid).first();
const count = (db, sql, ...a) => db.prepare(sql).bind(...a).first('n');

// ================================================================ 1. RESEND

test('MGMT-BE-01: a resend with no active template does NOT burn the token or a send', async () => {
  const env = makeEnv({ withTemplate: false });
  await seedLoan(env);
  const before = await consent(env, 'CN-g1');

  await assert.rejects(() => resendConsent(env, 'CN-g1', SUPERADMIN), /no active .* template/i);

  const after = await consent(env, 'CN-g1');
  // On `main`: token rotated, status reset to pending, send_count already 2.
  assert.equal(after.token, before.token, 'the link already sent to the guarantor still works');
  assert.equal(after.send_count, before.send_count, 'no send was spent');
  assert.equal(after.status, before.status, 'the status was not reset');
});

test('MGMT-BE-01: a resend to an unusable WhatsApp number does NOT burn the token or a send', async () => {
  const env = makeEnv({ whatsapp: 123 }); // too short to be a real number
  await seedLoan(env);
  const before = await consent(env, 'CN-g1');

  await assert.rejects(() => resendConsent(env, 'CN-g1', SUPERADMIN), /valid WhatsApp\/Mobile number/i);

  const after = await consent(env, 'CN-g1');
  assert.equal(after.token, before.token);
  assert.equal(after.send_count, before.send_count);
});

test('MGMT-BE-01: a valid resend rotates the token and spends exactly one send', async () => {
  const env = makeEnv();
  await seedLoan(env);
  const before = await consent(env, 'CN-g1');

  const res = await resendConsent(env, 'CN-g1', SUPERADMIN);

  const after = await consent(env, 'CN-g1');
  assert.equal(res.success, true);
  assert.equal(res.sendCount, 2);
  assert.notEqual(after.token, before.token, 'a fresh token was issued');
  assert.equal(after.send_count, 2);
  assert.equal(after.status, 'pending');
  assert.equal(await count(env.DB_WHATSAPP_INDEX, 'SELECT COUNT(*) AS n FROM person_messages'), 1,
    'the invitation was actually queued');
});

test('MGMT-BE-01: two resends racing on one consent spend only ONE send', async () => {
  const env = makeEnv();
  await seedLoan(env);

  // A rival resend commits between our read and our UPDATE.
  const realPrepare = env.DB_LOANS_EXPENSES.prepare.bind(env.DB_LOANS_EXPENSES);
  let fired = false;
  env.DB_LOANS_EXPENSES.prepare = (sql) => {
    if (!fired && /UPDATE loan_consents SET token/.test(sql)) {
      fired = true;
      realPrepare("UPDATE loan_consents SET token = 'tok-rival', send_count = 2 WHERE consent_id = 'CN-g1'")
        .bind().run();
    }
    return realPrepare(sql);
  };

  await assert.rejects(() => resendConsent(env, 'CN-g1', SUPERADMIN), /just resent from another screen/i);

  const after = await consent(env, 'CN-g1');
  assert.equal(after.send_count, 2, 'the send budget moved once, not twice');
  assert.equal(after.token, 'tok-rival', "the winner's token survives — no dead link");
});

// ======================================================== 2. REPLACE GUARANTOR

test('MGMT-BE-01: replacing a guarantor is a single transaction', async () => {
  const env = makeEnv();
  await seedLoan(env);
  const batches = [];
  const realBatch = env.DB_LOANS_EXPENSES.batch.bind(env.DB_LOANS_EXPENSES);
  env.DB_LOANS_EXPENSES.batch = (stmts) => { batches.push(stmts.length); return realBatch(stmts); };

  const res = await replaceGuarantor(env, 'LN-1', 'CN-g1', 'USER0006', SUPERADMIN);

  assert.equal(res.success, true);
  assert.deepEqual(batches, [3], 'retire + insert + guarantor swap in one batch');
  assert.equal((await consent(env, 'CN-g1')).status, 'replaced');
  assert.equal(await count(env.DB_LOANS_EXPENSES,
    "SELECT COUNT(*) AS n FROM loan_consents WHERE loan_id = ? AND status != 'replaced'", 'LN-1'), 4,
    'still exactly four active consents (loaner + 3 guarantors)');
  assert.equal(await count(env.DB_LOANS_EXPENSES,
    'SELECT COUNT(*) AS n FROM loan_guarantors WHERE loan_id = ? AND guarantor = ?', 'LN-1', 'USER0006'), 1,
    'the guarantor row now names the replacement');
  assert.equal(await count(env.DB_LOANS_EXPENSES,
    'SELECT COUNT(*) AS n FROM loan_guarantors WHERE loan_id = ? AND guarantor = ?', 'LN-1', 'USER0003'), 0);
});

test('MGMT-BE-01: if any part of the swap fails, NOTHING changes', async () => {
  const env = makeEnv();
  await seedLoan(env);

  // Break the guarantor swap — the last statement of the batch.
  const realPrepare = env.DB_LOANS_EXPENSES.prepare.bind(env.DB_LOANS_EXPENSES);
  env.DB_LOANS_EXPENSES.prepare = (sql) => {
    if (/UPDATE loan_guarantors SET guarantor/.test(sql)) {
      return { bind: () => ({ async run() { throw new Error('D1_ERROR: network error'); } }) };
    }
    return realPrepare(sql);
  };

  await assert.rejects(() => replaceGuarantor(env, 'LN-1', 'CN-g1', 'USER0006', SUPERADMIN),
    /D1_ERROR: network error/);

  // On `main` the old consent is already 'replaced' here and a new consent exists.
  assert.equal((await consent(env, 'CN-g1')).status, 'sent', 'the old consent is untouched');
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents WHERE loan_id = ?', 'LN-1'), 4,
    'no new consent row was left behind');
  assert.equal(await count(env.DB_LOANS_EXPENSES,
    'SELECT COUNT(*) AS n FROM loan_guarantors WHERE loan_id = ? AND guarantor = ?', 'LN-1', 'USER0003'), 1,
    'the original guarantor is still on the loan');
});

test('MGMT-BE-01: the same guarantor cannot be replaced twice concurrently', async () => {
  const env = makeEnv();
  await seedLoan(env);

  // A rival replacement retires CN-g1 just before our batch runs.
  const realBatch = env.DB_LOANS_EXPENSES.batch.bind(env.DB_LOANS_EXPENSES);
  let fired = false;
  env.DB_LOANS_EXPENSES.batch = async (stmts) => {
    if (!fired) {
      fired = true;
      await env.DB_LOANS_EXPENSES
        .prepare("UPDATE loan_consents SET status = 'replaced' WHERE consent_id = 'CN-g1'").bind().run();
      await env.DB_LOANS_EXPENSES.prepare(
        'INSERT INTO loan_consents (consent_id, loan_id, person_id, role, token, status, send_count) VALUES (?,?,?,?,?,?,?)'
      ).bind('CN-rival', 'LN-1', 'USER0006', 'guarantor', 'tok-rival', 'pending', 1).run();
    }
    return realBatch(stmts);
  };

  await assert.rejects(() => replaceGuarantor(env, 'LN-1', 'CN-g1', 'USER0006', SUPERADMIN),
    /just replaced \(or has accepted\)/i);

  assert.equal(await count(env.DB_LOANS_EXPENSES,
    "SELECT COUNT(*) AS n FROM loan_consents WHERE loan_id = ? AND status != 'replaced'", 'LN-1'), 4,
    'the loan never ends up with five active consents');
});

// ============================================================== 3. DISBURSE

test('MGMT-BE-01: a loan cannot be disbursed twice concurrently', async () => {
  const env = makeEnv();
  await seedLoan(env, { status: 'Approved', amount: 3000 });

  // A rival disbursement commits between our status read and our UPDATE.
  const realPrepare = env.DB_LOANS_EXPENSES.prepare.bind(env.DB_LOANS_EXPENSES);
  let fired = false;
  env.DB_LOANS_EXPENSES.prepare = (sql) => {
    if (!fired && /UPDATE loans SET loan_status = 'Disbursed'/.test(sql)) {
      fired = true;
      realPrepare("UPDATE loans SET loan_status = 'Disbursed', cash_amount = 3000, online_amount = 0 WHERE loan_id = 'LN-1'")
        .bind().run();
    }
    return realPrepare(sql);
  };

  await assert.rejects(
    () => markLoanDisbursed(env, 'LN-1', 0, 3000, SUPERADMIN),
    /just disbursed from another screen/i
  );

  const row = await env.DB_LOANS_EXPENSES
    .prepare('SELECT cash_amount, online_amount FROM loans WHERE loan_id = ?').bind('LN-1').first();
  // On `main` the second writer overwrote this with cash 0 / online 3000 and sent
  // a second confirmation.
  assert.equal(row.cash_amount, 3000, "the first disbursement's split is preserved");
  assert.equal(row.online_amount, 0);
});

test('MGMT-BE-01: an already-Disbursed loan is refused before any write', async () => {
  const env = makeEnv();
  await seedLoan(env, { status: 'Disbursed', amount: 3000 });

  await assert.rejects(() => markLoanDisbursed(env, 'LN-1', 3000, 0, SUPERADMIN), /not Approved yet/i);
});

test('MGMT-BE-01: the normal disbursement still records the split and notifies', async () => {
  const env = makeEnv();
  await seedLoan(env, { status: 'Approved', amount: 3000 });
  env.DB_LOANS_EXPENSES.prepare('INSERT INTO loan_message_templates (template_id, type, text, active) VALUES (?,?,?,?)')
    .bind('T-disb', 'disbursement', 'Disbursed {TotalAmount}', 'TRUE').run();

  const res = await markLoanDisbursed(env, 'LN-1', 1000, 2000, SUPERADMIN);

  assert.equal(res.success, true);
  assert.equal(res.messageWarning, undefined, 'nothing to warn about — the message was queued');
  const row = await env.DB_LOANS_EXPENSES
    .prepare('SELECT loan_status, cash_amount, online_amount FROM loans WHERE loan_id = ?').bind('LN-1').first();
  assert.equal(row.loan_status, 'Disbursed');
  assert.equal(row.cash_amount, 1000);
  assert.equal(row.online_amount, 2000);
});
