// ============ THE PDF-BATCH BYTE CONTRACT (Worker side) ============
//
// audit Render/offload #1. `pdf_convert_batch` carries up to twenty base64 `.docx` files
// to the Render service, which parsed every request with `express.json({ limit: '1mb' })`.
// A real bulk run is over 1 MB once base64 has added its third, so body-parser rejected it
// BEFORE the router ran, `createAndDispatchJob` reported failure, and the Worker's
// `!dispatch.success` branch converted the ENTIRE batch itself — which is precisely the CPU
// and subrequest limit the offload exists to stay under.
//
// The failure was also shaped to hide itself: small batches worked, so the endpoint looked
// healthy, and only the large runs fell back into the path most likely to take the Worker
// down.
//
// The dispatch now splits by the same limits Render enforces on arrival, so the dispatch
// can never be the thing that breaks the contract.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_BATCH_ITEMS,
  MAX_ITEM_BYTES,
  MAX_INPUT_TOTAL_BYTES,
  MAX_REQUEST_BYTES,
  MAX_OUTPUT_ITEM_BYTES,
  MAX_OUTPUT_TOTAL_BYTES,
  MAX_CHAT_REQUEST_BYTES,
  planBatches,
} from '../src/renderContract.js';
import { base64ByteLength } from '../src/base64.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** base64 of `size` bytes, so a fixture can be sized precisely. */
const b64OfBytes = (size) => Buffer.alloc(size, 0x41).toString('base64');
const sizeOf = (b64) => base64ByteLength(b64);
const item = (recordId, bytes) => ({ recordId, base64: b64OfBytes(bytes), fileName: `${recordId}.docx` });

describe('the two copies of the contract cannot drift', () => {
  test('the contract block is byte-identical in the Worker and in Render', () => {
    // The two deployments share no code by design — the Render service has its own
    // package.json and node_modules — so the constants are duplicated, exactly as the
    // public Worker duplicates the mgmt column maps. What makes duplication safe is this
    // test: the block between the two markers must match, character for character.
    const MARK_START = '// ---- 8< ---- CONTRACT (kept byte-identical in both copies) ---- 8< ----';
    const MARK_END = '// ---- 8< ---- END CONTRACT ---- 8< ----';

    const extract = (src, label) => {
      const from = src.indexOf(MARK_START);
      const to = src.indexOf(MARK_END);
      assert.ok(from !== -1, `${label}: contract start marker is missing`);
      assert.ok(to > from, `${label}: contract end marker is missing`);
      return src.slice(from + MARK_START.length, to).trim();
    };

    const worker = extract(read('../src/renderContract.js'), 'mgmt/backend');
    const render = extract(read('../../server-render/src/lib/batchContract.js'), 'server-render');
    assert.equal(worker, render,
      'the byte contract has drifted between the Worker and the Render service');
    assert.ok(worker.includes('MAX_BATCH_ITEMS'), 'sanity: the block really is the contract');
  });

  test('the Express limits are derived from the contract, not hard-coded', () => {
    // Comments are stripped first: the fix DESCRIBES the old `limit: '1mb'` in a comment,
    // and a test that cannot tell code from prose would be satisfied by deleting the
    // explanation. Same approach as the other source-reading assertions in this suite.
    const server = read('../../server-render/src/server.js')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // The 1 MB literal is the defect. Its absence from the CODE is the fix.
    assert.ok(!/limit:\s*'\d+\s*(mb|kb|b)?'/i.test(server), 'no literal body-size limit remains');
    assert.match(server, /express\.json\(\{ limit: MAX_REQUEST_BYTES \}\)/, 'the job intake limit comes from the contract');
    assert.match(server, /express\.json\(\{ limit: MAX_CHAT_REQUEST_BYTES \}\)/, 'and so does the chat limit');
    // And each parser is SCOPED TO ITS OWN PATH, not run on every request. The earlier
    // spelling mounted both parsers at '/', so the tight chat parser also parsed POST
    // /jobs and rejected a large docx_render body with a 413 before jobsRouter's larger
    // limit applied. The chat parser must be gated to /public-chat and the jobs parser to
    // /jobs, which is what actually lets the browser route be capped tighter than intake.
    assert.match(server, /onPath\('\/public-chat', chatBodyParser\)/, 'chat parser is scoped to /public-chat');
    assert.match(server, /onPath\('\/jobs', jobsBodyParser\)/, 'jobs parser is scoped to /jobs');
    assert.match(server, /publicChatRouter/);
    assert.match(server, /jobsRouter/);
  });

  test('the numbers are ordered sanely and fit the Worker’s own body cap', () => {
    // MAX_GENERAL_BODY in src/index.js. The callback carries every PDF in one body.
    const WORKER_BODY_CAP = 10 * 1024 * 1024;
    assert.ok(Math.ceil(MAX_OUTPUT_TOTAL_BYTES * 4 / 3) < WORKER_BODY_CAP,
      'a full batch of PDFs, base64-expanded, must fit in one callback');
    assert.ok(MAX_ITEM_BYTES < MAX_INPUT_TOTAL_BYTES);
    assert.ok(MAX_OUTPUT_ITEM_BYTES <= MAX_OUTPUT_TOTAL_BYTES);
    assert.ok(MAX_REQUEST_BYTES > MAX_INPUT_TOTAL_BYTES, 'base64 adds a third');
    assert.ok(MAX_CHAT_REQUEST_BYTES < MAX_REQUEST_BYTES);
    // The Worker's index.js cap is the ceiling this whole contract lives under; assert the
    // value we reasoned about is still what the router uses.
    assert.match(read('../src/index.js'), /MAX_GENERAL_BODY = 10 \* 1024 \* 1024/);
  });
});

