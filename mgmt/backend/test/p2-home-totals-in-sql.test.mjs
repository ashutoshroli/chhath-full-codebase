// ============ AUDIT P-2 — Home shipped every collection row to sum them ============
//
// getHomeData computed the budget by reading EVERY collection row and EVERY expense
// row into the isolate and summing them in JS. With year = 'All' that is the entire
// financial history of the committee, on the first screen every user sees after login.
//
// The critical property to prove is that moving the arithmetic into SQL produces the
// SAME NUMBERS — these are money figures on a finance portal, so "faster but slightly
// different" would be a far worse bug than the one being fixed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { getHomeData } from '../src/views.js';

const parseAmt = (v) => parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;

function makeEnv() {
  return {
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_CORE: makeD1(schemaFor('core.sql')),
  };
}

function seed(env, { years = [2025, 2026], perYear = 5 } = {}) {
  let sl = 0;
  for (const y of years) {
    for (let i = 1; i <= perYear; i++) {
      env.DB_COLLECTIONS.prepare(
        'INSERT INTO collections (year, sl_no, name, amount, payment_mode, contribution_type, is_resell) VALUES (?,?,?,?,?,?,?)')
        .bind(y, ++sl, `USER${String(i).padStart(4, '0')}`, 100 * i + y, 'Cash', 1, 'FALSE').run();
      env.DB_LOANS_EXPENSES.prepare(
        'INSERT INTO expenses (year, discription, amount, category) VALUES (?,?,?,?)')
        .bind(y, `Item ${i}`, 10 * i, 'Lighting').run();
    }
    env.DB_LOANS_EXPENSES.prepare(
      'INSERT INTO loans (year, name, amount, intrest_rate, tenure, loan_id, status) VALUES (?,?,?,?,?,?,?)')
      .bind(y, 'USER0001', 20000 + y, 2, 12, `LN-${y}`, 'Active').run();
  }
}

// The OLD implementation, reproduced exactly, to compare against.
function expectedTotalsInJs(rows, expenses, prevLoans) {
  const totCol = rows.reduce((s, c) => s + parseAmt(c.amount), 0);
  const totExp = expenses.reduce((s, e) => s + parseAmt(e.amount), 0);
  let pastRet = 0;
  prevLoans.forEach(l => {
    const principal = parseAmt(l.amount);
    const rate = parseAmt(l.intrest_rate);
    const tenure = parseAmt(l.tenure);
    pastRet += principal + (principal * (rate / 100) * tenure);
  });
  return { totCol, totExp, pastRet };
}

