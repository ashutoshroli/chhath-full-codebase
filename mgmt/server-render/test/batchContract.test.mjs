// ============ THE PDF-BATCH BYTE CONTRACT (Render side) ============
//
// audit Render/offload #1 and #2.
//
// #1 is the one that actually bit: `server.js` parsed every request with
// `express.json({ limit: '1mb' })`, under a comment claiming payloads "carry references +
// small text, never big blobs". True of the AI jobs, false of `pdf_convert_batch`, which
// carries up to twenty base64 `.docx` files. A real bulk run is over 1 MB, so body-parser
// rejected it BEFORE the router — and the Worker read that as "Render unreachable" and
// converted the whole batch itself, which is exactly the CPU and subrequest limit this
// service exists to stay under. One wrong number turned a working offload into a
// Worker-killing fallback, and only on the largest batches.
//
// #2: nothing capped the item count, one item's size, or the RESULT size, and every PDF
// was accumulated and serialised into one callback that the Worker rejects over 10 MB — so
// a batch could succeed here, spend twenty Drive conversions, and be thrown away on
// arrival. And `Buffer.from(x, 'base64')` silently discards non-base64 input, so arbitrary
// bytes were uploaded to Drive as "documents".

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// config.js throws on a missing env var at import time, and the job module reaches it
// through drive.js — same preamble as the other suites here.
process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';
process.env.DRIVE_OAUTH_CLIENT_ID ||= 'cid';
process.env.DRIVE_OAUTH_CLIENT_SECRET ||= 'csec';
process.env.DRIVE_OAUTH_REFRESH_TOKEN ||= 'rtok';

const {
  MAX_BATCH_ITEMS,
  MAX_ITEM_BYTES,
  MAX_INPUT_TOTAL_BYTES,
  MAX_REQUEST_BYTES,
  MAX_OUTPUT_ITEM_BYTES,
  MAX_OUTPUT_TOTAL_BYTES,
  MAX_CHAT_REQUEST_BYTES,
  base64ByteLength,
  isValidBase64,
  looksLikeDocx,
  safeFileName,
  validateBatchItem,
} = await import('../src/lib/batchContract.js');
const { runPdfConvertBatch } = await import('../src/jobs/pdfConvertBatch.js');

/** Valid .docx bytes: the ZIP local-file-header magic plus a body of `size` bytes. */
function docxOf(size) {
  const body = Buffer.alloc(Math.max(0, size - 4), 0x41);
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), body]).toString('base64');
}

// Legacy item shape (a pre-filled .docx) — still used by the `validateBatchItem` tests,
// which pin the retained legacy validator.
const item = (recordId, { size = 64, fileName = 'doc.docx' } = {}) =>
  ({ recordId, base64: docxOf(size), fileName });

// The bulk path now FILLS server-side: a batch carries the TEMPLATE once + per-record
// DATA. This real fixture template carries the OOXML rels the fill needs.
const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_B64 = readFileSync(join(here, 'fixtures', 'template.docx')).toString('base64');
// A fill item: { recordId, data, fileName }. `dataSize` pads the data so aggregate-input
// tests can size a batch precisely (the template is shared, not per-item).
const fillItem = (recordId, { dataSize = 0, fileName = 'doc.docx' } = {}) =>
  ({ recordId, data: { name: 'x', pad: 'A'.repeat(Math.max(0, dataSize)) }, fileName });

describe('the contract numbers hold together', () => {
  test('the request limit is derived from the input budget, not written beside it', () => {
    // The 1 MB parser limit and the batch contract were two independent numbers, which is
    // why they disagreed. This asserts the derivation instead of the value.
    assert.equal(MAX_REQUEST_BYTES, Math.ceil(MAX_INPUT_TOTAL_BYTES * 4 / 3) + 512 * 1024);
    assert.ok(MAX_REQUEST_BYTES > MAX_INPUT_TOTAL_BYTES,
      'base64 adds a third, so the wire limit must exceed the decoded budget');
  });

  test('a full batch at the per-item cap cannot fit the input budget — so both caps matter', () => {
    assert.ok(MAX_BATCH_ITEMS * MAX_ITEM_BYTES > MAX_INPUT_TOTAL_BYTES,
      'the aggregate cap is the one that binds; the per-item cap alone would not bound a batch');
  });

  test('the output budget leaves the callback inside the Worker’s 10 MB body cap', () => {
    const WORKER_BODY_CAP = 10 * 1024 * 1024;
    const asBase64 = Math.ceil(MAX_OUTPUT_TOTAL_BYTES * 4 / 3);
    assert.ok(asBase64 < WORKER_BODY_CAP,
      `${asBase64} bytes of base64 must fit under the Worker's ${WORKER_BODY_CAP}`);
    assert.ok(WORKER_BODY_CAP - asBase64 > 512 * 1024, 'with room for the JSON around it');
    assert.ok(MAX_OUTPUT_ITEM_BYTES <= MAX_OUTPUT_TOTAL_BYTES);
  });

  test('the browser-facing route is capped far tighter than the job intake', () => {
    // It used to share the same 1 MB allowance as everything else. A question is 16 KB.
    assert.equal(MAX_CHAT_REQUEST_BYTES, 16 * 1024);
    assert.ok(MAX_CHAT_REQUEST_BYTES < 1024 * 1024, 'tighter than the old global limit');
    assert.ok(MAX_CHAT_REQUEST_BYTES * 64 < MAX_REQUEST_BYTES);
  });
});

