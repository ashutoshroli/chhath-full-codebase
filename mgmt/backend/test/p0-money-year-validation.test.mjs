// ====== AUDIT P0-09 — money, year and server-owned columns ======
//
// validatePayload only asked `isNaN(parseFloat(Amount))`, so -500, 1e21 and
// '12.3456' all saved. A negative EXPENSE inflates the yearly surplus — the exact
// figure the lending budget is derived from (availableLoanFund) — and a negative
// COLLECTION corrupts every total the public portal publishes.
//
// The YEAR was not required on financial rows at all, and saveRecord only runs the
// lock/access checks `if (payload.Year)`, so a row with no year skipped both.
//
// And toColumnPayload accepts any snake_case key, so a client could send
// `created_by`, `announcedcount`, `loan_status`, `cash_amount`, … and have it
// written straight through: re-attributing someone else's entry, or moving a loan's
// status without going near the workflow that owns it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { saveRecord, updateRecordByIdx } from '../src/crud.js';
import { assertMoney, assertYear, assertNoServerOwnedFields, MAX_MONEY } from '../src/validate.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  core.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').bind('USER0009', 'Ram').run();
  return {
    DB_CORE: core,
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
  };
}

const collection = (over = {}) => ({
  Year: 2026, Name: 'USER0009', Amount: 500, 'Contribution Type': '1', 'Payment Mode': 'Cash', ...over,
});
const expense = (over = {}) => ({ Year: 2026, Discription: 'Tent', Amount: 15000, ...over });

const rows = async (db, sql) => (await db.prepare(sql).all()).results;

// ============================================== 1. NEGATIVE / MALFORMED MONEY

test('P0-09: a NEGATIVE collection amount is refused', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => saveRecord(env, 'COLLECTIONS', collection({ Amount: -500 }), SUPERADMIN),
    /must be more than zero/
  );
  assert.equal((await rows(env.DB_COLLECTIONS, 'SELECT * FROM collections')).length, 0);
});

test('P0-09: a NEGATIVE expense amount is refused (it inflated the lending budget)', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => saveRecord(env, 'EXPENSES', expense({ Amount: -15000 }), SUPERADMIN),
    /must be more than zero/
  );
  assert.equal((await rows(env.DB_LOANS_EXPENSES, 'SELECT * FROM expenses')).length, 0);
});

test('P0-09: zero is refused, and so are absurd magnitudes', async () => {
  const env = makeEnv();
  for (const bad of [0, '0', '0.00', 1e21, MAX_MONEY + 1]) {
    await assert.rejects(
      () => saveRecord(env, 'COLLECTIONS', collection({ Amount: bad }), SUPERADMIN),
      (err) => { assert.equal(err.expected, true, 'must be a 400, not a 500'); return true; },
      `Amount=${bad} must be refused`
    );
  }
});

test('P0-09: more than two decimal places is refused', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => saveRecord(env, 'COLLECTIONS', collection({ Amount: '12.3456' }), SUPERADMIN),
    /at most 2 decimal places/
  );
});

test('P0-09: ordinary amounts still save, paise included', async () => {
  const env = makeEnv();
  await saveRecord(env, 'COLLECTIONS', collection({ Amount: 1500 }), SUPERADMIN);
  await saveRecord(env, 'COLLECTIONS', collection({ Amount: '1500.50' }), SUPERADMIN);

  const stored = await rows(env.DB_COLLECTIONS, 'SELECT amount FROM collections ORDER BY id');
  assert.deepEqual(stored.map(r => Number(r.amount)), [1500, 1500.5]);
});

test('P0-09: a comma-formatted amount is refused, not stored as NaN', async () => {
  const env = makeEnv();
  // validatePayload only validates — the RAW value reaches D1 — so accepting
  // '1,200' would write NaN into a REAL column.
  await assert.rejects(
    () => saveRecord(env, 'COLLECTIONS', collection({ Amount: '1,200' }), SUPERADMIN),
    /no commas/
  );
  assert.equal((await rows(env.DB_COLLECTIONS, 'SELECT * FROM collections')).length, 0);
});

