// ============ CSV bulk import (importCsvRows) ============
//
// Proves the Superadmin CSV importer:
//   - reuses saveRecord's validation (bad rows are SKIPPED with a reason, good
//     rows still import — the import is not all-or-nothing),
//   - returns an accurate report {total, imported, skipped, failures[]},
//   - only accepts the safe sheets (Users / Collections / Committee Members),
//   - refuses Loans and any other sheet,
//   - is Superadmin-only.
//
// Run: node --test mgmt/backend/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { importCsvRows, importableSheets } from '../src/csvImport.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0002', role: 'Admin' };

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const collections = makeD1(schemaFor('collections.sql'));
  return {
    DB_CORE: core,
    DB_COLLECTIONS: collections,
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
  };
}

async function countUsers(env) {
  const r = await env.DB_CORE.prepare('SELECT COUNT(*) AS c FROM users').first();
  return Number(r.c);
}

// -------------------------------------------------------------- USERS

test('imports valid Users rows and reports the count', async () => {
  const env = makeEnv();
  const rows = [
    { Name: 'Ramesh', Village: 'Shaharpura', Mobile: '9876543210' },
    { Name: 'Sita', Village: 'Gardih' },
  ];
  const { report } = await importCsvRows(env, 'USERS', rows, SUPERADMIN);
  assert.equal(report.total, 2);
  assert.equal(report.imported, 2);
  assert.equal(report.skipped, 0);
  assert.equal(await countUsers(env), 2);
});

test('a bad row is SKIPPED with a reason, good rows still import', async () => {
  const env = makeEnv();
  const rows = [
    { Name: 'Good One', Mobile: '9876543210' },
    { Name: 'Bad Mobile', Mobile: '123' },       // fails the 10-digit rule
    { Name: '', Village: 'Somewhere' },           // missing required Name (but not an empty row)
    { Name: 'Good Two' },
  ];
  const { report } = await importCsvRows(env, 'USERS', rows, SUPERADMIN);
  assert.equal(report.total, 4);
  assert.equal(report.imported, 2, 'the two valid rows are in');
  assert.equal(report.skipped, 2, 'the two invalid rows are skipped');
  assert.equal(await countUsers(env), 2);

  // The failures carry the row number and a human reason.
  const badMobile = report.failures.find(f => f.name === 'Bad Mobile');
  assert.ok(badMobile, 'the bad-mobile row is reported');
  assert.equal(badMobile.row, 2, '1-based data row number');
  assert.match(badMobile.reason, /10 digits/i);

  // Row 3 has a Village but no Name -> reaches the "Missing required field: Name" check.
  const missingName = report.failures.find(f => f.row === 3);
  assert.match(missingName.reason, /Name/i);
});

test('a completely empty row is skipped, not counted as imported', async () => {
  const env = makeEnv();
  const rows = [{ Name: '', Village: '', Mobile: '' }, { Name: 'Real Person' }];
  const { report } = await importCsvRows(env, 'USERS', rows, SUPERADMIN);
  assert.equal(report.imported, 1);
  assert.equal(report.skipped, 1);
  assert.match(report.failures[0].reason, /empty/i);
});

// -------------------------------------------------------------- COMMITTEE

test('imports Committee Members', async () => {
  const env = makeEnv();
  const rows = [{ Year: '2026', Name: 'USER0001', 'View Role': 'President' }];
  const { report } = await importCsvRows(env, 'COMMITEE MEMBERS', rows, SUPERADMIN);
  assert.equal(report.imported, 1);
  const r = await env.DB_CORE.prepare("SELECT view_role FROM committee_members WHERE name = 'USER0001'").first();
  assert.equal(r.view_role, 'President');
});

// -------------------------------------------------------------- SHEET GUARD

test('Loans cannot be bulk-imported', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => importCsvRows(env, 'LOANS', [{ Name: 'x', Amount: '1' }], SUPERADMIN),
    (err) => { assert.equal(err.expected, true); assert.match(err.message, /cannot be bulk-imported/i); return true; }
  );
});

test('an unknown sheet is refused', async () => {
  const env = makeEnv();
  await assert.rejects(() => importCsvRows(env, 'LOGIN', [{ Name: 'x' }], SUPERADMIN), /cannot be bulk-imported/i);
});

test('importableSheets lists Users, Collections, Committee Members, Expenses', () => {
  const keys = importableSheets().map(s => s.key).sort();
  assert.deepEqual(keys, ['COLLECTIONS', 'COMMITEE MEMBERS', 'EXPENSES', 'USERS']);
});

test('imports Expenses rows', async () => {
  const env = makeEnv();
  const rows = [
    { Year: '2026', Discription: 'Tent', Amount: '15000', Category: 'Decoration' },
    { Year: '2026', Discription: '', Amount: '500' },        // missing required Discription -> skipped
    { Year: '2026', Discription: 'Prasad', Amount: 'abc' },  // Amount not a number -> skipped
  ];
  const { report } = await importCsvRows(env, 'EXPENSES', rows, SUPERADMIN);
  assert.equal(report.total, 3);
  assert.equal(report.imported, 1);
  assert.equal(report.skipped, 2);
  const r = await env.DB_LOANS_EXPENSES.prepare("SELECT amount FROM expenses WHERE discription = 'Tent'").first();
  assert.equal(Number(r.amount), 15000);
  // The failure report identifies the bad Amount row by its description.
  const badAmount = report.failures.find(f => f.name === 'Prasad');
  assert.ok(badAmount, 'the bad-amount expense is reported with its description');
  assert.match(badAmount.reason, /number/i);
});

// -------------------------------------------------------------- AUTH

test('a non-Superadmin cannot import', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => importCsvRows(env, 'USERS', [{ Name: 'x' }], ADMIN),
    /Only a Superadmin can perform this action/i
  );
});

// -------------------------------------------------------------- LIMITS

test('too many rows is refused before any insert', async () => {
  const env = makeEnv();
  const rows = Array.from({ length: 2001 }, (_, i) => ({ Name: 'U' + i }));
  await assert.rejects(() => importCsvRows(env, 'USERS', rows, SUPERADMIN), /Too many rows/i);
  assert.equal(await countUsers(env), 0, 'nothing was inserted');
});

test('non-array rows is a clean validation error', async () => {
  const env = makeEnv();
  await assert.rejects(() => importCsvRows(env, 'USERS', null, SUPERADMIN), /No rows/i);
});

test('unknown CSV columns are ignored, not an error', async () => {
  const env = makeEnv();
  const rows = [{ Name: 'Ramesh', SomeRandomColumn: 'whatever', AnotherOne: '123' }];
  const { report } = await importCsvRows(env, 'USERS', rows, SUPERADMIN);
  assert.equal(report.imported, 1);
});
