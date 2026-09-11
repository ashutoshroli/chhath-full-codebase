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


// ============ handleRenderCallback must NEVER leak the raw Render shape ============
//
// The batch bug: Render returns per-record { ok, pdfBase64 } (no `error` on
// success); the frontend reads { success, error }. If the raw shape were persisted
// as the completed result, the client would read success:undefined + no error — a
// record failing with a BLANK reason — and the fat pdfBase64 could blow D1's row
// limit. These tests drive the real handleRenderCallback + getRenderJobStatus.

import { makeD1 as _makeD1, makeKV, schemaFor as _schemaFor } from './helpers/stubs.mjs';
import { createAndDispatchJob, handleRenderCallback, getRenderJobStatus } from '../src/renderJobs.js';

const SUPERADMIN2 = { name: 'USER0001', role: 'Superadmin' };

function stubFetchOk() {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 202, json: async () => ({ renderJobId: 'r1' }) });
  return () => { globalThis.fetch = orig; };
}

function callbackEnv() {
  return {
    DB_MISC: _makeD1(_schemaFor('misc.sql')),
    DB_FILE_INDEX: _makeD1(_schemaFor('file_index.sql')),
    DB_LOGS: _makeD1(_schemaFor('logs.sql')),
    KV_SESSIONS: makeKV(),
    RENDER_SERVICE_URL: 'https://render.example.test',
    RENDER_API_KEY: 'k',
    RENDER_WEBHOOK_SECRET: 's',
    // No R2 binding on purpose: a Render-successful record cannot be stored, so it
    // must surface as a per-record failure with a CONCRETE reason (not the raw shape).
  };
}

test('a completed batch callback stores the TRANSLATED shape (success/error), never raw ok+base64', async () => {
  const env = callbackEnv();
  const restore = stubFetchOk();
  let jobId;
  try {
    const res = await createAndDispatchJob(
      env, 'pdf_convert_batch',
      { docType: 'receipt', year: 2025, items: [{ recordId: 'receipt-2025-8', base64: 'x', fileName: 'r.docx' }] },
      { refId: 'receipt-2025', storePayload: { docType: 'receipt', year: 2025, recordIds: ['receipt-2025-8'], count: 1 } }
    );
    jobId = res.jobId;
  } finally { restore(); }

  // Render succeeded for the record and returned the raw shape with base64.
  await handleRenderCallback(env, {
    jobId, status: 'completed',
    result: { results: [{ recordId: 'receipt-2025-8', ok: true, pdfBase64: 'JVBERi0=', fileName: 'r.pdf' }] },
  });

  const st = await getRenderJobStatus(env, jobId, SUPERADMIN2);
  assert.equal(st.job.status, 'completed');
  const rec = st.job.result.results[0];
  // TRANSLATED shape only — never the raw `ok`, never base64.
  assert.equal(rec.recordId, 'receipt-2025-8');
  assert.equal('ok' in rec, false, 'raw `ok` flag must not leak to the stored result');
  assert.equal('pdfBase64' in rec, false, 'base64 must never be persisted on the job row');
  // R2 was absent, so this record is a concrete, NON-EMPTY failure — not a blank one.
  assert.equal(rec.success, false);
  assert.ok(rec.error && rec.error.length > 0);
  assert.match(rec.error, /R2 not configured/);
});
