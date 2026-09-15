// ====== AUDIT P0-03 — a queued job must describe a COMMITTED collection row ======
//
// enqueueCollectionJob checked the staff role, the year lock/access (against the
// year the CLIENT claimed) and a doc-type/record-id PREFIX. It never loaded the
// collection row the job claimed to be about. Everything the queue later acts on
// — record id, year, and the whole payload that drives the PDF, the WhatsApp
// message and the email — came from the request.
//
// So a staff account with 'add' on one year could enqueue an invented
// `receipt-<year>-<anything>` with a payload naming any contributor and any
// amount, and the cron would generate that document and announce it as a system
// caller, with no committed financial row behind it.
//
// Now: `rowIndex` is mandatory, the row is loaded, the year comes from the row
// (its lock/access are enforced), the record id is DERIVED, and the notification
// payload is rebuilt from the stored row. A live job per (row, document) is also
// deduplicated, so a double-click cannot produce two PDFs and two messages.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { enqueueCollectionJob } from '../src/collectionQueue.js';

const SUBADMIN = { name: 'USER0003', role: 'Subadmin' };
const DOCX_B64 = 'UEsDBBQAAAAIAA' + 'A'.repeat(18);

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const collections = makeD1(schemaFor('collections.sql'));
  core.prepare('INSERT INTO committee_members (year, name, view_role) VALUES (?,?,?)')
    .bind(2026, 'USER0003', 'Member').run();
  core.prepare('INSERT INTO committee_members (year, name, view_role) VALUES (?,?,?)')
    .bind(2025, 'USER0003', 'Member').run();
  // The committed entry: ₹100 from USER0009 in 2026, id 5.
  collections.prepare(
    'INSERT INTO collections (id, year, sl_no, name, amount, payment_mode, contribution_type, certificate_or_receipt, created_by, is_resell) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(5, 2026, 5, 'USER0009', 100, 'Cash', 1, 'Receipt', 'USER0003', 'FALSE').run();
  return {
    DB_CORE: core,
    DB_COLLECTIONS: collections,
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
  };
}

const jobs = async (env) => (await env.DB_MISC
  .prepare('SELECT job_id, doc_type, year, row_index, record_id, payload, status FROM collection_jobs ORDER BY id').all()).results;

const good = (over = {}) => ({
  docType: 'receipt', rowIndex: 5, recordId: 'receipt-2026-5', isNewEntry: true,
  payload: { Year: 2026, Name: 'USER0009', Amount: 100 },
  filledBase64: DOCX_B64, fileName: 'receipt.docx', ...over,
});

// ======================================= 1. THE JOB MUST POINT AT A REAL ROW

test('P0-03: a job for a collection row that does not exist is refused', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => enqueueCollectionJob(env, good({ rowIndex: 999, recordId: 'receipt-2026-999' }), SUBADMIN),
    /no longer exists/
  );
  assert.equal((await jobs(env)).length, 0, 'nothing was queued');
});

test('P0-03: a job with no row reference at all is refused', async () => {
  const env = makeEnv();
  for (const rowIndex of [undefined, '', 0, -1, 'abc']) {
    await assert.rejects(
      () => enqueueCollectionJob(env, good({ rowIndex, recordId: '' }), SUBADMIN),
      /does not reference a saved collection entry/,
      `rowIndex=${JSON.stringify(rowIndex)} must be refused`
    );
  }
  assert.equal((await jobs(env)).length, 0);
});

// ======================================= 2. IDENTITY COMES FROM THE STORED ROW

test('P0-03: the record id is derived from the row, and a crafted one is refused', async () => {
  const env = makeEnv();

  // The exploit shape: a real row id, but a record id naming a different record.
  await assert.rejects(
    () => enqueueCollectionJob(env, good({ recordId: 'receipt-2026-CN-victim' }), SUBADMIN),
    /does not match the saved entry/
  );
  // Even the right shape for the WRONG row is refused.
  await assert.rejects(
    () => enqueueCollectionJob(env, good({ recordId: 'receipt-2026-6' }), SUBADMIN),
    /does not match the saved entry/
  );

  // A client that sends no record id at all gets the server's.
  const res = await enqueueCollectionJob(env, good({ recordId: '' }), SUBADMIN);
  assert.equal(res.success, true);
  const [row] = await jobs(env);
  assert.equal(row.record_id, 'receipt-2026-5', 'derived from docType + stored year + row id');
});

test('P0-03: the year is taken from the row, not from the request', async () => {
  const env = makeEnv();
  // A request claiming 2025 for a row stored in 2026 is refused outright.
  await assert.rejects(
    () => enqueueCollectionJob(env, good({ year: 2025, recordId: 'receipt-2025-5' }), SUBADMIN),
    /refers to a different year/
  );

  const res = await enqueueCollectionJob(env, good({ year: undefined }), SUBADMIN);
  assert.equal(res.success, true);
  const [row] = await jobs(env);
  assert.equal(row.year, '2026', 'the stored year is what the job carries');
});

