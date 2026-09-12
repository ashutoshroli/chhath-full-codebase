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
  const out = fmt(1200);
  assert.match(out, /1,200/);
  assert.match(fmt(0), /0/);
});

test('computeBudget: prior-year loan interest math for a specific year', () => {
  const collections = [
    { Year: '2023', Amount: '5000' },
    { Year: '2023', Amount: '2500' },
    { Year: '2022', Amount: '9999' },
  ];
  const loans = [
    { Year: '2022', Amount: '10000', 'Intrest Rate': '2', Tenure: '6' },
    { Year: '2023', Amount: '99999', 'Intrest Rate': '5', Tenure: '12' },
  ];
  const expenses = [
    { Year: '2023', Amount: '3000' },
    { Year: '2021', Amount: '500' },
  ];

  const b = computeBudget(collections, loans, expenses, 2023);
  assert.equal(b.currentCollection, 7500);
  assert.equal(b.pastLoanReturned, 11200);
  assert.equal(b.totalBudget, 7500 + 11200);
  assert.equal(b.totalExpense, 3000);
  assert.equal(b.netSurplus, (7500 + 11200) - 3000);
});

test('computeBudget: "Interest Rate" correct-spelling fallback is honored', () => {
  const loans = [{ Year: '2020', Amount: '1000', 'Interest Rate': '1', Tenure: '10' }];
  const b = computeBudget([], loans, [], 2021);
  assert.equal(b.pastLoanReturned, 1100);
});

test('computeBudget: misspelled "Intrest Rate" is preferred over "Interest Rate"', () => {
  const loans = [{ Year: '2020', Amount: '1000', 'Intrest Rate': '2', 'Interest Rate': '9', Tenure: '5' }];
  const b = computeBudget([], loans, [], 2021);
  assert.equal(b.pastLoanReturned, 1100);
});

test('computeBudget: isAll="All" sums every year and every loan', () => {
  const collections = [
    { Year: '2022', Amount: '1000' },
    { Year: '2023', Amount: '2000' },
  ];
  const loans = [
    { Year: '2021', Amount: '5000', 'Intrest Rate': '0', Tenure: '0' },
    { Year: '2022', Amount: '3000', 'Intrest Rate': '0', Tenure: '0' },
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