describe('an item is validated before Drive is touched', () => {
  test('base64 that is not base64 is refused', () => {
    // `Buffer.from(x, 'base64')` DISCARDS invalid characters instead of failing, so this
    // used to decode to short garbage and be uploaded to Drive as a document.
    assert.equal(isValidBase64('not base64 at all!!'), false);
    assert.equal(isValidBase64('UEsDBA=='), true);
    const r = validateBatchItem({ recordId: 'r1', base64: '@@@@', fileName: 'a.docx' });
    assert.equal(r.ok, false);
    assert.match(r.error, /base64/);
  });

  test('bytes that are not a ZIP are refused (a .docx is a ZIP)', () => {
    assert.equal(looksLikeDocx(Buffer.from([0x50, 0x4b, 0x03, 0x04])), true);
    assert.equal(looksLikeDocx(Buffer.from([0x25, 0x50, 0x44, 0x46])), false, 'a PDF is not a docx');
    // PK\x05\x06 is an EMPTY archive and PK\x07\x08 a spanned one — neither is a document.
    assert.equal(looksLikeDocx(Buffer.from([0x50, 0x4b, 0x05, 0x06])), false);
    assert.equal(looksLikeDocx(Buffer.from([0x50, 0x4b, 0x07, 0x08])), false);

    const r = validateBatchItem({ recordId: 'r1', base64: Buffer.from('%PDF-1.7').toString('base64'), fileName: 'a.docx' });
    assert.equal(r.ok, false);
    assert.match(r.error, /ZIP signature/);
  });

  test('a file name that could escape its directory is refused', () => {
    // This name reaches Google Drive and comes back on the callback as the stored PDF
    // name, which the Worker turns into an R2 key.
    for (const bad of [
      '../../etc/passwd.docx', 'a/b.docx', 'a\\b.docx', '.docx', '..',
      'no-extension', 'a.pdf', 'x'.repeat(200) + '.docx', '', '   ',
    ]) {
      assert.equal(safeFileName(bad), null, `refused: ${JSON.stringify(bad)}`);
    }
  });

  test('a legitimate name, including Devanagari, is accepted unchanged', () => {
    for (const good of ['receipt-2026-1.docx', 'Amit Kumar (2026).docx', 'रसीद-2026.docx']) {
      assert.equal(safeFileName(good), good);
    }
  });

  test('an item over the per-item cap is refused without decoding it twice', () => {
    const big = { recordId: 'r1', base64: docxOf(MAX_ITEM_BYTES + 1024), fileName: 'a.docx' };
    const r = validateBatchItem(big);
    assert.equal(r.ok, false);
    assert.match(r.error, /too large/);
    assert.ok(base64ByteLength(big.base64) > MAX_ITEM_BYTES);
  });

  test('a valid item comes back with its decoded bytes and safe name', () => {
    const r = validateBatchItem(item('r1', { fileName: 'receipt.docx' }));
    assert.equal(r.ok, true);
    assert.equal(r.fileName, 'receipt.docx');
    assert.equal(r.bytes[0], 0x50);
  });
});

describe('the batch itself is bounded', () => {
  test('more items than the contract allows fails the JOB, not each record', () => {
    // The Worker is supposed to have split it, so this is a caller bug and must be one
    // loud error rather than twenty quiet ones — or worse, the first twenty converted and
    // the rest dropped.
    const items = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => fillItem(`r${i}`));
    return assert.rejects(() => runPdfConvertBatch({ templateBase64: TEMPLATE_B64, items }), /exceeds the contract limit/);
  });

  test('an aggregate over the input budget fails before any Drive work', async () => {
    let fetched = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = async () => { fetched++; return { ok: true, json: async () => ({}) }; };
    try {
      // The input is the template ONCE + each record's data. Pad each record's data so the
      // sum clears the input budget without any one item breaching the per-item cap.
      const per = Math.ceil(MAX_INPUT_TOTAL_BYTES / 4);
      const items = Array.from({ length: 5 }, (_, i) => fillItem(`r${i}`, { dataSize: per }));
      await assert.rejects(() => runPdfConvertBatch({ templateBase64: TEMPLATE_B64, items }), /over the .* contract limit/);
      assert.equal(fetched, 0, 'not one Drive call was made');
    } finally { globalThis.fetch = orig; }
  });

  test('an empty batch is still rejected', async () => {
    await assert.rejects(() => runPdfConvertBatch({ templateBase64: TEMPLATE_B64 }), /items is required/);
    await assert.rejects(() => runPdfConvertBatch({ templateBase64: TEMPLATE_B64, items: [] }), /items is required/);
  });
});

