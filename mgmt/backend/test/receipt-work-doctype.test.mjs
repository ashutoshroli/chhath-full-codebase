// ============ receipt_work: a separate doc type for Service (Work) receipts ============
//
// A Service (Work) contribution where "Receipt" is chosen used to reuse the plain
// `receipt` template. It now has its own doc type, `receipt_work`. The critical
// invariant: getRecordsForDocType must SPLIT the collection rows cleanly so the
// SAME row is never generated under both `receipt` and `receipt_work`:
//   receipt       — Contribution Type 1 (Cash), non-certificate
//   receipt_work  — Contribution Type 3 (Service/Work), non-certificate
//   certificate   — the "Certificate" choice
//   samaan        — Contribution Type 2 (Material)
//
// Run: node --test mgmt/backend/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { getRecordsForDocType, DOC_TYPES } from '../src/docxTemplates.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };

function makeEnv() {
  return {
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
  };
}

// Seed one collection row of each relevant kind, all in 2026.
async function seed(env) {
  await env.DB_CORE.prepare('INSERT INTO users (id_code, name) VALUES (?,?)').bind('USER0001', 'Ram').run();
  const rows = [
    // year, sl_no, name, contribution_type, certificate_or_receipt
    [2026, 1, 'USER0001', 1, ''],            // Cash receipt        -> receipt
    [2026, 2, 'USER0001', 3, 'Receipt'],     // Work receipt        -> receipt_work
    [2026, 3, 'USER0001', 3, 'Certificate'], // Work certificate    -> certificate
    [2026, 4, 'USER0001', 2, ''],            // Material            -> samaan
  ];
  for (const [year, sl, name, ct, cor] of rows) {
    await env.DB_COLLECTIONS.prepare(
      'INSERT INTO collections (year, sl_no, name, amount, contribution_type, certificate_or_receipt) VALUES (?,?,?,?,?,?)'
    ).bind(year, sl, name, 100, ct, cor).run();
  }
}

test('receipt_work is a registered doc type', () => {
  assert.ok(DOC_TYPES.includes('receipt_work'), 'DOC_TYPES must include receipt_work');
  assert.ok(DOC_TYPES.includes('receipt'), 'and still receipt');
});

test('receipt returns ONLY the Cash (Type 1) row, not the work receipt', async () => {
  const env = makeEnv();
  await seed(env);
  const recs = await getRecordsForDocType(env, 'receipt', 2026, SUPERADMIN);
  assert.equal(recs.length, 1, 'exactly the one cash receipt');
  assert.match(recs[0].recordId, /^receipt-2026-/, 'a receipt recordId');
});

test('receipt_work returns ONLY the Service(Work)+Receipt row', async () => {
  const env = makeEnv();
  await seed(env);
  const recs = await getRecordsForDocType(env, 'receipt_work', 2026, SUPERADMIN);
  assert.equal(recs.length, 1, 'exactly the one work receipt');
  assert.match(recs[0].recordId, /^receipt_work-2026-/, 'a receipt_work recordId');
  // Same placeholder shape as a receipt.
  assert.ok(recs[0].placeholders.RECEIPT_NO, 'has RECEIPT_NO');
});

test('the SAME row is never in both receipt and receipt_work (no double generation)', async () => {
  const env = makeEnv();
  await seed(env);
  const receipt = await getRecordsForDocType(env, 'receipt', 2026, SUPERADMIN);
  const work = await getRecordsForDocType(env, 'receipt_work', 2026, SUPERADMIN);
  // Compare the row suffix (<year>-<rowIndex>) across the two sets — must be disjoint.
  const suffix = (id) => id.split('-').slice(-2).join('-');
  const receiptRows = new Set(receipt.map(r => suffix(r.recordId)));
  const workRows = work.map(r => suffix(r.recordId));
  for (const w of workRows) {
    assert.ok(!receiptRows.has(w), `row ${w} must not appear under BOTH receipt and receipt_work`);
  }
});

test('certificate and samaan are unaffected by the split', async () => {
  const env = makeEnv();
  await seed(env);
  const cert = await getRecordsForDocType(env, 'certificate', 2026, SUPERADMIN);
  const samaan = await getRecordsForDocType(env, 'samaan', 2026, SUPERADMIN);
  assert.equal(cert.length, 1, 'the one certificate row');
  assert.match(cert[0].recordId, /^certificate-2026-/, '');
  assert.equal(samaan.length, 1, 'the one material row');
  assert.match(samaan[0].recordId, /^samaan-2026-/, '');
});