test('P0-03: a locked year is enforced from the STORED row even if the request omits the year', async () => {
  const env = makeEnv();
  env.DB_CORE.prepare('INSERT INTO locked_years (year, lockedby, lockedat) VALUES (?,?,?)')
    .bind(2026, 'USER0001', '2026-01-01').run();

  await assert.rejects(
    () => enqueueCollectionJob(env, good({ year: undefined, recordId: '' }), SUBADMIN),
    /year is locked/
  );
});

test('P0-03: the notification payload is rebuilt from the committed row', async () => {
  const env = makeEnv();

  // The exploit payload: a different contributor and a much larger amount.
  const res = await enqueueCollectionJob(env, good({
    payload: { Year: 2026, Name: 'USER0001', Amount: 999999, 'Is Resell': 'TRUE', Detail: 'invented' },
  }), SUBADMIN);
  assert.equal(res.success, true);

  const [row] = await jobs(env);
  const payload = JSON.parse(row.payload);
  // On `main` these are USER0001 / 999999 / TRUE — announced by WhatsApp + email.
  assert.equal(payload.Name, 'USER0009', 'the committed contributor');
  assert.equal(payload.Amount, 100, 'the committed amount');
  assert.equal(payload['Is Resell'], 'FALSE');
  assert.equal(payload['Payment Mode'], 'Cash');
  assert.equal(payload.Year, 2026);
  assert.equal(payload.Detail, '', 'no invented detail survives');
  assert.equal(payload.__rowIndex, undefined, 'the internal row id is not part of the payload');
});

// =================================================== 3. DOUBLE-SUBMIT DEDUPE

test('P0-03: a second job for the same row and document is deduplicated', async () => {
  const env = makeEnv();
  const first = await enqueueCollectionJob(env, good(), SUBADMIN);
  const second = await enqueueCollectionJob(env, good(), SUBADMIN);

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.deduped, true, 'the caller is told it was already queued');
  assert.equal(second.jobId, first.jobId, 'and gets the live job id');
  assert.equal((await jobs(env)).length, 1, 'one PDF, one WhatsApp message, one email');
});

test('P0-03: a different document for the same row is still allowed', async () => {
  const env = makeEnv();
  await enqueueCollectionJob(env, good({ docType: 'receipt', recordId: 'receipt-2026-5' }), SUBADMIN);
  const res = await enqueueCollectionJob(env, good({ docType: 'certificate', recordId: 'certificate-2026-5' }), SUBADMIN);

  assert.equal(res.deduped, undefined);
  assert.deepEqual((await jobs(env)).map(j => j.doc_type), ['receipt', 'certificate']);
});

test('P0-03: once a job is done, the same document can be queued again', async () => {
  const env = makeEnv();
  const first = await enqueueCollectionJob(env, good(), SUBADMIN);
  await env.DB_MISC.prepare("UPDATE collection_jobs SET status = 'done' WHERE job_id = ?").bind(first.jobId).run();

  const again = await enqueueCollectionJob(env, good(), SUBADMIN);
  assert.equal(again.deduped, undefined, 'a finished job does not block a legitimate re-run');
  assert.equal((await jobs(env)).length, 2);
});

// =============================================== 4. THE RESELL / NO-DOC PATH

test('P0-03: a resell entry (no document) still enqueues from its stored row', async () => {
  const env = makeEnv();
  env.DB_COLLECTIONS.prepare(
    'INSERT INTO collections (id, year, sl_no, name, amount, contribution_type, is_resell, detail) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(9, 2026, 9, '', 250, 1, 'TRUE', 'Old utensils').run();

  const res = await enqueueCollectionJob(env, {
    docType: '', rowIndex: 9, recordId: '', isNewEntry: true, filledBase64: '', fileName: '',
  }, SUBADMIN);

  assert.equal(res.success, true);
  const row = (await jobs(env)).find(j => j.row_index === 9);
  assert.equal(row.doc_type, '');
  assert.equal(row.record_id, null, 'no document, so no record id');
  const payload = JSON.parse(row.payload);
  assert.equal(payload['Is Resell'], 'TRUE');
  assert.equal(payload.Detail, 'Old utensils');
  assert.equal(payload.Amount, 250);
});

test('P0-03: DB_COLLECTIONS missing is an internal error, not a silent enqueue', async () => {
  const env = makeEnv();
  delete env.DB_COLLECTIONS;
  await assert.rejects(
    () => enqueueCollectionJob(env, good(), SUBADMIN),
    /DB_COLLECTIONS binding not configured/
  );
});
