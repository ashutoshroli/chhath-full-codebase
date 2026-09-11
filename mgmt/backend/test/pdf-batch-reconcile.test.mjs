// ============ Bulk PDF batch — per-record result reconciliation ============
//
// When the Worker offloads a bulk PDF batch to Render, Render returns per-record
// results in ONE callback. applyPdfConvertBatchResult() turns that into a
// base64-STRIPPED { results:[{recordId, success, error?}] } summary.
//
// The bug this guards against: if the processing service DROPS a record from its
// response (returns fewer results than we asked for), that record used to vanish
// silently — the client's Error Log then showed a blank reason. The job row
// stores the requested recordIds (payload.recordIds), so we reconcile against it
// and report any missing record as an explicit failure with a concrete reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { applyPdfConvertBatchResult } from '../src/docxTemplates.js';

// No R2 binding on purpose: the reconciliation + failure paths never touch R2, so
// they must work without it. (A successful store needs R2; that is exercised by
// the higher-level render-jobs flow, not here.)
function makeEnv() {
  return {
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
  };
}

const byId = (results) => Object.fromEntries(results.map((r) => [r.recordId, r]));

test('a record MISSING from the Render response is reported as an explicit failure', async () => {
  const env = makeEnv();
  const payload = { docType: 'receipt', year: 2026, recordIds: ['receipt-2026-1', 'receipt-2026-664'] };
  // Render answered for only ONE of the two requested records.
  const result = { results: [{ recordId: 'receipt-2026-1', ok: false, error: 'drive: rate limited' }] };

  const { results } = await applyPdfConvertBatchResult(env, payload, result);
  const map = byId(results);

  // The requested-but-absent record no longer vanishes.
  assert.ok(map['receipt-2026-664'], 'the missing record must appear in the summary');
  assert.equal(map['receipt-2026-664'].success, false);
  assert.match(map['receipt-2026-664'].error, /missing from processing-service response/);

  // The record Render DID answer for keeps its own, concrete reason.
  assert.equal(map['receipt-2026-1'].success, false);
  assert.equal(map['receipt-2026-1'].error, 'drive: rate limited');
});

test('a per-record failure from Render is propagated verbatim (never blank)', async () => {
  const env = makeEnv();
  const payload = { docType: 'receipt', year: 2026, recordIds: ['receipt-2026-9'] };
  const result = { results: [{ recordId: 'receipt-2026-9', ok: false, error: 'Drive OAuth: invalid_grant' }] };

  const { results } = await applyPdfConvertBatchResult(env, payload, result);
  assert.equal(results.length, 1);
  assert.equal(results[0].success, false);
  assert.equal(results[0].error, 'Drive OAuth: invalid_grant');
});

test('a failed record with no error string still gets a non-empty reason', async () => {
  const env = makeEnv();
  const payload = { docType: 'receipt', year: 2026, recordIds: ['receipt-2026-5'] };
  const result = { results: [{ recordId: 'receipt-2026-5', ok: false }] };

  const { results } = await applyPdfConvertBatchResult(env, payload, result);
  assert.equal(results[0].success, false);
  assert.ok(results[0].error && results[0].error.length > 0, 'error reason must not be blank');
});

test('an ok record with a PDF but no R2 configured fails with a clear reason', async () => {
  const env = makeEnv(); // no R2 binding
  const payload = { docType: 'receipt', year: 2026, recordIds: ['receipt-2026-3'] };
  // A minimal, valid base64 payload (content is irrelevant — R2 is missing so we
  // fail before writing).
  const result = { results: [{ recordId: 'receipt-2026-3', ok: true, pdfBase64: 'JVBERi0=', fileName: 'r.pdf' }] };

  const { results } = await applyPdfConvertBatchResult(env, payload, result);
  assert.equal(results[0].success, false);
  assert.match(results[0].error, /R2 not configured/);
});

test('no requested-but-missing entries are invented when every record came back', async () => {
  const env = makeEnv();
  const payload = { docType: 'receipt', year: 2026, recordIds: ['receipt-2026-1'] };
  const result = { results: [{ recordId: 'receipt-2026-1', ok: false, error: 'x' }] };

  const { results } = await applyPdfConvertBatchResult(env, payload, result);
  assert.equal(results.length, 1, 'exactly one record, no phantom failures');
  assert.equal(results[0].error, 'x');
});
