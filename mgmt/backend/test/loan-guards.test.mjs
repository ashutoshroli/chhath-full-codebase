// ============ Loan guards ============
// 1) markLoanDisbursed: Admin (not only Superadmin) may disburse; the total
//    (cash + online) MUST equal the sanctioned loan amount exactly.
// 2) saveLoanTransaction: a new loan cannot exceed the year's available fund
//    (surplus − loans already given that year).
// 3) availableLoanFund: the surplus/available formula.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { saveLoanTransaction, markLoanDisbursed, availableLoanFund } from '../src/loans.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0010', role: 'Admin' };
const SUBADMIN = { name: 'USER0011', role: 'Subadmin' };

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const le = makeD1(schemaFor('loans_expenses.sql'));
  const collections = makeD1(schemaFor('collections.sql'));
  for (const [code, name] of [['USER0002', 'Ram'], ['USER0003', 'Shyam'], ['USER0004', 'Gita'], ['USER0005', 'Sita']]) {
    core.prepare('INSERT INTO users (id_code, name, mobile, whatsapp) VALUES (?,?,?,?)')
      .bind(code, name, 9800000001, 9800000001).run();
  }
  return {
    DB_CORE: core,
    DB_LOANS_EXPENSES: le,
    DB_COLLECTIONS: collections,
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    KV_SESSIONS: makeKV(),
    CONSENT_BASE_URL: 'https://portal.test',
  };
}

const seedCollections = (env, year, amount) =>
  env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, name, amount) VALUES (?,?,?)').bind(year, 'USER0002', amount).run();

const guarantors = () => [{ Guarantor: 'USER0003' }, { Guarantor: 'USER0004' }, { Guarantor: 'USER0005' }];
const loan = (over = {}) => ({ Year: 2026, Name: 'USER0002', Amount: 3000, 'Intrest Rate': 10, Tenure: 11, ...over });

// Seed an Approved loan (all consents accepted) ready to disburse.
async function seedApprovedLoan(env, { loanId = 'LN-1', amount = 3000 } = {}) {
  await env.DB_LOANS_EXPENSES.prepare('INSERT INTO loans (year, name, amount, loan_id, loan_status) VALUES (?,?,?,?,?)')
    .bind(2026, 'USER0002', amount, loanId, 'Approved').run();
  return loanId;
}

// --------------------------------------------------------- availableLoanFund

test('availableLoanFund = yearly surplus − loans already given this year', async () => {
  const env = makeEnv();
  seedCollections(env, 2026, 5000); // surplus this year = 5000 (no expenses, no prev-year returns)
  assert.equal(await availableLoanFund(env, 2026), 5000, 'nothing lent yet → full surplus');

  // A 3000 loan already recorded this year leaves 2000.
  await env.DB_LOANS_EXPENSES.prepare('INSERT INTO loans (year, name, amount, loan_id) VALUES (?,?,?,?)')
    .bind(2026, 'USER0002', 3000, 'LN-x').run();
  assert.equal(await availableLoanFund(env, 2026), 2000, 'surplus 5000 − loan 3000 = 2000');
});

// --------------------------------------------------------- budget cap on save

test('saveLoanTransaction: the FIRST loan of the year is capped at the surplus', async () => {
  const env = makeEnv();
  seedCollections(env, 2026, 5000);
  // 5000 exactly is allowed.
  const ok = await saveLoanTransaction(env, loan({ Amount: 5000 }), guarantors(), SUPERADMIN);
  assert.equal(ok.success, true);
});

test('saveLoanTransaction: a loan larger than the surplus is rejected', async () => {
  const env = makeEnv();
  seedCollections(env, 2026, 5000);
  const err = await saveLoanTransaction(env, loan({ Amount: 6000 }), guarantors(), SUPERADMIN).then(() => null, e => e);
  assert.ok(err, 'must reject');
  assert.match(err.message, /available for lending/i);
  assert.equal(await env.DB_LOANS_EXPENSES.prepare('SELECT COUNT(*) AS n FROM loans').first('n'), 0, 'nothing saved');
});

