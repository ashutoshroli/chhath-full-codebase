// Job: docx_render — FILL a .docx template with data, then render it to a PDF via
// Google Drive and return the PDF bytes. This is the server-side move of the
// AUTO-GENERATE-ON-SAVE path (the collection_jobs queue): the browser no longer
// fills the .docx (docxFill.js) nor builds the QR (qrCode.js) — Render does both,
// here, next to the Drive conversion that was already offloaded for bulk.
//
// It is the natural extension of pdf_convert: pdf_convert receives an
// ALREADY-FILLED .docx and only converts it; docx_render receives the TEMPLATE
// bytes + the fill data and does fill -> QR -> convert. Keeping the two separate
// leaves bulk (client-filled today) untouched while the auto path moves server-side.
//
// The WORKER keeps every D1-/R2-bound part, exactly as pdf_convert does:
//   * it resolves the template BYTES (Drive + 7-day KV cache) and sends them here
//     (Render has no D1 and cannot read docx_templates);
//   * it DERIVES the recordId (audit P0-03) and sends it, so the QR encodes the
//     authoritative record URL, not a client-supplied one;
//   * on the callback it writes R2 + the generated_files index and, only then,
//     triggers WhatsApp then email (applyDocxRenderResult).
//
// payload: {
//   templateBase64,   // the .docx TEMPLATE bytes (Worker-resolved)
//   data,             // the placeholder set (server-built from the stored row)
//   recordId,         // DERIVED server-side; the QR encodes its public URL
//   fileName,         // the output name hint
//   qr: true|false,   // whether to generate + inject {QR_CODE} (default true)
// }
// returns (as the callback `result`): { pdfBase64, fileName, report }
//   report = { missingTags, missingImages } — travels WITH the result (no
//   module-level singleton), so concurrent jobs never cross reports.

import { fillDocxTemplateFromBase64 } from '../lib/docxRender.js';
import { convertDocxToPdfBytes } from '../lib/drive.js';
import { generateQrDataUrl, publicRecordUrl } from '../lib/qrCode.js';

export async function runDocxRender(payload) {
  const { templateBase64, recordId, fileName } = payload || {};
  if (!templateBase64) throw new Error('docx_render: payload.templateBase64 (the template .docx) is required');

  const data = { ...(payload && payload.data ? payload.data : {}) };

  // QR generation moves off the browser to HERE, alongside the fill. It is opt-out
  // (`qr === false`) so a caller with no record URL — e.g. a future doc type — can
  // skip it; the collection auto path always passes a derived recordId and wants it.
  const wantQr = !(payload && payload.qr === false);
  if (wantQr && recordId && !data.QR_CODE) {
    try {
      data.QR_CODE = await generateQrDataUrl(publicRecordUrl(recordId));
    } catch (e) {
      // A blank QR must never fail the whole document — the browser path degraded
      // the same way (it recorded the failure and rendered a blank QR).
      data.QR_CODE = '';
    }
  }

  // 1) FILL the template (byte-identical to the browser renderer — see docxRender.js).
  const { filledBase64, report } = fillDocxTemplateFromBase64(templateBase64, data);

  // 2) CONVERT the filled .docx to a PDF via Drive (the same call pdf_convert uses).
  const { pdfBase64, fileName: pdfName } = await convertDocxToPdfBytes(filledBase64, fileName || 'document.docx');

  return { pdfBase64, fileName: pdfName, report };
}
