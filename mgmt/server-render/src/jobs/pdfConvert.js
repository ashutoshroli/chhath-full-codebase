// Job: pdf_convert — FILL a .docx template with one record's data, then render it to a
// PDF via Google Drive and return the PDF bytes. This is the heavy, D1-free part of the
// single-record bulk PDF path (the Drive upload/convert/export/trash round-trips). The
// Worker keeps the D1-bound parts: the dedup read (before dispatch) and the
// generated_files index write + R2 store (on the callback via applyPdfConvertResult).
//
// The bulk path used to FILL in the browser and send a pre-filled .docx here. The fill
// now happens HERE (parity with docx_render + pdf_convert_batch): the payload carries the
// TEMPLATE bytes + the record's fill DATA (+ a server-generated QR from the DERIVED
// recordId), and this job does fill -> QR -> convert.
//
// payload: { docType, year, recordId, templateBase64, data, fileName, force, qr? }
// returns (as the callback `result`): { pdfBase64, fileName, report }
//   report = { missingTags, missingImages } travels WITH the result (no singleton).

import { convertDocxToPdfBytes } from '../lib/drive.js';
import { fillDocxTemplateFromBase64 } from '../lib/docxRender.js';
import { generateQrDataUrl, publicRecordUrl } from '../lib/qrCode.js';

export async function runPdfConvert(payload) {
  const { templateBase64, recordId, fileName } = payload || {};
  if (!templateBase64) throw new Error('pdf_convert: payload.templateBase64 (the template .docx) is required');

  const data = { ...(payload && payload.data ? payload.data : {}) };

  // Generate the QR server-side from the DERIVED recordId and inject it, exactly as the
  // auto path's docx_render does. Opt-out via payload.qr === false or data already
  // carrying QR_CODE. A blank QR must never fail the whole document.
  const wantQr = !(payload && payload.qr === false);
  if (wantQr && recordId && !data.QR_CODE) {
    try {
      data.QR_CODE = await generateQrDataUrl(publicRecordUrl(recordId));
    } catch (e) {
      data.QR_CODE = '';
    }
  }

  // 1) FILL the template (byte-identical to the browser renderer — see lib/docxRender.js).
  const { filledBase64, report } = fillDocxTemplateFromBase64(templateBase64, data);

  // 2) CONVERT the filled .docx to a PDF via Drive.
  const { pdfBase64, fileName: pdfName } = await convertDocxToPdfBytes(filledBase64, fileName || 'document.docx');

  return { pdfBase64, fileName: pdfName, report };
}
