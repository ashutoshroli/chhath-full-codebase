// ============ AUDIT HIGH #3 — friendly 400 instead of a D1 500 crash ============
//
// getDocxTemplates / getConsentPageTemplate / getLoanConsents / getLoanTemplates
// bound their (docType|type|loanId) parameter straight into a D1 query. When the
// param was omitted, D1 received `undefined` and threw D1_TYPE_ERROR, surfacing as
// a generic HTTP 500 and cluttering the error log. Each now returns a friendly
// ValidationError (expected:true -> 400, not logged) BEFORE touching D1, and still
// works normally when the param is present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { getDocxTemplates } from '../src/docxTemplates.js';
import { getConsentPageTemplate } from '../src/settings.js';
import { getLoanConsents, getLoanTemplates } from '../src/loans.js';

const STAFF = { name: 'USER0003', role: 'Subadmin' };

const missing = [undefined, null, ''];

function isFriendly400(err) {
  assert.equal(err.expected, true, 'must be a ValidationError (expected -> 400, not a 500)');
  assert.match(err.message, /Missing required field/);
  assert.doesNotMatch(err.message || '', /D1_TYPE_ERROR/);
  return true;
}

test('getDocxTemplates: missing docType -> friendly 400, present docType works', async () => {
  const env = { DB_TEMPLATES: makeD1(schemaFor('templates.sql')) };
  for (const v of missing) {
    await assert.rejects(() => getDocxTemplates(env, v), isFriendly400, `docType=${JSON.stringify(v)}`);
  }
  // A real docType still returns (an empty list is fine — no crash).
  const rows = await getDocxTemplates(env, 'receipt');
  assert.ok(Array.isArray(rows));
});

test('getConsentPageTemplate: missing type -> friendly 400, present type works', async () => {
  const env = { DB_TEMPLATES: makeD1(schemaFor('templates.sql')) };
  for (const v of missing) {
    await assert.rejects(() => getConsentPageTemplate(env, v), isFriendly400, `type=${JSON.stringify(v)}`);
  }
  const row = await getConsentPageTemplate(env, 'consent_loaner');
  assert.ok(row && typeof row === 'object');
});

test('getLoanConsents: missing loanId -> friendly 400 (after the staff gate)', async () => {
  const env = {
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_CORE: makeD1(schemaFor('core.sql')),
  };
  for (const v of missing) {
    await assert.rejects(() => getLoanConsents(env, v, STAFF), isFriendly400, `loanId=${JSON.stringify(v)}`);
  }
  // A real loanId with no consents returns an empty list (no crash).
  const rows = await getLoanConsents(env, 'LN1', STAFF);
  assert.ok(Array.isArray(rows));
});

test('getLoanTemplates: missing type -> friendly 400, present type works', async () => {
  const env = { DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')) };
  for (const v of missing) {
    await assert.rejects(() => getLoanTemplates(env, v), isFriendly400, `type=${JSON.stringify(v)}`);
  }
  const rows = await getLoanTemplates(env, 'otp');
  assert.ok(Array.isArray(rows));
});
