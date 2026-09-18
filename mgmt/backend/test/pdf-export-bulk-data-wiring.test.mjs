// ====== THE PDF-EXPORT BULK PATH MUST CARRY THE FILL DATA (blank Annual Report) ======
//
// Reported from the live portal: management More -> PDF Export produced a 3-page
// Annual Report PDF with the CORRECT template layout but EVERY table showing its
// empty-state fallback ("No contributors.", "No expenses.", ...) and every summary
// scalar blank. The template was fine; the data never arrived.
//
// WHAT HAPPENED. The bulk single-record path fills SERVER-SIDE: the frontend
// (mgmt/frontend/src/api.js convertDocxToPdfBulk) posts the placeholder set — the
// scalars plus the nested loans/guarantors/contributors/expenses arrays — under the
// request key `data`. The Worker resolves the template and Render fills it with
// that `data`. But the index.js convertDocxToPdfBulk handler forwarded `req.base64`
// (the 5th argument of docx.dispatchBulkPdfConvert, whose parameter is named `data`)
// instead of `req.data`. `req.base64` is undefined for this path, so
// dispatchBulkPdfConvert sent `data: {}` to Render, every docxtemplater loop section
// collapsed to its inverted ({^...}) empty-state fallback and every scalar resolved
// blank via nullGetter — the observed blank report.
//
// WHY NOTHING CAUGHT IT. The frontend sends `data`; the handler read `base64`. Two
// halves that never agreed, and no test compared them. Receipts survived because
// they use the BATCH path (convertDocxToPdfBatch -> req.items[].data). So this file
// does not re-test the dispatch — it reads the two source halves and asserts they
// agree on the key, exactly as frontend-payloads-pass-the-server-guard.test.mjs does
// for the edit screens. It is written to FAIL if the handler is reverted to
// req.base64.
//
// Run: node --test mgmt/backend/test/pdf-export-bulk-data-wiring.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// Returns the text of the balanced (...) argument list that begins at `from`
// (the index of, or just before, the opening paren). Quote- and nesting-aware so a
// string containing a paren or a nested call does not end it early.
function parenBlockAt(src, from) {
  const start = src.indexOf('(', from);
  if (start < 0) return null;
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

// ---- FRONTEND SIDE: what key does api.js send the placeholder set under? ----
//
// api.js `convertDocxToPdfBulk: async (docType, year, recordId, data, fileName, force) => {
//    const res = await call('convertDocxToPdfBulk', { docType, year, recordId, data, fileName, force });
// The body object handed to call() must carry the placeholders under `data`.
function frontendBulkCallBody() {
  const src = read('../../frontend/src/api.js');
  const at = src.indexOf('convertDocxToPdfBulk');
  assert.ok(at >= 0, 'convertDocxToPdfBulk not found in api.js — the extractor or the file changed');
  const callAt = src.indexOf("call('convertDocxToPdfBulk'", at);
  assert.ok(callAt >= 0, "no call('convertDocxToPdfBulk', ...) found in api.js");
  const args = parenBlockAt(src, callAt + "call".length);
  assert.ok(args, 'could not read the call(...) argument list in api.js');
  return args;
}

// ---- BACKEND SIDE: which req field does the handler forward as dispatch's `data`? ----
//
// index.js:
//   convertDocxToPdfBulk: () => withAuth(env, req, (user) => {
//     ...
//     return docx.dispatchBulkPdfConvert(
//       env, req.docType, req.year, req.recordId, <THIS ARG>, req.fileName,
//       user, { force: !!req.force }
//     );
//   }),
// The 5th positional argument (index 4) lands on dispatchBulkPdfConvert's `data`
// parameter, so <THIS ARG> is the one that matters.
function backendBulkDispatchArgs() {
  const src = read('../src/index.js');
  const handlerAt = src.indexOf('convertDocxToPdfBulk:');
  assert.ok(handlerAt >= 0, 'convertDocxToPdfBulk handler not found in index.js');
  const dispatchAt = src.indexOf('docx.dispatchBulkPdfConvert', handlerAt);
  assert.ok(dispatchAt >= 0, 'the handler no longer calls docx.dispatchBulkPdfConvert');
  const argsText = parenBlockAt(src, dispatchAt + 'docx.dispatchBulkPdfConvert'.length);
  assert.ok(argsText, 'could not read the dispatchBulkPdfConvert(...) argument list');
  // Split the argument list on top-level commas so positions are exact.
  const inner = argsText.slice(1, -1);
  const args = [];
  let depth = 0, quote = null, tok = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) { tok += c; if (c === '\\') { tok += inner[++i]; continue; } if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; tok += c; continue; }
    if ('([{'.includes(c)) { depth++; tok += c; continue; }
    if (')]}'.includes(c)) { depth--; tok += c; continue; }
    if (c === ',' && depth === 0) { args.push(tok.trim()); tok = ''; continue; }
    tok += c;
  }
  if (tok.trim()) args.push(tok.trim());
  return args;
}