test('P0-09: a non-cash contribution still needs no amount', async () => {
  const env = makeEnv();
  const res = await saveRecord(env, 'COLLECTIONS', collection({
    'Contribution Type': '2', Amount: '', Detail: 'Two sacks of rice',
  }), SUPERADMIN);
  assert.equal(res.success, true);
});

test('P0-09: a negative loan rate or tenure is refused, zero is allowed', async () => {
  const env = makeEnv();
  const loan = (over) => ({ Year: 2026, Name: 'USER0009', Amount: 1000, ...over });

  await assert.rejects(
    () => saveRecord(env, 'LOANS', loan({ 'Intrest Rate': -5 }), SUPERADMIN), /Interest Rate/);
  await assert.rejects(
    () => saveRecord(env, 'LOANS', loan({ Tenure: -1 }), SUPERADMIN), /Tenure/);

  const ok = await saveRecord(env, 'LOANS', loan({ 'Intrest Rate': 0, Tenure: 0 }), SUPERADMIN);
  assert.equal(ok.success, true, 'an interest-free loan is legitimate');
});

// ================================================== 2. YEAR IS MANDATORY

test('P0-09: a financial row with NO year is refused', async () => {
  const env = makeEnv();
  // On main this saved, and both `requireYearUnlocked` and `requireYearAccess`
  // were skipped because saveRecord only checks them `if (payload.Year)`.
  await assert.rejects(
    () => saveRecord(env, 'COLLECTIONS', collection({ Year: '' }), SUPERADMIN), /Year is required/);
  await assert.rejects(
    () => saveRecord(env, 'EXPENSES', expense({ Year: undefined }), SUPERADMIN), /Year is required/);
  assert.equal((await rows(env.DB_COLLECTIONS, 'SELECT * FROM collections')).length, 0);
});

test('P0-09: a nonsense year is refused', async () => {
  const env = makeEnv();
  for (const bad of ['abc', '20xx', 1999, 2101, '2026.5']) {
    await assert.rejects(
      () => saveRecord(env, 'COLLECTIONS', collection({ Year: bad }), SUPERADMIN),
      /Year/,
      `Year=${bad} must be refused`
    );
  }
});

test('P0-09: USERS still saves without a year (it has no year column)', async () => {
  const env = makeEnv();
  const res = await saveRecord(env, 'USERS', { Name: 'New Member' }, SUPERADMIN);
  assert.equal(res.success, true);
});

// ========================================== 3. SERVER-OWNED COLUMNS

test('P0-09: a client cannot set created_by on a save', async () => {
  const env = makeEnv();
  for (const key of ['created_by', 'Created By']) {
    await assert.rejects(
      () => saveRecord(env, 'COLLECTIONS', collection({ [key]: 'USER0002' }), SUPERADMIN),
      /set by the server/,
      `${key} must be refused`
    );
  }
});

test('P0-09: a client cannot set the announce counters or a loan status', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => saveRecord(env, 'COLLECTIONS', collection({ announcedcount: 99 }), SUPERADMIN), /set by the server/);
  await assert.rejects(
    () => saveRecord(env, 'COLLECTIONS', collection({ Announced: 'TRUE' }), SUPERADMIN), /set by the server/);
  await assert.rejects(
    () => saveRecord(env, 'LOANS', { Year: 2026, Name: 'USER0009', Amount: 100, loan_status: 'Disbursed' }, SUPERADMIN),
    /set by the server/);
  await assert.rejects(
    () => saveRecord(env, 'LOANS', { Year: 2026, Name: 'USER0009', Amount: 100, 'Cash Amount': 100 }, SUPERADMIN),
    /set by the server/);
});

test('P0-09: a generated id sent on SAVE is still silently discarded (H-9 contract)', async () => {
  const env = makeEnv();
  const u = await saveRecord(env, 'USERS', { Name: 'Sneaky', ID: 'USER0001' }, SUPERADMIN);
  const c = await saveRecord(env, 'COLLECTIONS', collection({ 'Sl. No.': 9999 }), SUPERADMIN);
  // makeEnv seeds USER0009, so the next allocation is USER0010 — never the
  // USER0001 the request asked for.
  assert.equal(u.id, 'USER0010', 'allocated, not taken from the request');
  assert.equal(c.slNo, 1, 'the client-supplied 9999 is discarded');
});

