// ====== AUDIT P0-02 — the yearly loan budget must be enforced ATOMICALLY ======
//
// saveLoanTransaction read `SUM(loans.amount) WHERE year` to work out how much
// was still lendable, and wrote the loan later. Two concurrent saves therefore
// both read the same total and both committed: with ₹5,000 available, two
// parallel ₹4,000 loans produced ₹8,000 of lending. Nothing in the code or the
// schema prevented it, and both admins saw a success.
//
// The INSERT now re-checks the sum itself, inside the same batch/transaction:
//
//   INSERT INTO loans (...) SELECT ?,?,...
//     WHERE (SELECT COALESCE(SUM(amount),0) FROM loans WHERE year = ?) + ? <= ?
//
// so the loser of the race inserts ZERO rows and is told so. The guarantors and
// consents are guarded on the loan existing, so a refused loan cannot leave
// orphan rows (a consent orphan would carry a live token).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { saveLoanTransaction, availableLoanFund, loanYearBudget } from '../src/loans.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

function makeEnv(surplus = 5000) {
  const core = makeD1(schemaFor('core.sql'));
  const le = makeD1(schemaFor('loans_expenses.sql'));
  const collections = makeD1(schemaFor('collections.sql'));
  for (const [code, name] of [['USER0002', 'Ram'], ['USER0003', 'Shyam'], ['USER0004', 'Gita'], ['USER0005', 'Sita']]) {
    core.prepare('INSERT INTO users (id_code, name, mobile, whatsapp) VALUES (?,?,?,?)')
      .bind(code, name, 9800000001, 9800000001).run();
  }
  collections.prepare('INSERT INTO collections (year, name, amount) VALUES (?,?,?)')
    .bind(2026, 'USER0002', surplus).run();
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

const loan = (over = {}) => ({ Year: 2026, Name: 'USER0002', Amount: 4000, 'Intrest Rate': 12, Tenure: 1, ...over });
const guarantors = () => [{ Guarantor: 'USER0003' }, { Guarantor: 'USER0004' }, { Guarantor: 'USER0005' }];
const count = (db, sql) => db.prepare(sql).first('n');
const sumLoans = (db) => db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM loans').first('n');

// Commits a competing loan in the window between the budget READ and the batch —
// exactly what a second concurrent request does on a real deployment.
function raceIn(env, amount) {
  const realBatch = env.DB_LOANS_EXPENSES.batch.bind(env.DB_LOANS_EXPENSES);
  let fired = false;
  env.DB_LOANS_EXPENSES.batch = async (stmts) => {
    if (!fired) {
      fired = true;
      await env.DB_LOANS_EXPENSES
        .prepare('INSERT INTO loans (year, name, amount, loan_id, loan_status) VALUES (?,?,?,?,?)')
        .bind(2026, 'USER0002', amount, 'LN-rival', 'Created').run();
    }
    return realBatch(stmts);
  };
}

// ==================================================== 1. THE RACE IS REFUSED

test('P0-02: a loan that would overshoot because of a concurrent save is refused', async () => {
  const env = makeEnv(5000);
  raceIn(env, 4000); // the rival loan lands after our budget read

  const err = await saveLoanTransaction(env, loan({ Amount: 4000 }), guarantors(), SUPERADMIN)
    .then(() => null, e => e);

  // On `main` this resolves with { success: true } and the year holds ₹8,000.
  assert.ok(err, 'the second loan must not be saved');
  assert.match(err.message, /another loan was recorded/i);
  assert.match(err.message, /Nothing was saved/i);

  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 1,
    'only the rival loan exists');
  assert.equal(await sumLoans(env.DB_LOANS_EXPENSES), 4000,
    'the year never exceeds its ₹5,000 surplus');
});

test('P0-02: a refused loan leaves NO guarantor or consent rows behind', async () => {
  const env = makeEnv(5000);
  raceIn(env, 4000);

  await saveLoanTransaction(env, loan({ Amount: 4000 }), guarantors(), SUPERADMIN).catch(() => {});

  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_guarantors'), 0,
    'no orphan guarantors');
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents'), 0,
    'no orphan consents — an orphan consent row would carry a live public token');
});

test('P0-02: the refusal message quotes what is actually left', async () => {
  const env = makeEnv(5000);
  raceIn(env, 3000); // leaves 2000

  const err = await saveLoanTransaction(env, loan({ Amount: 4000 }), guarantors(), SUPERADMIN)
    .then(() => null, e => e);

  assert.ok(err);
  assert.match(err.message, /₹2000 is still available/i);
});

// ============================== 2. THE NORMAL PATHS ARE UNCHANGED

test('P0-02: a loan that still fits after the concurrent save succeeds', async () => {
  const env = makeEnv(5000);
  raceIn(env, 1000); // 1000 + 4000 = 5000 <= 5000

  const res = await saveLoanTransaction(env, loan({ Amount: 4000 }), guarantors(), SUPERADMIN);

  assert.equal(res.success, true);
  assert.equal(await sumLoans(env.DB_LOANS_EXPENSES), 5000, 'the budget is used exactly, not exceeded');
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_guarantors'), 3);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents'), 4);
});

test('P0-02: an uncontended loan is saved exactly as before', async () => {
  const env = makeEnv(5000);
  const res = await saveLoanTransaction(env, loan({ Amount: 5000 }), guarantors(), SUPERADMIN);

  assert.equal(res.success, true);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 1);
  assert.equal(await availableLoanFund(env, 2026), 0, 'the whole surplus is now committed');
});

test('P0-02: the friendly pre-check still explains an obviously too-large loan', async () => {
  const env = makeEnv(5000);
  const err = await saveLoanTransaction(env, loan({ Amount: 6000 }), guarantors(), SUPERADMIN)
    .then(() => null, e => e);

  assert.ok(err);
  assert.match(err.message, /exceeds the amount still available/i,
    'the read-then-check path still produces the detailed figures');
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 0);
});

// ============================== 3. THE BUDGET HELPER

test('P0-02: loanYearBudget exposes surplus, alreadyGiven and available', async () => {
  const env = makeEnv(5000);
  let b = await loanYearBudget(env, 2026);
  assert.deepEqual(b, { surplus: 5000, alreadyGiven: 0, available: 5000 });

  await saveLoanTransaction(env, loan({ Amount: 3000 }), guarantors(), SUPERADMIN);

  b = await loanYearBudget(env, 2026);
  assert.equal(b.surplus, 5000);
  assert.equal(b.alreadyGiven, 3000);
  assert.equal(b.available, 2000);
  assert.equal(await availableLoanFund(env, 2026), 2000, 'the old helper still returns the remainder');
});

test('P0-02: with no year there is no cap, and the plain INSERT is used', async () => {
  const env = makeEnv(5000);
  const b = await loanYearBudget(env, undefined);
  assert.equal(b.surplus, Infinity);
  assert.equal(b.available, Infinity);

  // A yearless loan is a legacy/edge shape; it must still save rather than
  // binding Infinity into SQL.
  const res = await saveLoanTransaction(env, loan({ Year: '' }), guarantors(), SUPERADMIN);
  assert.equal(res.success, true);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loans'), 1);
  assert.equal(await count(env.DB_LOANS_EXPENSES, 'SELECT COUNT(*) AS n FROM loan_consents'), 4);
});
