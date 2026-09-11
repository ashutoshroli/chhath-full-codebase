// Job: pdf_convert — render a filled .docx to a PDF via Google Drive and return
// the PDF bytes. This is the heavy, D1-free part of bulk PDF generation (the Drive
// upload/convert/export/trash round-trips). The Worker keeps the D1-bound parts:
// the dedup read (before dispatch) and the generated_files index write + R2 store
// (on the callback via applyPdfConvertResult).
//
// payload: { docType, year, recordId, base64 (filled .docx), fileName, force }
// returns (as the callback `result`): { pdfBase64, fileName }

import { convertDocxToPdfBytes } from '../lib/drive.js';

export async function runPdfConvert(payload) {
  const { base64, fileName } = payload || {};
  if (!base64) throw new Error('pdf_convert: payload.base64 (filled .docx) is required');
  const { pdfBase64, fileName: pdfName } = await convertDocxToPdfBytes(base64, fileName || 'document.docx');
  return { pdfBase64, fileName: pdfName };
}