test('P0-09: but an EDIT cannot rewrite a receipt number or a member id', async () => {
  const env = makeEnv();
  const c = await saveRecord(env, 'COLLECTIONS', collection(), SUPERADMIN);
  const idx = await env.DB_COLLECTIONS.prepare('SELECT id FROM collections').first('id');

  // On main these were written straight through by toColumnPayload.
  await assert.rejects(
    () => updateRecordByIdx(env, 'COLLECTIONS', idx, collection({ 'Sl. No.': 4242 }), SUPERADMIN),
    /set by the server/);
  await assert.rejects(
    () => updateRecordByIdx(env, 'COLLECTIONS', idx, collection({ created_by: 'USER0002' }), SUPERADMIN),
    /set by the server/);

  const stored = await env.DB_COLLECTIONS.prepare('SELECT sl_no, created_by FROM collections').first();
  assert.equal(Number(stored.sl_no), Number(c.slNo));
  assert.equal(stored.created_by, 'USER0001');
});

test('P0-09: an ordinary edit still works', async () => {
  const env = makeEnv();
  await saveRecord(env, 'COLLECTIONS', collection(), SUPERADMIN);
  const idx = await env.DB_COLLECTIONS.prepare('SELECT id FROM collections').first('id');

  const res = await updateRecordByIdx(env, 'COLLECTIONS', idx, collection({ Amount: 750 }), SUPERADMIN);

  assert.equal(res.success, true);
  assert.equal(Number(await env.DB_COLLECTIONS.prepare('SELECT amount FROM collections').first('amount')), 750);
});

// ========================================== 4. THE VALIDATORS THEMSELVES

test('P0-09: assertMoney returns a Number and rejects the bad shapes', () => {
  assert.equal(assertMoney('1500.50', 'Amount'), 1500.5);
  assert.equal(assertMoney(' 1500 ', 'Amount'), 1500, 'surrounding whitespace is fine');
  assert.throws(() => assertMoney('1,200', 'Amount'), /no commas/);
  assert.equal(assertMoney('', 'Amount', { required: false }), null);
  for (const bad of ['', '-1', '0', 'abc', 'Infinity', '1e5', '12.345']) {
    assert.throws(() => assertMoney(bad, 'Amount'), /Amount/, `${bad} must throw`);
  }
  assert.equal(assertMoney('0', 'Rate', { min: 0 }), 0, 'min can be relaxed for rates');
});

test('P0-09: assertYear accepts a plausible festival year only', () => {
  assert.equal(assertYear('2026'), 2026);
  assert.equal(assertYear('', 'Year', { required: false }), null);
  for (const bad of ['', 'abc', '1999', '2101', '2026.5', '-2026']) {
    assert.throws(() => assertYear(bad), /Year/, `${bad} must throw`);
  }
});

test('P0-09: assertNoServerOwnedFields folds spelling variants and honours allow', () => {
  const aliases = { 'Sl. No.': 'sl_no', 'Created By': 'created_by' };
  for (const key of ['created_by', 'Created By', 'CREATED BY', 'createdby']) {
    assert.throws(
      () => assertNoServerOwnedFields('collections', { [key]: 'x' }, { aliases }),
      /set by the server/,
      `${key} must be recognised`
    );
  }
  // allow-listed (the caller discards it itself)
  assert.doesNotThrow(() => assertNoServerOwnedFields('collections', { 'Sl. No.': 1 }, { aliases, allow: ['sl_no'] }));
  assert.doesNotThrow(() => assertNoServerOwnedFields('collections', { Amount: 100, Name: 'USER0009' }, { aliases }));
  // a table with nothing protected is a no-op
  assert.doesNotThrow(() => assertNoServerOwnedFields('manual_years', { created_by: 'x' }, {}));
});
