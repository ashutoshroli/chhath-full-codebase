// pdf_convert_batch — validation + per-record failure isolation. The Drive calls
// are stubbed so no network is needed; we assert the batch returns a per-record
// results[] and that one bad record does not fail the whole batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

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

test('rejects an empty batch', async () => {
  await assert.rejects(() => runPdfConvertBatch({}), /items is required/);
  await assert.rejects(() => runPdfConvertBatch({ items: [] }), /items is required/);
});

test('converts a batch and isolates a per-record failure', async () => {
  // Stub Drive: OAuth token, then per record: upload-convert -> export -> trash.
  // Make the record whose fileName starts with "bad" fail at the export step.
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    }
    if (url.includes('/upload/drive/v3/files')) {
      // Encode which record this is via the multipart body's name.
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
      items: [
        { recordId: 'receipt-2026-1', base64: 'UEsDBok', fileName: 'good1.docx' },
        { recordId: 'receipt-2026-2', base64: 'UEsDBok', fileName: 'bad2.docx' },
        { recordId: 'receipt-2026-3', base64: 'UEsDBok', fileName: 'good3.docx' },
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

test('a record missing base64 is recorded as a failure, not thrown', async () => {
  const res = await runPdfConvertBatch({ items: [{ recordId: 'x' }] });
  assert.equal(res.results[0].ok, false);
  assert.match(res.results[0].error, /missing/);
});