test('P-2: the SQL totals match the old JS totals EXACTLY, for a specific year', async () => {
  const env = makeEnv();
  seed(env);

  const cols = (await env.DB_COLLECTIONS.prepare('SELECT * FROM collections WHERE year = 2026').all()).results;
  const exps = (await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM expenses WHERE year = 2026').all()).results;
  const prev = (await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loans WHERE year = 2025').all()).results;
  const want = expectedTotalsInJs(cols, exps, prev);

  const got = await getHomeData(env, 2026);
  assert.equal(got.totCol, want.totCol, 'collection total must be identical');
  assert.equal(got.totExp, want.totExp, 'expense total must be identical');
  assert.equal(got.pastRet, want.pastRet, 'past-loan-returned must be identical');
  assert.equal(got.totBudget, want.totCol + want.pastRet);
  assert.equal(got.surplus, (want.totCol + want.pastRet) - want.totExp);
});

test('P-2: the SQL totals match the old JS totals EXACTLY, for All Years', async () => {
  const env = makeEnv();
  seed(env, { years: [2023, 2024, 2025, 2026], perYear: 7 });

  const cols = (await env.DB_COLLECTIONS.prepare('SELECT * FROM collections').all()).results;
  const exps = (await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM expenses').all()).results;
  const allLoans = (await env.DB_LOANS_EXPENSES.prepare('SELECT * FROM loans').all()).results;
  const want = expectedTotalsInJs(cols, exps, allLoans);

  const got = await getHomeData(env, 'All');
  assert.equal(got.totCol, want.totCol);
  assert.equal(got.totExp, want.totExp);

  // FLOATING-POINT NOTE (a real, deliberate difference — not a rounding bug):
  // over many rows the two sums can differ in the last bits, e.g.
  //     SQL SUM()  -> 109241.52
  //     the JS loop -> 109241.51999999999
  // SQLite's SUM() uses compensated (Kahan-Babuška) summation, whereas the old JS
  // `+=` loop accumulated naive error — so where they differ, the SQL value is the
  // MORE accurate one. Both render identically on the budget card, because fmt()
  // formats with maximumFractionDigits: 0.
  //
  // Assert both properties explicitly: agreement to well within a paisa, AND an
  // identical displayed figure. That is the contract that actually matters on a
  // finance screen.
  const drift = Math.abs(got.pastRet - want.pastRet);
  assert.ok(drift < 1e-6, `past-loan-returned drifted by ${drift}, which is more than float noise`);
  assert.equal(Math.round(got.pastRet), Math.round(want.pastRet),
    'the DISPLAYED figure must be identical to the old implementation');
});

test('P-2: All Years caps the ROW LIST but keeps the TOTALS exact over every row', async () => {
  const env = makeEnv();
  // 1,500 rows — more than the 1,000 cap.
  for (let i = 1; i <= 1500; i++) {
    env.DB_COLLECTIONS.prepare(
      'INSERT INTO collections (year, sl_no, name, amount, contribution_type, is_resell) VALUES (?,?,?,?,?,?)')
      .bind(2020 + (i % 7), i, 'USER0001', 100, 1, 'FALSE').run();
  }

  const res = await getHomeData(env, 'All');
  assert.equal(res.collections.length, 1000, 'the list is capped');
  assert.equal(res.hasMore, true, 'and the UI is told there is more');
  assert.equal(res.totalRows, 1500);
  assert.equal(res.shownRows, 1000);
  // THE POINT: the money is still right.
  assert.equal(res.totCol, 150000, 'the total must cover ALL 1500 rows, not just the 1000 shown');
});

test('P-2: a specific year still returns EVERY row (data entry must not be truncated)', async () => {
  const env = makeEnv();
  for (let i = 1; i <= 1400; i++) {
    env.DB_COLLECTIONS.prepare(
      'INSERT INTO collections (year, sl_no, name, amount, contribution_type, is_resell) VALUES (?,?,?,?,?,?)')
      .bind(2026, i, 'USER0001', 50, 1, 'FALSE').run();
  }
  const res = await getHomeData(env, 2026);
  assert.equal(res.collections.length, 1400, 'a single year is never capped — search must cover it all');
  assert.equal(res.hasMore, false);
  assert.equal(res.rowLimit, null);
  assert.equal(res.totCol, 70000);
});

test('P-2: All Years rows come back newest-first, in the header-keyed shape', async () => {
  const env = makeEnv();
  seed(env, { years: [2024, 2025, 2026], perYear: 3 });
  const res = await getHomeData(env, 'All');
  const years = res.collections.map(r => parseInt(r.Year));
  assert.deepEqual(years, [...years].sort((a, b) => b - a), 'must be ordered newest year first');
  // The shape the frontend reads (header keys + __rowIndex), not raw column names.
  const row = res.collections[0];
  for (const key of ['Year', 'Sl. No.', 'Name', 'Amount', 'Payment Mode', '__rowIndex']) {
    assert.ok(key in row, `the header-keyed field ${key} must be present`);
  }
  assert.ok(!('sl_no' in row), 'raw column names must not leak through');
});

test('P-2: an empty year returns zeros, not NULLs', async () => {
  const env = makeEnv();
  const res = await getHomeData(env, 1999);
  assert.equal(res.totCol, 0);
  assert.equal(res.totExp, 0);
  assert.equal(res.pastRet, 0);
  assert.equal(res.totBudget, 0);
  assert.equal(res.surplus, 0);
  assert.deepEqual(res.collections, []);
  // A NULL leaking through would render as "NaN" / "₹NaN" on the budget card.
  for (const v of [res.totCol, res.totExp, res.pastRet, res.totBudget, res.surplus]) {
    assert.equal(typeof v, 'number');
    assert.ok(Number.isFinite(v), 'every figure must be a finite number');
  }
});

test('P-2: NULL amounts, rates and tenures are treated as zero (not NaN)', async () => {
  const env = makeEnv();
  env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name, amount) VALUES (?,?,?,?)')
    .bind(2026, 1, 'USER0001', null).run();
  env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, sl_no, name, amount) VALUES (?,?,?,?)')
    .bind(2026, 2, 'USER0002', 500).run();
  env.DB_LOANS_EXPENSES.prepare('INSERT INTO expenses (year, discription, amount) VALUES (?,?,?)')
    .bind(2026, 'x', null).run();
  // A loan with no rate/tenure — common for a legacy row.
  env.DB_LOANS_EXPENSES.prepare('INSERT INTO loans (year, name, amount, intrest_rate, tenure, loan_id) VALUES (?,?,?,?,?,?)')
    .bind(2025, 'USER0001', 1000, null, null, 'LN-X').run();

  const res = await getHomeData(env, 2026);
  assert.equal(res.totCol, 500, 'a NULL amount contributes 0');
  assert.equal(res.totExp, 0);
  assert.equal(res.pastRet, 1000, 'a loan with no rate/tenure returns just its principal');
  assert.ok(Number.isFinite(res.surplus));
});

test('P-2: the payload no longer grows without bound, and the query count is flat', async () => {
  const counts = {};
  for (const rows of [50, 500, 3000]) {
    const env = makeEnv();
    for (let i = 1; i <= rows; i++) {
      env.DB_COLLECTIONS.prepare(
        'INSERT INTO collections (year, sl_no, name, amount, contribution_type, is_resell) VALUES (?,?,?,?,?,?)')
        .bind(2020 + (i % 5), i, 'USER0001', 10, 1, 'FALSE').run();
    }
    let queries = 0;
    for (const db of Object.values(env)) {
      const real = db.prepare.bind(db);
      db.prepare = (sql) => { queries++; return real(sql); };
    }
    const res = await getHomeData(env, 'All');
    counts[rows] = { queries, shipped: res.collections.length };
  }
  assert.equal(counts[50].queries, counts[3000].queries, 'query count must not depend on row count');
  assert.equal(counts[3000].shipped, 1000, 'the payload is bounded…');
  assert.equal(counts[50].shipped, 50, '…but a small dataset is not padded');
});
