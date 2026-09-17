// pdf_convert_batch — now FILLS each record from a SHARED template (+QR) before
// converting (the bulk path moved server-side). The Drive calls are stubbed so no
// network is needed; we assert the batch returns a per-record results[], that one bad
// record does not fail the whole batch, and that the per-record RENDER REPORT
// (missing tags/images) travels back with each result (parity with the browser warning).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';
process.env.DRIVE_OAUTH_CLIENT_ID ||= 'cid';
process.env.DRIVE_OAUTH_CLIENT_SECRET ||= 'csec';
process.env.DRIVE_OAUTH_REFRESH_TOKEN ||= 'rtok';

const { runPdfConvertBatch } = await import('../src/jobs/pdfConvertBatch.js');

const here = dirname(fileURLToPath(import.meta.url));
// The golden-parity fixture template carries the OOXML rels the fill needs. All records
// in a batch share ONE template (same docType+year) — sent once in payload.templateBase64.
const TEMPLATE_B64 = readFileSync(join(here, 'fixtures', 'template.docx')).toString('base64');

test('rejects an empty batch', async () => {
  await assert.rejects(() => runPdfConvertBatch({ templateBase64: TEMPLATE_B64 }), /items is required/);
  await assert.rejects(() => runPdfConvertBatch({ templateBase64: TEMPLATE_B64, items: [] }), /items is required/);
});

test('a batch with no shared template is a whole-job error (nothing can be produced)', async () => {
  await assert.rejects(
    () => runPdfConvertBatch({ items: [{ recordId: 'receipt-2026-1', data: { name: 'x' } }] }),
    /templateBase64 .* is required/
  );
});

test('fills each record from the shared template + isolates a per-record failure', async () => {
  // Stub Drive: OAuth token, then per record upload-convert -> export -> trash. Make the
  // record whose fileName starts with "bad" fail at the export step.
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    }
    if (url.includes('/upload/drive/v3/files')) {
      const body = (opts && opts.body && opts.body.toString) ? opts.body.toString() : '';
      const isBad = /"name":"bad/.test(body);
      return { ok: true, json: async () => ({ id: isBad ? 'BAD' : 'good' }) };
    }
    if (url.includes('/export?mimeType=application/pdf')) {
      if (url.includes('/BAD/')) return { ok: false, status: 500, text: async () => 'export failed' };
      return { ok: true, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer }; // %PDF
    }
    if (opts && opts.method === 'PATCH') return { ok: true }; // trash
    return { ok: true, json: async () => ({}) };
  };
  try {
    const res = await runPdfConvertBatch({
      docType: 'receipt', year: 2026,
      templateBase64: TEMPLATE_B64,
      items: [
        { recordId: 'receipt-2026-1', data: { name: 'Ram Kumar' }, fileName: 'good1.docx' },
        { recordId: 'receipt-2026-2', data: { name: 'Sita Devi' }, fileName: 'bad2.docx' },
        { recordId: 'receipt-2026-3', data: { name: 'Mohan Lal' }, fileName: 'good3.docx' },
      ],
    });
    assert.equal(res.results.length, 3);
    const byId = Object.fromEntries(res.results.map(r => [r.recordId, r]));
    assert.equal(byId['receipt-2026-1'].ok, true);
    assert.ok(byId['receipt-2026-1'].pdfBase64, 'good record has PDF bytes');
    assert.equal(byId['receipt-2026-2'].ok, false, 'bad record isolated as failure');
    assert.equal(byId['receipt-2026-3'].ok, true, 'later good record still processed');
  } finally { globalThis.fetch = orig; }
});

test('the per-record render REPORT travels back with each result (missing tags surfaced)', async () => {
  // The fixture template references {name} and {%photo}. A record that supplies NEITHER
  // has unresolved placeholders — the renderer records them in report.missingTags /
  // report.missingImages, and the job must carry that report back per record so the bulk
  // UI can warn (parity with the browser's getLastRenderReport). Stub Drive to succeed.
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    if (url.includes('/upload/drive/v3/files')) return { ok: true, json: async () => ({ id: 'good' }) };
    if (url.includes('/export?mimeType=application/pdf')) return { ok: true, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer };
    return { ok: true, json: async () => ({}) };
  };
  try {
    const res = await runPdfConvertBatch({
      docType: 'receipt', year: 2026,
      templateBase64: TEMPLATE_B64,
      // No `name`, and an empty photo data-URL -> a missing image recorded by the module.
      items: [{ recordId: 'receipt-2026-9', data: { photo: 'data:image/png;base64,', QR_CODE: 'data:image/png;base64,' }, fileName: 'r9.docx' }],
    });
    const r = res.results[0];
    assert.equal(r.recordId, 'receipt-2026-9');
    assert.ok(r.report && typeof r.report === 'object', 'a report object comes back with the record');
    assert.ok(Array.isArray(r.report.missingTags), 'missingTags is an array');
    assert.ok(Array.isArray(r.report.missingImages), 'missingImages is an array');
    // The empty {%photo} data-URL falls back to the blank PNG and is recorded as missing.
    assert.ok(r.report.missingImages.includes('photo'), `missing image "photo" is surfaced (got ${JSON.stringify(r.report.missingImages)})`);
  } finally { globalThis.fetch = orig; }
});

test('a record missing recordId is recorded as a failure, not thrown', async () => {
  const res = await runPdfConvertBatch({ templateBase64: TEMPLATE_B64, items: [{ data: { name: 'x' } }] });
  assert.equal(res.results[0].ok, false);
  assert.match(res.results[0].error, /missing recordId/);
});
