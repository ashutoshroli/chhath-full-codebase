// ===== "MARK AS REPAID" TELLS THE GUARANTORS OF AN OLD LOAN TOO =====
//
// Marking a loan Repaid (or undoing it) messages the loaner, the WhatsApp groups and every
// GUARANTOR — by WhatsApp and by e-mail. The guarantors were found in `loan_consents`, which
// is where a loan taken through the portal keeps them.
//
// The loans entered from the old ledgers (LNOLD2018 … LNOLD2025) never went through that flow.
// They have their guarantors only in `loan_guarantors`, and no consent rows at all. So for every
// one of them:
//
//   * nobody who had stood guarantor was ever told the loan was repaid, and
//   * {Guarantor1} … {Guarantor3} came out BLANK in the group and loaner messages,
//
// and nothing said so: a loan with no guarantors to tell looked exactly like a loan whose
// guarantors had been told.
//
// The fix reads the guarantor list of the loan when there are no consents, and reports a loan
// that has no guarantors anywhere. These tests run the real markLoanRepaid / undoLoanRepaid
// against an in-memory copy of the real schema and read back what was queued.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { markLoanRepaid, undoLoanRepaid } from '../src/loans.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

// ------------------------------------------------------------------------ fixtures

const PEOPLE = {
  USER0100: { name: 'Loaner One', hindi: 'ऋणी एक', mobile: '9000000100', email: 'loaner@example.test' },
  USER0201: { name: 'Guarantor A', hindi: 'गारंटर अ', mobile: '9000000201', email: 'a@example.test' },
  USER0202: { name: 'Guarantor B', hindi: 'गारंटर ब', mobile: '9000000202', email: 'b@example.test' },
  USER0203: { name: 'Guarantor C', hindi: 'गारंटर स', mobile: '9000000203', email: 'c@example.test' },
  USER0204: { name: 'Guarantor D', hindi: 'गारंटर द', mobile: '9000000204', email: 'd@example.test' },
};
const wa = (id) => `91${PEOPLE[id].mobile}`;

function baseEnv() {
  return {
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    KV_SESSIONS: makeKV(),
  };
}

function seedUsers(env) {
  const ins = env.DB_CORE.prepare('INSERT INTO users (id_code, name, name_hindi, village, mobile, whatsapp, email) VALUES (?,?,?,?,?,?,?)');
  for (const [id, p] of Object.entries(PEOPLE)) ins.bind(id, p.name, p.hindi, 'Shaharpura', p.mobile, p.mobile, p.email).run();
}

// One active template of each kind. The group text shows the three guarantor names in order, so a
// blank {Guarantor1..3} is visible in the assertion rather than only in a real message.
function seedTemplates(env) {
  const wa = env.DB_LOANS_EXPENSES.prepare(
    "INSERT INTO loan_message_templates (template_id, type, text, active, created_at, message_type, file_link) VALUES (?,?,?,'1',datetime('now'),'normal','')");
  const mail = env.DB_LOANS_EXPENSES.prepare(
    "INSERT INTO loan_email_templates (template_id, type, subject, text, active, created_at, message_type, file_link) VALUES (?,?,?,?,'1',datetime('now'),'normal','')");
  for (const kind of ['repaid', 'repaid_undo']) {
    wa.bind(`T_${kind}_G`, `${kind}_group`, `GROUP ${kind} {Year} {LoanerName} [{Guarantor1}|{Guarantor2}|{Guarantor3}]`).run();
    wa.bind(`T_${kind}_L`, `${kind}_loaner_personal`, `LOANER ${kind} {Name} [{Guarantor1}|{Guarantor2}|{Guarantor3}]`).run();
    wa.bind(`T_${kind}_P`, `${kind}_guarantor_personal`, `GUARANTOR ${kind} {Name} for {LoanerName}`).run();
    mail.bind(`E_${kind}_L`, `${kind}_loaner_personal`, `S loaner ${kind}`, `LOANER ${kind} {Name}`).run();
    mail.bind(`E_${kind}_P`, `${kind}_guarantor_personal`, `S guarantor ${kind}`, `GUARANTOR ${kind} {Name}`).run();
  }
}

function seedGroup(env) {
  env.DB_WHATSAPP_INDEX.prepare("INSERT INTO whatsapp_groups (group_id, group_name, groupid, active, created_at) VALUES ('G1','Committee','120363@g.us','1',datetime('now'))").run();
}

