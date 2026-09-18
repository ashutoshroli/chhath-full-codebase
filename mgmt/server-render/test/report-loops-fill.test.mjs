// ====== RENDER FILLS LOOP ROWS WHEN GIVEN AN ARRAY (the report's data path) ======
//
// The final half of the blank-Annual-Report fix. The Worker fix makes the record's
// fill DATA (with its contributors/expenses/loans/guarantors arrays) reach Render;
// this test locks the contract that Render actually renders loop ROWS from those
// arrays — and its {^...} empty-state fallback when an array is empty. That is the
// exact docxtemplater behavior the blank report exhibited: an empty object collapsed
// every {#contributors}...{/contributors} loop into its {^contributors}No
// contributors.{/contributors} fallback.
//
// Building a .docx fixture in-test (rather than shipping a binary) keeps the loop
// template visible and reviewable. It uses the same PizZip the renderer uses and
// exercises the real fillDocxTemplateFromBase64 / fillDocxTemplateFromBytes with
// paragraphLoop:true + inverted sections.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  fillDocxTemplateFromBase64,
  fillDocxTemplateFromBytes,
} from '../src/lib/docxRender.js';

const require = createRequire(import.meta.url);
const PizZip = require('pizzip');

// A DrawingML-free minimal WordprocessingML document. Each loop delimiter sits on
// its OWN paragraph so paragraphLoop:true repeats the row paragraph cleanly — the
// same structure a real report table row uses. `{^contributors}` is the inverted
// (empty-state) section docxtemplater renders when the array is empty/absent.
function documentXml() {
  const p = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${p('Contributors:')}
    ${p('{#contributors}')}
    ${p('{SL_NO}. {NAME} - {VILLAGE} - {AMOUNT}')}
    ${p('{/contributors}')}
    ${p('{^contributors}No contributors.{/contributors}')}
  </w:body>
</w:document>`;
}

// Assemble the three parts a .docx needs into a base64 ZIP the renderer can open.
function buildTemplateBase64() {
  const zip = new PizZip();
  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', documentXml());
  return zip.generate({ type: 'base64' });
}

const TEMPLATE_B64 = buildTemplateBase64();

// Read the rendered document.xml text back out so we can assert on what was rendered.
function renderedText(filledBase64) {
  const zip = new PizZip(filledBase64, { base64: true });
  return zip.file('word/document.xml').asText();
}

const CONTRIBUTORS = [
  { SL_NO: 1, NAME: 'Aarav', VILLAGE: 'Sonpur', AMOUNT: '\u20b9 500' },
  { SL_NO: 2, NAME: 'Bhavya', VILLAGE: 'Hajipur', AMOUNT: '\u20b9 1,000' },
  { SL_NO: 3, NAME: 'Chandan', VILLAGE: 'Chhapra', AMOUNT: '\u20b9 250' },
];

describe('the report loop section renders rows from a non-empty array', () => {
  test('a non-empty contributors array yields one row per entry, no fallback', () => {
    const { filledBase64, report } = fillDocxTemplateFromBase64(TEMPLATE_B64, { contributors: CONTRIBUTORS });
    const text = renderedText(filledBase64);

    // Every row's values are present.
    for (const c of CONTRIBUTORS) {
      assert.ok(text.includes(c.NAME), `rendered doc must contain contributor ${c.NAME}`);
      assert.ok(text.includes(c.VILLAGE), `rendered doc must contain village ${c.VILLAGE}`);
    }
    assert.ok(text.includes('Aarav') && text.includes('Bhavya') && text.includes('Chandan'),
      'all three contributor rows must render');
    // The empty-state fallback must NOT appear.
    assert.ok(!text.includes('No contributors.'),
      'the {^contributors} fallback must not render when the array is non-empty');
    // A well-formed array leaves no unresolved tags.
    assert.deepEqual(report.missingTags, [], 'no tag should go unresolved for a full row set');
  });

  test('fillDocxTemplateFromBytes renders the same rows', () => {
    const bytes = Buffer.from(TEMPLATE_B64, 'base64');
    const { filledBase64 } = fillDocxTemplateFromBytes(bytes, { contributors: CONTRIBUTORS });
    const text = renderedText(filledBase64);
    assert.ok(text.includes('Aarav') && text.includes('Chandan'));
    assert.ok(!text.includes('No contributors.'));
  });
});

describe('the report loop section falls back when the array is empty/absent', () => {
  test('an EMPTY contributors array renders the empty-state fallback, no rows', () => {
    const { filledBase64 } = fillDocxTemplateFromBase64(TEMPLATE_B64, { contributors: [] });
    const text = renderedText(filledBase64);
    assert.ok(text.includes('No contributors.'),
      'an empty array must render the {^contributors} fallback');
    for (const c of CONTRIBUTORS) {
      assert.ok(!text.includes(c.NAME), `no contributor row (${c.NAME}) may render for an empty array`);
    }
  });

  test('an EMPTY OBJECT (the blank-report bug) renders the fallback for every loop', () => {
    // This reproduces exactly what the Worker used to send Render: {} for `data`. The
    // loop collapses to its fallback — the blank Annual Report. The fix stops {} from
    // being sent; this proves {} is indeed what produced the symptom.
    const { filledBase64 } = fillDocxTemplateFromBase64(TEMPLATE_B64, {});
    const text = renderedText(filledBase64);
    assert.ok(text.includes('No contributors.'),
      'an empty data object renders the empty-state fallback — the observed blank report');
    assert.ok(!text.includes('Aarav'), 'no rows render from {}');
  });
});