describe('a dispatch is split so it always fits', () => {
  test('a batch is never longer than the item limit', () => {
    const items = Array.from({ length: MAX_BATCH_ITEMS * 2 + 3 }, (_, i) => item(`r${i}`, 1024));
    const { batches, rejected } = planBatches(items, sizeOf);
    assert.equal(rejected.length, 0);
    assert.equal(batches.length, 3);
    for (const b of batches) assert.ok(b.length <= MAX_BATCH_ITEMS, `${b.length} <= ${MAX_BATCH_ITEMS}`);
    assert.equal(batches.flat().length, items.length, 'and no record is lost in the split');
  });

  test('the SIZE limit splits before the count limit does', () => {
    // Six documents just under the per-item cap: well inside the twenty-item limit, and
    // comfortably over the aggregate byte budget. This is the case the old code got wrong —
    // it counted neither, and sent one request.
    const per = MAX_ITEM_BYTES - 64 * 1024;
    const items = Array.from({ length: 6 }, (_, i) => item(`r${i}`, per));
    assert.ok(items.length * per > MAX_INPUT_TOTAL_BYTES, 'sanity: this batch must not fit');
    const { batches, rejected } = planBatches(items, sizeOf);
    assert.equal(rejected.length, 0);
    assert.ok(batches.length >= 2, `split into ${batches.length} batches`);
    for (const b of batches) {
      const total = b.reduce((n, it) => n + sizeOf(it.base64), 0);
      assert.ok(total <= MAX_INPUT_TOTAL_BYTES, `${total} <= ${MAX_INPUT_TOTAL_BYTES}`);
      assert.ok(b.length < MAX_BATCH_ITEMS, 'so the count limit was not what split it');
    }
  });

  test('every planned batch fits the wire limit Render will parse with', () => {
    const per = Math.floor(MAX_ITEM_BYTES / 2);
    const items = Array.from({ length: 40 }, (_, i) => item(`r${i}`, per));
    const { batches } = planBatches(items, sizeOf);
    for (const b of batches) {
      // What actually goes on the wire is the JSON, base64 included.
      const wire = Buffer.byteLength(JSON.stringify({ docType: 'receipt', year: 2026, force: false, items: b }));
      assert.ok(wire <= MAX_REQUEST_BYTES, `${wire} <= ${MAX_REQUEST_BYTES}`);
      // And it would have failed the old parser, which is the whole point.
      assert.ok(wire > 1024 * 1024, 'a real batch is over the 1 MB limit this used to hit');
    }
  });

  test('a document too big for ANY batch is reported, not wedged in or dropped', () => {
    const items = [
      item('ok-1', 1024),
      item('huge', MAX_ITEM_BYTES + 4096),
      item('ok-2', 1024),
    ];
    const { batches, rejected } = planBatches(items, sizeOf);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].item.recordId, 'huge');
    assert.match(rejected[0].error, /too large/);
    // The other two still go, in one batch.
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].map((i) => i.recordId), ['ok-1', 'ok-2']);
  });

  test('a payload that cannot be measured is rejected, not sized as zero', () => {
    // The caller passes a sizer that throws for unusable base64 and returns
    // Number.MAX_SAFE_INTEGER, so it lands in `rejected` instead of being dispatched.
    const { batches, rejected } = planBatches(
      [{ recordId: 'junk', base64: '@@@', fileName: 'a.docx' }, item('good', 512)],
      (b64) => (b64 === '@@@' ? Number.MAX_SAFE_INTEGER : sizeOf(b64)),
    );
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].item.recordId, 'junk');
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].map((i) => i.recordId), ['good']);
  });

  test('an ordinary bulk run is still ONE batch and one job', () => {
    // The common case must not have become chattier: twenty small consent documents are
    // one dispatch, exactly as before.
    const items = Array.from({ length: MAX_BATCH_ITEMS }, (_, i) => item(`r${i}`, 40 * 1024));
    const { batches, rejected } = planBatches(items, sizeOf);
    assert.equal(rejected.length, 0);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, MAX_BATCH_ITEMS);
  });

  test('nothing to convert plans nothing', () => {
    assert.deepEqual(planBatches([], sizeOf), { batches: [], rejected: [] });
    assert.deepEqual(planBatches(null, sizeOf), { batches: [], rejected: [] });
  });
});

describe('the dispatch path enforces it', () => {
  test('generateBulkPdfs splits and reports, and no longer sends one giant request', () => {
    const src = read('../src/docxTemplates.js');
    const dispatch = src.slice(src.indexOf('PRE-DISPATCH'), src.indexOf('// Render callback for a completed pdf_convert_batch'));

    assert.match(dispatch, /planBatches/, 'the dispatch is planned against the contract');
    // The defect was one dispatch for the whole of `toConvert`.
    assert.ok(!/items: toConvert/.test(dispatch),
      'the whole list must never be sent as one request again');
    assert.match(dispatch, /items: batch/, 'each request carries one planned batch');
    // A record refused by the contract has to reach the operator with a reason.
    assert.match(dispatch, /oversized/);
    assert.match(dispatch, /preSkipped: \[\.\.\.skipped, \.\.\.oversized\]/);
    // And a batch that WAS accepted must not also be converted locally.
    assert.match(dispatch, /dispatchFailures/);
  });
});
