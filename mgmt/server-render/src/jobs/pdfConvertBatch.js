// Job: pdf_convert_batch — convert up to ~20 filled .docx files to PDFs in ONE
// job, SEQUENTIALLY (Render has no 50-subrequest cap, unlike the Worker), and
// return per-record results in a single callback. The Worker then writes each PDF
// to R2 + the generated_files index (binding-only) on that one callback.
//
// payload: { docType, year, force, items: [{ recordId, base64, fileName }] }
// returns (as the callback `result`):
//   { results: [{ recordId, ok, pdfBase64?, fileName?, error? }] }

import { convertDocxToPdfBytes } from '../lib/drive.js';

export async function runPdfConvertBatch(payload) {
  const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
  if (items.length === 0) throw new Error('pdf_convert_batch: payload.items is required (non-empty)');

  const results = [];
  // Sequential on purpose: keeps us within Google Drive's per-user rate limit and
  // bounds memory (one PDF in flight at a time). A single bad record does not fail
  // the whole batch — it is recorded as { ok:false } and the rest continue.
  for (const it of items) {
    const recordId = it && it.recordId;
    if (!recordId || !it.base64) {
      results.push({ recordId: recordId || null, ok: false, error: 'missing recordId/base64' });
      continue;
    }
    try {
      const { pdfBase64, fileName } = await convertDocxToPdfBytes(it.base64, it.fileName || 'document.docx');
      results.push({ recordId, ok: true, pdfBase64, fileName });
    } catch (e) {
      console.warn(`[pdf_convert_batch] ${recordId} failed:`, e && e.message);
      results.push({ recordId, ok: false, error: (e && e.message) || 'conversion failed' });
    }
  }
  return { results };
}
