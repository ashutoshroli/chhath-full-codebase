// pdf_convert job — input-validation guard (the Drive conversion itself hits the
// network, so the happy path is verified end-to-end after deploy). Config env is
// provided so the transitive config import doesn't throw at load.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';

const { runPdfConvert } = await import('../src/jobs/pdfConvert.js');

test('pdf_convert rejects a payload with no base64', async () => {
  await assert.rejects(() => runPdfConvert({}), /base64 \(filled \.docx\) is required/);
  await assert.rejects(() => runPdfConvert({ fileName: 'x.docx' }), /base64/);
});
