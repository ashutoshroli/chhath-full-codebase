// Unit tests for the framework-free budget math.
// Runs under plain `node --test` — imports ONLY src/lib/finance.js (no Astro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, parseAmt, isResellRow, computeBudget } from '../src/lib/finance.js';

test('parseAmt strips currency/grouping characters', () => {
  assert.equal(parseAmt('\u20B91,200'), 1200);
  assert.equal(parseAmt('1,200.50'), 1200.5);
  assert.equal(parseAmt(''), 0);
  assert.equal(parseAmt(null), 0);
  assert.equal(parseAmt('abc'), 0);
  assert.equal(parseAmt(5000), 5000);
});

test('isResellRow is truthy for true / "TRUE" / " true "', () => {
  assert.ok(isResellRow({ 'Is Resell': true }));
  assert.ok(isResellRow({ 'Is Resell': 'TRUE' }));
  assert.ok(isResellRow({ 'Is Resell': ' true ' }));
  assert.ok(!isResellRow({ 'Is Resell': 'false' }));
  assert.ok(!isResellRow({ 'Is Resell': '' }));
  assert.ok(!isResellRow({}));
  assert.ok(!isResellRow(null));
});

test('fmt renders the amount digits with Indian grouping', () => {
  // Assert loosely on the digits/grouping rather than a brittle exact glyph.
  const out = fmt(1200);
  assert.match(out, /1,200/);
  assert.match(fmt(0), /0/);
});

test('computeBudget: prior-year loan interest math for a specific year', () => {
  // Loan in year 2022 is RETURNED (with interest) in 2023's budget.
  // principal 10000, Intrest Rate 2 %/mo, Tenure 6 -> interest = 10000*(2/100)*6 = 1200
  // returned = 10000 + 1200 = 11200.
  const collections = [
    { Year: '2023', Amount: '5000' },
    { Year: '2023', Amount: '2500' },
    { Year: '2022', Amount: '9999' }, // wrong year, must be ignored for 2023
  ];
  const loans = [
    { Year: '2022', Amount: '10000', 'Intrest Rate': '2', Tenure: '6' },
    { Year: '2023', Amount: '99999', 'Intrest Rate': '5', Tenure: '12' }, // not year-1, ignored
  ];
  const expenses = [
    { Year: '2023', Amount: '3000' },
    { Year: '2021', Amount: '500' }, // wrong year, ignored
  ];

  const b = computeBudget(collections, loans, expenses, 2023);
  assert.equal(b.currentCollection, 7500);
  assert.equal(b.pastLoanReturned, 11200);
  assert.equal(b.totalBudget, 7500 + 11200);
  assert.equal(b.totalExpense, 3000);
  assert.equal(b.netSurplus, (7500 + 11200) - 3000);
});

test('computeBudget: "Interest Rate" correct-spelling fallback is honored', () => {
  // Only the correctly-spelled column is present -> still parsed.
  const loans = [{ Year: '2020', Amount: '1000', 'Interest Rate': '1', Tenure: '10' }];
  // interest = 1000*(1/100)*10 = 100; returned = 1100.
  const b = computeBudget([], loans, [], 2021);
  assert.equal(b.pastLoanReturned, 1100);
});

test('computeBudget: misspelled "Intrest Rate" is preferred over "Interest Rate"', () => {
  // Both present: the misspelling is checked FIRST (matches the old site).
  const loans = [{ Year: '2020', Amount: '1000', 'Intrest Rate': '2', 'Interest Rate': '9', Tenure: '5' }];
  // interest uses 2 %/mo -> 1000*(2/100)*5 = 100; returned = 1100.
  const b = computeBudget([], loans, [], 2021);
  assert.equal(b.pastLoanReturned, 1100);
});

test('computeBudget: isAll="All" sums every year and every loan', () => {
  const collections = [
    { Year: '2022', Amount: '1000' },
    { Year: '2023', Amount: '2000' },
  ];
  const loans = [
    { Year: '2021', Amount: '5000', 'Intrest Rate': '0', Tenure: '0' }, // interest 0 -> returned 5000
    { Year: '2022', Amount: '3000', 'Intrest Rate': '0', Tenure: '0' }, // returned 3000
  ];
  const expenses = [
    { Year: '2022', Amount: '400' },
    { Year: '2023', Amount: '600' },
  ];
  const b = computeBudget(collections, loans, expenses, 'All');
  assert.equal(b.currentCollection, 3000);
  assert.equal(b.pastLoanReturned, 8000);
  assert.equal(b.totalBudget, 11000);
  assert.equal(b.totalExpense, 1000);
  assert.equal(b.netSurplus, 10000);
});

test('computeBudget: guards missing arrays', () => {
  const b = computeBudget(undefined, undefined, undefined, 2023);
  assert.equal(b.currentCollection, 0);
  assert.equal(b.pastLoanReturned, 0);
  assert.equal(b.totalBudget, 0);
  assert.equal(b.totalExpense, 0);
  assert.equal(b.netSurplus, 0);
});