// An old loan: Disbursed, never repaid, ₹10,000 at 2% a month for 10 months = ₹12,000 due.
function seedLoan(env, { loanId = 'LNOLD2024', year = 2024, loaner = 'USER0100' } = {}) {
  env.DB_LOANS_EXPENSES.prepare(
    "INSERT INTO loans (year, name, amount, intrest_rate, tenure, loan_id, status, loan_status) VALUES (?,?,?,?,?,?,'Active','Disbursed')")
    .bind(year, loaner, 10000, 2, 10, loanId).run();
}
function ledgerGuarantors(env, ids, { loanId = 'LNOLD2024', year = 2024, loaner = 'USER0100' } = {}) {
  const ins = env.DB_LOANS_EXPENSES.prepare('INSERT INTO loan_guarantors (year, loaner, guarantor, loan_id) VALUES (?,?,?,?)');
  for (const g of ids) ins.bind(year, loaner, g, loanId).run();
}
function consent(env, personId, role, status, loanId = 'LNOLD2024') {
  env.DB_LOANS_EXPENSES.prepare(
    "INSERT INTO loan_consents (consent_id, loan_id, person_id, role, status, created_at) VALUES (?,?,?,?,?,datetime('now'))")
    .bind(`C_${personId}_${status}`, loanId, personId, role, status).run();
}

let env;
beforeEach(() => {
  env = baseEnv();
  seedUsers(env);
  seedTemplates(env);
  seedGroup(env);
});

const repay = (id = 'LNOLD2024') => markLoanRepaid(env, id, 5000, 7000, '2026-10-01', SUPERADMIN);

async function personMessages() {
  const { results } = await env.DB_WHATSAPP_INDEX.prepare('SELECT mobileno, message FROM person_messages ORDER BY id').all();
  return results.map((r) => ({ to: String(r.mobileno), text: r.message }));
}
async function groupMessages() {
  const { results } = await env.DB_WHATSAPP_INDEX.prepare('SELECT message FROM group_messages ORDER BY id').all();
  return results.map((r) => r.message);
}
async function emails() {
  const { results } = await env.DB_WHATSAPP_INDEX.prepare('SELECT to_email, subject, body FROM email_messages ORDER BY id').all();
  return results;
}
const toGuarantors = (msgs, kind = 'repaid') => msgs.filter((m) => m.text.startsWith(`GUARANTOR ${kind} `));

// ------------------------------------------------------------ an old loan: no consents

describe('a loan from the old ledgers (guarantors only in loan_guarantors)', () => {
  beforeEach(() => {
    seedLoan(env);
    ledgerGuarantors(env, ['USER0201', 'USER0202', 'USER0203']);
  });

  test('each guarantor is told by WhatsApp, with their own name and the loaner’s', async () => {
    const res = await repay();
    assert.equal(res.success, true);
    assert.equal(res.messageWarning, undefined, `nothing should be missing: ${res.messageWarning}`);

    const msgs = await personMessages();
    const g = toGuarantors(msgs);
    assert.deepEqual(g.map((m) => m.to), [wa('USER0201'), wa('USER0202'), wa('USER0203')]);
    assert.equal(g[0].text, 'GUARANTOR repaid Guarantor A for Loaner One');
    assert.equal(g[2].text, 'GUARANTOR repaid Guarantor C for Loaner One');
  });

  test('each guarantor is told by e-mail too', async () => {
    await repay();
    const mails = (await emails()).filter((m) => m.subject === 'S guarantor repaid');
    assert.deepEqual(mails.map((m) => m.to_email), ['a@example.test', 'b@example.test', 'c@example.test']);
    assert.equal(mails[1].body, 'GUARANTOR repaid Guarantor B');
  });

  test('{Guarantor1}..{Guarantor3} are filled in the group and loaner messages instead of blank', async () => {
    await repay();
    const [group] = await groupMessages();
    assert.equal(group, 'GROUP repaid 2024 Loaner One [Guarantor A|Guarantor B|Guarantor C]');
    const loaner = (await personMessages()).find((m) => m.to === wa('USER0100'));
    assert.equal(loaner.text, 'LOANER repaid Loaner One [Guarantor A|Guarantor B|Guarantor C]');
  });

  test('the loaner is still told exactly once', async () => {
    await repay();
    assert.equal((await personMessages()).filter((m) => m.to === wa('USER0100')).length, 1);
  });

  test('undoing the repayment tells the same guarantors', async () => {
    await repay();
    const res = await undoLoanRepaid(env, 'LNOLD2024', SUPERADMIN);
    assert.equal(res.success, true);
    const g = toGuarantors(await personMessages(), 'repaid_undo');
    assert.deepEqual(g.map((m) => m.to), [wa('USER0201'), wa('USER0202'), wa('USER0203')]);
    const [, undoGroup] = await groupMessages();
    assert.equal(undoGroup, 'GROUP repaid_undo 2024 Loaner One [Guarantor A|Guarantor B|Guarantor C]');
  });

  test('another loan’s guarantors are not mixed in', async () => {
    seedLoan(env, { loanId: 'LNOLD2023', year: 2023, loaner: 'USER0100' });
    ledgerGuarantors(env, ['USER0204'], { loanId: 'LNOLD2023', year: 2023 });
    await repay('LNOLD2024');
    assert.ok(!(await personMessages()).some((m) => m.to === wa('USER0204')), 'USER0204 guaranteed a different loan');
  });
});

