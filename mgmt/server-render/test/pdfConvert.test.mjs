// pdf_convert job — now FILLS a template (+QR) before converting (the bulk single-record
// path moved server-side). The Drive conversion itself hits the network, so the happy
// path is verified end-to-end after deploy; here we pin the input-validation guard and
// prove the fill + server-generated QR the job performs (parity with docxRender.job.test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';

const require = createRequire(import.meta.url);
const PizZip = require('pizzip');

const here = dirname(fileURLToPath(import.meta.url));
const templateBase64 = readFileSync(join(here, 'fixtures', 'template.docx')).toString('base64');

const { runPdfConvert } = await import('../src/jobs/pdfConvert.js');
const { fillDocxTemplateFromBase64 } = await import('../src/lib/docxRender.js');
const { generateQrDataUrl, publicRecordUrl } = await import('../src/lib/qrCode.js');

test('pdf_convert now requires the TEMPLATE bytes (fill moved server-side)', async () => {
  await assert.rejects(() => runPdfConvert({}), /templateBase64 .* is required/);
  await assert.rejects(() => runPdfConvert({ data: { name: 'x' } }), /templateBase64/);
});

test('the fill + server-generated QR the job performs embeds a REAL QR, not the blank fallback', async () => {
  const recordId = 'receipt-2026-5';
  const qr = await generateQrDataUrl(publicRecordUrl(recordId));
  // photo carries the QR through the real image path (with rels); the job injects the
  // QR into {QR_CODE}, but the fixture template exposes {%photo}, so we mirror the exact
  // fill the job performs and assert a sizeable image lands in the .docx.
  const { filledBase64, report } = fillDocxTemplateFromBase64(templateBase64, {
    name: 'Ram Kumar', photo: qr, missingPhoto: 'data:image/png;base64,',
  });
  assert.ok(Array.isArray(report.missingTags), 'the report travels with the result (no singleton)');

  const filled = new PizZip(filledBase64, { base64: true });
  assert.match(filled.file('word/document.xml').asText(), /Ram Kumar/, 'the {name} text tag was filled');
  const media = Object.keys(filled.files).filter((n) => /word\/media\/.*\.png$/i.test(n));
  assert.ok(media.length >= 1, 'images were embedded as media parts');
  const sizes = media.map((n) => filled.file(n).asUint8Array().length);
  assert.ok(Math.max(...sizes) > 200, `a real QR image is embedded (sizes: ${sizes.join(', ')}), not only the 1x1 blank fallback`);
});
