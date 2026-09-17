// Golden-fixture parity + concurrency tests for the ported server-side DOCX
// renderer (src/lib/docxRender.js).
//
// PROVE-FIRST (house method): the fixtures under test/fixtures/ were captured on
// `main` by running the LIVE browser renderer (mgmt/frontend/src/docxFill.js) over
// template.docx + data.mjs — see capture-golden.mjs. These tests re-fill the SAME
// template with the SAME data using the PORTED renderer and assert the output
// equals the golden baseline. If the port drifts from the browser renderer, these
// fail.
//
// WHY PER-PART, NOT WHOLE-FILE, BYTE EQUALITY: a .docx is a ZIP, and a ZIP's local
// file headers embed a modification TIMESTAMP. PizZip stamps entries with the wall
// clock at generate() time, so two runs of the SAME renderer over the SAME input
// produce ZIP containers that differ only in those timestamp bytes (verified: the
// two files are the same length and diverge first at offset 226, inside a local
// header, not in any content part). "Byte-for-byte parity of the rendered
// document" therefore means every ZIP ENTRY'S CONTENT is byte-identical — which is
// exactly what we assert. We also assert the docxtemplater engine version is
// pinned to the same version the browser renderer uses, so the rendered XML/media
// is produced by the identical engine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

import {
  fillDocxTemplateFromBase64,
  fillDocxTemplateFromBytes,
} from '../src/lib/docxRender.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const require = createRequire(import.meta.url);
const PizZip = require('pizzip');

const { DATA, DATA_B } = await import(
  join(fixtures, 'data.mjs').replace(/\\/g, '/')
);

const templateBase64 = readFileSync(join(fixtures, 'template.docx')).toString(
  'base64',
);
const goldenBase64 = readFileSync(join(fixtures, 'golden.docx.b64'), 'utf8').trim();
const goldenReport = JSON.parse(
  readFileSync(join(fixtures, 'golden.report.json'), 'utf8'),
);

// Compare every ZIP entry's content bytes (ignoring container timestamps).
function assertDocxPartsEqual(actualBase64, expectedBase64, message) {
  const a = new PizZip(actualBase64, { base64: true });
  const b = new PizZip(expectedBase64, { base64: true });
  const aNames = Object.keys(a.files).sort();
  const bNames = Object.keys(b.files).sort();
  assert.deepEqual(aNames, bNames, `${message}: part list differs`);
  for (const name of bNames) {
    if (b.files[name].dir) continue;
    const av = Buffer.from(a.files[name].asUint8Array());
    const bv = Buffer.from(b.files[name].asUint8Array());
    assert.ok(
      av.equals(bv),
      `${message}: part ${name} differs from the golden baseline`,
    );
  }
}

test('renderer engine matches the browser renderer (pinned docxtemplater)', () => {
  // The golden baseline was produced by docxtemplater 3.69.3 in the browser app.
  // The server renderer must render with the same engine version, else the RENDERED
  // XML itself (not just the container) could drift.
  const v = require('docxtemplater/package.json').version;
  assert.equal(v, '3.69.3', `docxtemplater is ${v}, expected 3.69.3 (pinned)`);
});

test('parity: server render of the fixture equals the golden baseline (per-part bytes)', () => {
  const { filledBase64, report } = fillDocxTemplateFromBase64(templateBase64, DATA);
  assertDocxPartsEqual(filledBase64, goldenBase64, 'fillDocxTemplateFromBase64');
  assert.deepEqual(report, goldenReport);
});

test('parity: fillDocxTemplateFromBytes matches too', () => {
  const bytes = Buffer.from(templateBase64, 'base64');
  const { filledBase64, report } = fillDocxTemplateFromBytes(bytes, DATA);
  assertDocxPartsEqual(filledBase64, goldenBase64, 'fillDocxTemplateFromBytes');
  assert.deepEqual(report, goldenReport);
});

test('report exercises every branch: nullGetter records the unresolved tag', () => {
  const { report } = fillDocxTemplateFromBase64(templateBase64, DATA);
  assert.deepEqual(report.missingTags, ['missing']);
});

test('report exercises every branch: blank-PNG fallback records the missing image', () => {
  const { report } = fillDocxTemplateFromBase64(templateBase64, DATA);
  assert.deepEqual(report.missingImages, ['missingPhoto']);
});

test('report is returned per call, not shared module state (independent fills)', () => {
  const a = fillDocxTemplateFromBase64(templateBase64, DATA);
  const b = fillDocxTemplateFromBase64(templateBase64, DATA_B);
  // DATA has a missing image; DATA_B supplies both images. If the report lived in a
  // shared variable, the second fill would clobber the first's report.
  assert.deepEqual(a.report.missingImages, ['missingPhoto']);
  assert.deepEqual(b.report.missingImages, []);
  assert.deepEqual(a.report.missingTags, ['missing']);
  assert.deepEqual(b.report.missingTags, ['missing']);
});

test('concurrency: two DIFFERENT documents filled interleaved keep their own reports', async () => {
  // This is the test that fails against a module-level singleton report (the browser
  // renderer's getLastRenderReport()). On Render up to jobsMaxConcurrent (=3) fills
  // run at once; each must carry ITS OWN report. We interleave many pairs so a race
  // on shared state would surface.
  const runs = [];
  for (let i = 0; i < 25; i++) {
    runs.push(Promise.resolve().then(() => fillDocxTemplateFromBase64(templateBase64, DATA)));
    runs.push(Promise.resolve().then(() => fillDocxTemplateFromBase64(templateBase64, DATA_B)));
  }
  const results = await Promise.all(runs);
  for (let i = 0; i < results.length; i += 2) {
    const a = results[i];
    const b = results[i + 1];
    assert.deepEqual(a.report.missingImages, ['missingPhoto'], 'doc A must record its missing image');
    assert.deepEqual(b.report.missingImages, [], 'doc B has no missing image');
  }
});
