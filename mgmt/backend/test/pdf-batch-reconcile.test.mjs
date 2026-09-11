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


// ============ Read-boundary guard: a STALE raw-shaped row never shows blank ============
//
// A completed pdf_convert_batch row written by an OLDER build could hold the RAW
// Render shape (per-record `ok`, base64, no `success`, and possibly no `error`).
// getRenderJobStatus must normalize it so the client never sees a success:false
// record with an empty reason (the 'receipt-2025-34' symptom).

test('getRenderJobStatus normalizes a STALE raw-shaped batch row (no blank errors, no base64)', async () => {
  const env = callbackEnv();
  const restore = stubFetchOk();
  let jobId;
  try {
    const res = await createAndDispatchJob(
      env, 'pdf_convert_batch',
      { docType: 'receipt', year: 2025, items: [{ recordId: 'receipt-2025-34', base64: 'x', fileName: 'r.docx' }] },
      { refId: 'receipt-2025', storePayload: { docType: 'receipt', year: 2025, recordIds: ['receipt-2025-34'], count: 1 } }
    );
    jobId = res.jobId;
  } finally { restore(); }

  // Simulate a LEGACY completed row: raw Render shape stored directly (this is
  // what the pre-fix bug persisted). One failed record WITHOUT an error field, one
  // successful record still carrying base64.
  const rawStored = JSON.stringify({ results: [
    { recordId: 'receipt-2025-34', ok: false },                          // no error!
    { recordId: 'receipt-2025-35', ok: true, pdfBase64: 'JVBERi0=', fileName: 'r.pdf' },
  ] });
  await env.DB_MISC.prepare("UPDATE render_jobs SET status='completed', result=? WHERE job_id=?")
    .bind(rawStored, jobId).run();

  const st = await getRenderJobStatus(env, jobId, SUPERADMIN2);
  const map = Object.fromEntries(st.job.result.results.map((r) => [r.recordId, r]));

  // Failed record: normalized to success:false WITH a non-empty reason.
  assert.equal(map['receipt-2025-34'].success, false);
  assert.ok(map['receipt-2025-34'].error && map['receipt-2025-34'].error.length > 0);
  assert.equal('ok' in map['receipt-2025-34'], false);

  // Successful record: normalized to success:true, base64 stripped.
  assert.equal(map['receipt-2025-35'].success, true);
  assert.equal('pdfBase64' in map['receipt-2025-35'], false);
  assert.equal('ok' in map['receipt-2025-35'], false);
});


// ============ ROOT CAUSE: an already-generated (skipped) record is a SUCCESS ============
//
// THE BUG: dispatchBulkPdfBatch pushed already-generated records into `skipped` as
// { recordId, skipped:true, publicLink, fileName } with NO `success` field. Every
// SYNCHRONOUS path returns that array VERBATIM as `results` (nothing to dispatch /
// no Render configured / dispatch failed), and the client reads `r.success`
// directly on that path (only the ASYNC `preSkipped` path re-maps it). So an
// already-generated record was read as success:false with NO error string —
// surfacing as "conversion failed (server returned no error detail)" for a record
// that was perfectly fine and was NEVER even sent to Render (hence no Render logs).
// Bulk runs over an OLD year, where most PDFs already exist, hit this constantly.

import { dispatchBulkPdfBatch } from '../src/docxTemplates.js';

const DOCX_B64_OK = 'UEsDBBQAAAAIAA' + 'A'.repeat(18);

function bulkEnv() {
  const fileIndex = _makeD1(_schemaFor('file_index.sql'));
  const core = _makeD1(_schemaFor('core.sql'));
  return {
    env: {
      DB_CORE: core,
      DB_MISC: _makeD1(_schemaFor('misc.sql')),
      DB_FILE_INDEX: fileIndex,
      DB_LOGS: _makeD1(_schemaFor('logs.sql')),
      DRIVE_ROOT_FOLDER_ID: 'folder-root',
      // No RENDER_SERVICE_URL / RENDER_API_KEY -> the synchronous path, which is
      // exactly where the raw `skipped` array is returned as `results`.
    },
    markGenerated: (docType, year, recordId) =>
      fileIndex.prepare(
        'INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link, drive_path, generated_at) VALUES (?,?,?,?,?,?,?)'
      ).bind(docType, year, recordId, `${recordId}.pdf`, `https://cdn.test/${recordId}.pdf`, `k/${recordId}.pdf`, '2025-01-01').run(),
  };
}

test('ROOT CAUSE: an already-generated record is returned as success:true (never a blank failure)', async () => {
  const { env, markGenerated } = bulkEnv();
  markGenerated('receipt', 2025, 'receipt-2025-57');

  // Every record in the batch is already generated -> toConvert is empty -> the
  // function returns `results: skipped` VERBATIM on the synchronous path.
  const res = await dispatchBulkPdfBatch(env, 'receipt', 2025, [
    { recordId: 'receipt-2025-57', base64: DOCX_B64_OK, fileName: 'r.docx' },
  ], SUPERADMIN2, {});

  assert.equal(res.dispatched, false, 'nothing to dispatch');
  const rec = res.results[0];
  assert.equal(rec.recordId, 'receipt-2025-57');
  // THE REGRESSION GUARD: the client reads r.success on this path.
  assert.equal(rec.success, true, 'an already-generated record MUST be success:true');
  assert.equal(rec.skipped, true, 'and it must still be reported as skipped');
  assert.ok(rec.publicLink, 'the existing link is handed back');
  // It must NOT look like a failure: no error string at all.
  assert.ok(!rec.error, 'a skipped record must carry no error');
});

test('a MIXED batch marks the generated record skipped:true and still reports the rest', async () => {
  const { env, markGenerated } = bulkEnv();
  markGenerated('receipt', 2025, 'receipt-2025-57');

  const res = await dispatchBulkPdfBatch(env, 'receipt', 2025, [
    { recordId: 'receipt-2025-57', base64: DOCX_B64_OK, fileName: 'a.docx' }, // already generated
    { recordId: 'receipt-2025-58', base64: DOCX_B64_OK, fileName: 'b.docx' }, // needs conversion
  ], SUPERADMIN2, {});

  const map = Object.fromEntries(res.results.map((r) => [r.recordId, r]));
  // The skipped one is an unambiguous success.
  assert.equal(map['receipt-2025-57'].success, true);
  assert.equal(map['receipt-2025-57'].skipped, true);
  // The other one was attempted synchronously (Drive is not reachable in the test,
  // so it fails) — and when it fails it carries a CONCRETE, non-empty reason.
  assert.equal(map['receipt-2025-58'].success, false);
  assert.ok(map['receipt-2025-58'].error && map['receipt-2025-58'].error.length > 0);
});

test('force:true re-converts instead of skipping (no skipped entries)', async () => {
  const { env, markGenerated } = bulkEnv();
  markGenerated('receipt', 2025, 'receipt-2025-57');

  const res = await dispatchBulkPdfBatch(env, 'receipt', 2025, [
    { recordId: 'receipt-2025-57', base64: DOCX_B64_OK, fileName: 'a.docx' },
  ], SUPERADMIN2, { force: true });

  const rec = res.results[0];
  assert.notEqual(rec.skipped, true, 'force must bypass the already-generated skip');
  // It was actually attempted (and fails on the unreachable Drive) with a real reason.
  assert.equal(rec.success, false);
  assert.ok(rec.error && rec.error.length > 0);
});