// ------------------------------------------------ 1. THE ASSERTION THAT MATTERED

describe('the PDF-export bulk path carries the record fill DATA end to end', () => {
  test('the frontend sends the placeholder set under `data`, not `base64`', () => {
    const body = frontendBulkCallBody();
    // The call body is `{ docType, year, recordId, data, fileName, force }` — shorthand
    // `data`, so it appears as a standalone `data` key and never as `base64`.
    assert.match(body, /\bdata\b/, 'api.js must send the placeholders under `data`');
    assert.doesNotMatch(body, /\bbase64\b/,
      'the bulk path fills server-side from `data`; it must not send a pre-filled `base64` .docx');
  });

  test('the index.js handler forwards req.data (not req.base64) as dispatch\u2019s 5th arg', () => {
    const args = backendBulkDispatchArgs();
    // dispatchBulkPdfConvert(env, docType, year, recordId, DATA, fileName, user, opts)
    // -> the 5th positional argument (index 4) is the `data` parameter.
    assert.ok(args.length >= 6, `expected >=6 args to dispatchBulkPdfConvert, got ${args.length}: ${args.join(' | ')}`);
    const fifth = args[4];
    // THE ASSERTION THAT FAILS ON `main` (and on any revert to req.base64).
    assert.equal(fifth, 'req.data',
      `the 5th arg must be req.data (the placeholder set); it is "${fifth}". `
      + 'Passing req.base64 here sends {} to Render and produces a blank report.');
    assert.notEqual(fifth, 'req.base64',
      'req.base64 is undefined on the bulk path — forwarding it is exactly the blank-report bug');
  });

  test('the single/consent handler is untouched and still sends req.base64', () => {
    // convertDocxToPdf (the staff single-record / consent path) genuinely posts a
    // pre-filled .docx as base64 and MUST keep doing so — the scope guard for the fix.
    const src = read('../src/index.js');
    const handlerAt = src.indexOf('convertDocxToPdf:');
    assert.ok(handlerAt >= 0, 'convertDocxToPdf handler not found in index.js');
    const callAt = src.indexOf('docx.convertDocxToPdf(', handlerAt);
    assert.ok(callAt >= 0, 'the single handler no longer calls docx.convertDocxToPdf');
    const argsText = parenBlockAt(src, callAt + 'docx.convertDocxToPdf'.length);
    assert.match(argsText, /\breq\.base64\b/,
      'the single/consent path must keep sending req.base64 (a pre-filled .docx)');
  });
});

// ------------------------------------------------- 2. THE EXTRACTOR IS NOT VACUOUS

describe('the extractor actually reads the two source halves', () => {
  test('it located both call sites', () => {
    // If either lookup silently returned nothing, the assertions above would pass for
    // the wrong reason. Prove both extractors found real, non-empty argument text.
    const body = frontendBulkCallBody();
    assert.ok(body.length > 2 && body.includes('{'), 'frontend call body must be a real object literal');

    const args = backendBulkDispatchArgs();
    assert.ok(args.length >= 6, 'backend dispatch must have been parsed into positional args');
    assert.equal(args[0], 'env', 'sanity: first dispatch arg is env');
    assert.match(args[1], /req\.docType/, 'sanity: second dispatch arg is req.docType');
    assert.match(args[3], /req\.recordId/, 'sanity: fourth dispatch arg is req.recordId');
  });

  test('a control: the assertion would fail if the arg were req.base64', () => {
    // Simulate the reverted handler text and run the SAME positional check on it, so
    // this file proves it is not toothless.
    const reverted = 'docx.dispatchBulkPdfConvert('
      + 'env, req.docType, req.year, req.recordId, req.base64, req.fileName,'
      + ' user, { force: !!req.force })';
    const inner = parenBlockAt(reverted, 'docx.dispatchBulkPdfConvert'.length).slice(1, -1);
    const args = inner.split(',').map((s) => s.trim());
    assert.equal(args[4], 'req.base64', 'the control text really is the buggy shape');
    assert.throws(
      () => assert.equal(args[4], 'req.data', 'reverted'),
      'a req.base64 5th arg must make the wiring assertion throw');
  });
});