// -------------------------------------------------------------- the list is cleaned up

describe('the guarantor list from the ledger is cleaned before anyone is messaged', () => {
  beforeEach(() => seedLoan(env));

  test('a person listed twice is told once', async () => {
    ledgerGuarantors(env, ['USER0201', 'USER0201', 'USER0202']);
    await repay();
    assert.deepEqual(toGuarantors(await personMessages()).map((m) => m.to), [wa('USER0201'), wa('USER0202')]);
  });

  test('the borrower is never told they are a "guarantor" of their own loan', async () => {
    ledgerGuarantors(env, ['USER0201', 'USER0100']);
    await repay();
    const msgs = await personMessages();
    assert.deepEqual(toGuarantors(msgs).map((m) => m.to), [wa('USER0201')]);
    assert.equal(msgs.filter((m) => m.to === wa('USER0100')).length, 1, 'only the loaner message');
  });

  test('blank rows are skipped', async () => {
    ledgerGuarantors(env, ['', '   ', 'USER0202']);
    await repay();
    assert.deepEqual(toGuarantors(await personMessages()).map((m) => m.to), [wa('USER0202')]);
  });
});

// ------------------------------------------------------ a loan that does have consents

describe('a loan taken through the portal keeps using its consents', () => {
  test('the consents decide, not the ledger — a replaced guarantor is not told', async () => {
    seedLoan(env);
    // The ledger still lists A, B, C; but B was replaced by D in the consent flow.
    ledgerGuarantors(env, ['USER0201', 'USER0202', 'USER0203']);
    consent(env, 'USER0100', 'loaner', 'accepted');
    consent(env, 'USER0201', 'guarantor', 'accepted');
    consent(env, 'USER0202', 'guarantor', 'replaced');
    consent(env, 'USER0204', 'guarantor', 'accepted');
    await repay();
    const to = toGuarantors(await personMessages()).map((m) => m.to);
    assert.deepEqual(to, [wa('USER0201'), wa('USER0204')]);
    assert.ok(!to.includes(wa('USER0202')) && !to.includes(wa('USER0203')));
  });
});

// ------------------------------------------------------- nobody to tell is said out loud

describe('a loan with no guarantors anywhere', () => {
  test('is reported in the result instead of passing silently', async () => {
    seedLoan(env);
    const res = await repay();
    assert.equal(res.success, true, 'the repayment itself is recorded either way');
    assert.match(res.messageWarning, /no guarantors are recorded for this loan/);
    // The loaner and the group are still told.
    assert.equal((await personMessages()).length, 1);
    assert.equal((await groupMessages()).length, 1);
  });

  test('and the warning also reaches the log', async () => {
    seedLoan(env);
    await repay();
    const { results } = await env.DB_LOGS.prepare('SELECT * FROM error_log').all();
    assert.ok(JSON.stringify(results).includes('no guarantors are recorded for this loan'));
  });

  test('a loan that has guarantors does not carry the warning', async () => {
    seedLoan(env);
    ledgerGuarantors(env, ['USER0201']);
    const res = await repay();
    assert.equal(res.messageWarning, undefined);
  });
});

// --------------------------------------------------------------------- the wiring

describe('the change is as narrow as intended', () => {
  const src = readFileSync(new URL('../src/loans.js', import.meta.url), 'utf8');
  const fn = (name) => {
    const start = src.indexOf(`async function ${name}`);
    return src.slice(start, src.indexOf('\n}\n', start));
  };

  test('only the repayment notices use the ledger fallback', () => {
    assert.match(fn('notifyRepayment'), /repaymentGuarantorIds\(env, loanRow\)/);
    for (const other of ['notifyConsentAccepted', 'notifyConsentClosed', 'notifyConsentVerified']) {
      assert.ok(!fn(other).includes('repaymentGuarantorIds'), `${other} is a consent flow and keeps reading consents`);
    }
    assert.ok(!src.slice(src.indexOf('export async function markLoanDisbursed'), src.indexOf('const YMD')).includes('repaymentGuarantorIds'));
  });

  test('the consent reader itself is unchanged', () => {
    const body = fn('guarantorPersonIds');
    assert.match(body, /FROM loan_consents WHERE loan_id = \? AND role = 'guarantor' AND status != 'replaced'/);
    assert.ok(!body.includes('loan_guarantors'));
  });

  test('the fallback reads the loan’s own rows, by loan_id', () => {
    assert.match(fn('repaymentGuarantorIds'), /FROM loan_guarantors WHERE loan_id = \?/);
  });
});