test('saveLoanTransaction: the SECOND loan is capped at what the first left (5000 → 3000 → max 2000)', async () => {
  const env = makeEnv();
  seedCollections(env, 2026, 5000);
  await saveLoanTransaction(env, loan({ Amount: 3000 }), guarantors(), SUPERADMIN); // leaves 2000

  // 2500 now exceeds the remaining 2000 → rejected.
  const tooBig = await saveLoanTransaction(env, loan({ Amount: 2500 }), guarantors(), SUPERADMIN).then(() => null, e => e);
  assert.ok(tooBig, 'the second loan over the remainder is refused');
  assert.match(tooBig.message, /available for lending/i);

  // 2000 exactly fits.
  const fits = await saveLoanTransaction(env, loan({ Amount: 2000 }), guarantors(), SUPERADMIN);
  assert.equal(fits.success, true);
});

// --------------------------------------------------------- disburse: role + amount

test('markLoanDisbursed: an Admin (not only Superadmin) may disburse', async () => {
  const env = makeEnv();
  await seedApprovedLoan(env, { loanId: 'LN-adm', amount: 3000 });
  const res = await markLoanDisbursed(env, 'LN-adm', 1000, 2000, ADMIN); // 1000+2000 = 3000
  assert.equal(res.success, true);
  const row = await env.DB_LOANS_EXPENSES.prepare('SELECT loan_status, cash_amount, online_amount FROM loans WHERE loan_id = ?').bind('LN-adm').first();
  assert.equal(row.loan_status, 'Disbursed');
  assert.equal(row.cash_amount, 1000);
  assert.equal(row.online_amount, 2000);
});

test('markLoanDisbursed: a Subadmin still cannot disburse', async () => {
  const env = makeEnv();
  await seedApprovedLoan(env, { loanId: 'LN-sub', amount: 3000 });
  const err = await markLoanDisbursed(env, 'LN-sub', 3000, 0, SUBADMIN).then(() => null, e => e);
  assert.ok(err, 'refused');
  const row = await env.DB_LOANS_EXPENSES.prepare('SELECT loan_status FROM loans WHERE loan_id = ?').bind('LN-sub').first();
  assert.equal(row.loan_status, 'Approved', 'unchanged');
});

test('markLoanDisbursed: total MORE than the loan amount is rejected', async () => {
  const env = makeEnv();
  await seedApprovedLoan(env, { loanId: 'LN-more', amount: 100 });
  const err = await markLoanDisbursed(env, 'LN-more', 8238, 50585, ADMIN).then(() => null, e => e); // 58823 != 100
  assert.ok(err, 'refused');
  assert.match(err.message, /must equal the sanctioned loan amount/i);
  const row = await env.DB_LOANS_EXPENSES.prepare('SELECT loan_status FROM loans WHERE loan_id = ?').bind('LN-more').first();
  assert.equal(row.loan_status, 'Approved', 'not disbursed');
});

test('markLoanDisbursed: total LESS than the loan amount is rejected', async () => {
  const env = makeEnv();
  await seedApprovedLoan(env, { loanId: 'LN-less', amount: 3000 });
  const err = await markLoanDisbursed(env, 'LN-less', 1000, 500, ADMIN).then(() => null, e => e); // 1500 != 3000
  assert.ok(err, 'refused');
  assert.match(err.message, /must equal the sanctioned loan amount/i);
});

test('markLoanDisbursed: total EXACTLY equal to the loan amount succeeds (cash+online split)', async () => {
  const env = makeEnv();
  await seedApprovedLoan(env, { loanId: 'LN-eq', amount: 3000 });
  const res = await markLoanDisbursed(env, 'LN-eq', 3000, 0, ADMIN);
  assert.equal(res.success, true);
});
