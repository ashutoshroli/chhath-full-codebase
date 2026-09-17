// docx_render job (src/jobs/docxRender.js) — the auto-generate-on-save fill moved
// server-side. It FILLS a template (+ generates the QR) then converts to PDF.
//
// The Drive conversion itself hits the network (verified end-to-end after deploy,
// exactly like pdfConvert.test.mjs), so here we:
//   * pin the input-validation guard on the job handler, and
//   * prove the fill + QR composition the handler performs — fill the SAME template
//     with QR-injected data and assert the filled .docx carries a REAL
//     server-generated QR (not the 1x1 blank fallback), i.e. the QR is produced on
//     Render, not in the browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The job handler transitively imports config (via drive.js), which requires the
// full Render env — same as pdfConvert.test.mjs.
process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';

const require = createRequire(import.meta.url);
const PizZip = require('pizzip');

import { fillDocxTemplateFromBase64 } from '../src/lib/docxRender.js';
import { generateQrDataUrl, publicRecordUrl } from '../src/lib/qrCode.js';

// Reuse the golden-parity fixture template.docx (built by make-template.mjs). It
// carries a {%photo} image tag with the full OOXML rels the image module needs —
// which a hand-built minimal .docx does not. We feed the QR through {photo} to
// exercise the exact image path the real {QR_CODE} placeholder uses.
const here = dirname(fileURLToPath(import.meta.url));
const templateBase64 = readFileSync(join(here, 'fixtures', 'template.docx')).toString('base64');

test('docx_render rejects a payload with no template bytes', async () => {
  const { runDocxRender } = await import('../src/jobs/docxRender.js');
  await assert.rejects(() => runDocxRender({}), /templateBase64 .* is required/);
  await assert.rejects(() => runDocxRender({ data: { name: 'x' } }), /templateBase64/);
});

test('the fill + server-generated QR the job performs embeds a REAL QR, not the blank fallback', async () => {
  // Exactly what runDocxRender does before it calls Drive: build the QR for the
  // DERIVED recordId and inject it into an image placeholder, then fill.
  const recordId = 'receipt-2026-5';
  const qr = await generateQrDataUrl(publicRecordUrl(recordId));
  // photo carries the QR (a real image path with rels); missingPhoto stays empty
  // so we can also confirm the blank-PNG fallback is distinguishable by size.
  const { filledBase64, report } = fillDocxTemplateFromBase64(templateBase64, {
    name: 'Ram Kumar', photo: qr, missingPhoto: 'data:image/png;base64,',
  });

  assert.ok(Array.isArray(report.missingTags), 'the report travels with the result (no singleton)');

  const filled = new PizZip(filledBase64, { base64: true });
  const doc = filled.file('word/document.xml').asText();
  assert.match(doc, /Ram Kumar/, 'the {name} text tag was filled');

  // A real 300px QR PNG is far larger than the renderer's 1x1 blank fallback, so
  // at least one embedded media image must be sizeable — proving the QR was
  // generated server-side and injected, not left blank.
  const mediaNames = Object.keys(filled.files).filter((n) => /word\/media\/.*\.png$/i.test(n));
  assert.ok(mediaNames.length >= 1, 'images were embedded as media parts');
  const sizes = mediaNames.map((n) => filled.file(n).asUint8Array().length);
  assert.ok(Math.max(...sizes) > 200, `a real QR image is embedded (sizes: ${sizes.join(', ')}), not only the 1x1 blank fallback`);
});
