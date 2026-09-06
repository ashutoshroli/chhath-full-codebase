// ============ BUGFIX: "rowIndex required" when deleting a Loan template ============
//
// The WhatsApp Templates screen deletes/updates/toggles a loan template by
// `r.__rowIndex` and the backend runs `WHERE id = ?`. Person/group templates get
// `__rowIndex` via getSheetDataAsJSON -> fromColumnRow (which aliases `id` ->
// `__rowIndex`), but getLoanTemplates returned the raw D1 rows, which have `id`
// but NO `__rowIndex`. So every loan-template delete/update failed with
// "rowIndex required".
//
// These tests assert getLoanTemplates now exposes `__rowIndex`, that it equals the
// row's id, and that feeding it straight back into deleteLoanTemplate /
// updateLoanTemplate works end to end.
//
// Run: node --test mgmt/backend/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import {
  getLoanTemplates, addLoanTemplate, deleteLoanTemplate, updateLoanTemplate,
} from '../src/loans.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

function makeEnv() {
  const loansExpenses = makeD1(schemaFor('loans_expenses.sql'));
  return { DB_LOANS_EXPENSES: loansExpenses };
}

test('getLoanTemplates exposes __rowIndex, and it equals the row id', async () => {
  const env = makeEnv();
  await addLoanTemplate(env, 'otp', 'Your OTP is {OTP}', 'normal', '', SUPERADMIN);

  const rows = await getLoanTemplates(env, 'otp');
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.ok(r.__rowIndex, 'a loan template row must carry __rowIndex (this was the bug)');
  assert.equal(r.__rowIndex, r.id, '__rowIndex must equal the id used by WHERE id = ?');
  // The raw columns the screen reads must still be present.
  assert.equal(r.text, 'Your OTP is {OTP}');
  assert.equal(r.type, 'otp');
});

test('deleting a loan template by its __rowIndex actually removes it (no "rowIndex required")', async () => {
  const env = makeEnv();
  await addLoanTemplate(env, 'disbursement', 'Loan disbursed', 'normal', '', SUPERADMIN);

  const [row] = await getLoanTemplates(env, 'disbursement');
  // Exactly what WhatsApp.jsx does: del(r.__rowIndex)
  await assert.doesNotReject(() => deleteLoanTemplate(env, row.__rowIndex, SUPERADMIN));

  const after = await getLoanTemplates(env, 'disbursement');
  assert.equal(after.length, 0, 'the template should be gone');
});

test('updating a loan template by its __rowIndex works', async () => {
  const env = makeEnv();
  await addLoanTemplate(env, 'consent_group', 'Old text', 'normal', '', SUPERADMIN);
  const [row] = await getLoanTemplates(env, 'consent_group');

  await updateLoanTemplate(env, row.__rowIndex, 'New text', undefined, undefined, undefined, SUPERADMIN);
  const [updated] = await getLoanTemplates(env, 'consent_group');
  assert.equal(updated.text, 'New text');
});

test('deleteLoanTemplate still rejects a genuinely missing rowIndex', async () => {
  const env = makeEnv();
  await assert.rejects(() => deleteLoanTemplate(env, undefined, SUPERADMIN), /rowIndex required/);
  await assert.rejects(() => deleteLoanTemplate(env, 0, SUPERADMIN), /rowIndex required/);
});

test('regression: an empty loan-template list returns [] without throwing', async () => {
  const env = makeEnv();
  const rows = await getLoanTemplates(env, 'otp');
  assert.deepEqual(rows, []);
});