describe('the result is bounded so the callback can be delivered', () => {
  /** Drive stub returning a PDF of `pdfSize` bytes for every record. */
  function stubDrive(pdfSize) {
    const orig = globalThis.fetch;
    let conversions = 0;
    globalThis.fetch = async (url, opts) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
      }
      if (url.includes('/upload/drive/v3/files')) {
        conversions++;
        return { ok: true, json: async () => ({ id: 'doc' }) };
      }
      if (url.includes('/export?mimeType=application/pdf')) {
        const buf = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(Math.max(0, pdfSize - 4), 0x41)]);
        return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
      }
      if (opts && opts.method === 'PATCH') return { ok: true };
      return { ok: true, json: async () => ({}) };
    };
    return { restore: () => { globalThis.fetch = orig; }, conversions: () => conversions };
  }

  test('one outsized PDF is dropped instead of sinking the whole callback', async () => {
    const drive = stubDrive(MAX_OUTPUT_ITEM_BYTES + 4096);
    try {
      const res = await runPdfConvertBatch({ templateBase64: TEMPLATE_B64, items: [fillItem('r1')] });
      assert.equal(res.results[0].ok, false);
      assert.match(res.results[0].error, /PDF is too large/);
      assert.equal(res.results[0].pdfBase64, undefined, 'and its bytes are not accumulated');
    } finally { drive.restore(); }
  });

  test('conversion STOPS once the output budget is spent', async () => {
    // Each PDF is a quarter of the total budget, so five records cannot all fit. Before,
    // all five were converted and accumulated, and the resulting callback was over the
    // Worker's cap — so every record in the batch was lost, including the ones that worked.
    const per = Math.ceil(MAX_OUTPUT_TOTAL_BYTES / 4);
    const drive = stubDrive(per);
    try {
      const items = Array.from({ length: 6 }, (_, i) => fillItem(`r${i}`));
      const res = await runPdfConvertBatch({ templateBase64: TEMPLATE_B64, items });

      const ok = res.results.filter((r) => r.ok);
      const refused = res.results.filter((r) => !r.ok);
      assert.equal(res.results.length, 6, 'every record still gets a verdict');
      assert.ok(ok.length >= 3 && ok.length <= 4, `converted what fits, got ${ok.length}`);
      assert.ok(refused.length >= 2);
      assert.equal(res.truncated, true, 'and the batch says so');
      for (const r of refused) assert.match(r.error, /budget/);

      // The point of stopping: Drive quota is not spent producing undeliverable bytes.
      assert.ok(drive.conversions() <= ok.length + 1,
        `stopped converting after the budget (${drive.conversions()} conversions for ${ok.length} kept)`);

      const total = res.results.reduce((n, r) => n + base64ByteLength(r.pdfBase64 || ''), 0);
      assert.ok(total <= MAX_OUTPUT_TOTAL_BYTES, `accumulated ${total} within ${MAX_OUTPUT_TOTAL_BYTES}`);
      assert.equal(res.budget.outputLimitBytes, MAX_OUTPUT_TOTAL_BYTES);
    } finally { drive.restore(); }
  });

  test('a batch that fits reports no truncation and carries its budget', async () => {
    const drive = stubDrive(1024);
    try {
      const res = await runPdfConvertBatch({ templateBase64: TEMPLATE_B64, items: [fillItem('r1'), fillItem('r2')] });
      assert.equal(res.results.every((r) => r.ok), true);
      assert.equal(res.truncated, undefined);
      assert.ok(res.budget.outputBytes > 0);
      assert.ok(res.budget.outputBytes < MAX_OUTPUT_TOTAL_BYTES);
    } finally { drive.restore(); }
  });

  test('an invalid item costs no fill or Drive round-trip at all', async () => {
    const drive = stubDrive(1024);
    try {
      const res = await runPdfConvertBatch({
        templateBase64: TEMPLATE_B64,
        items: [
          { data: { name: 'x' }, fileName: 'a.docx' },              // no recordId
          { recordId: 'bad-name', data: { name: 'x' }, fileName: '../x.docx' }, // path traversal
          { recordId: 'huge', data: { pad: 'A'.repeat(MAX_ITEM_BYTES + 4096) }, fileName: 'a.docx' }, // over data cap
          fillItem('good'),
        ],
      });
      assert.equal(res.results.filter((r) => r.ok).length, 1);
      // One conversion, for the one valid record. Each bad item is refused BEFORE the
      // template is filled or Drive is touched.
      assert.equal(drive.conversions(), 1);
    } finally { drive.restore(); }
  });
});
