// Job: pdf_convert_batch — FILL up to MAX_BATCH_ITEMS records from ONE shared template
// and convert each to a PDF, SEQUENTIALLY (Render has no 50-subrequest cap, unlike the
// Worker), returning per-record results in a single callback. The Worker then writes
// each PDF to R2 + the generated_files index (binding-only) on that one callback.
//
// The bulk path used to FILL in the browser and send N pre-filled .docx files here. The
// fill now happens HERE (parity with the auto path's docx_render): the batch carries the
// TEMPLATE bytes ONCE (`payload.templateBase64`) plus per-record fill DATA, and this job
// fills each record's data against the shared template (+ a server-generated QR from the
// DERIVED recordId), then converts. That both moves docxtemplater off the browser and
// SHRINKS the input — one template + N tiny data blobs instead of N whole documents.
//
// payload: {
//   docType, year, force,
//   templateBase64,                       // the .docx TEMPLATE bytes (Worker-resolved, ONCE)
//   items: [{ recordId, data, fileName }] // per-record fill DATA (not a filled .docx)
// }
// returns (as the callback `result`):
//   { results: [{ recordId, ok, pdfBase64?, fileName?, error?, report? }], truncated?, budget? }
//   report = { missingTags, missingImages } travels WITH each record (no singleton), so
//   the bulk UI can surface unresolved placeholders per record.
//
// audit Render/offload #2 — every limit here comes from `../lib/batchContract.js`, which
// the Worker enforces before dispatch and this file enforces on arrival. See that file
// for why one shared contract exists at all.

import { convertDocxToPdfBytes } from '../lib/drive.js';
import { fillDocxTemplateFromBase64 } from '../lib/docxRender.js';
import { generateQrDataUrl, publicRecordUrl } from '../lib/qrCode.js';
import {
  MAX_BATCH_ITEMS,
  MAX_INPUT_TOTAL_BYTES,
  MAX_OUTPUT_ITEM_BYTES,
  MAX_OUTPUT_TOTAL_BYTES,
  base64ByteLength,
  dataByteLength,
  validateFillBatchItem,
} from '../lib/batchContract.js';

export async function runPdfConvertBatch(payload) {
  const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
  if (items.length === 0) throw new Error('pdf_convert_batch: payload.items is required (non-empty)');

  // The TEMPLATE is shared by the whole batch (all records are the same docType+year).
  // It is sent ONCE — the fill happens here, so a missing template is a whole-job error,
  // not a per-record one: nothing in the batch can be produced without it.
  const templateBase64 = payload && payload.templateBase64;
  if (!templateBase64) throw new Error('pdf_convert_batch: payload.templateBase64 (the shared template .docx) is required');

  // A batch bigger than the contract is a caller bug, not a per-record problem: the
  // Worker is supposed to have split it. Fail the JOB so it is visible as one clear
  // error, rather than silently filling the first twenty and dropping the rest.
  if (items.length > MAX_BATCH_ITEMS) {
    throw new Error(`pdf_convert_batch: ${items.length} items exceeds the contract limit of ${MAX_BATCH_ITEMS}`);
  }

  // Aggregate INPUT check, before any Drive work. The input is now the template ONCE
  // plus each record's data — far smaller than N filled documents, but still bounded so
  // a pathological data blob cannot blow the budget.
  const templateBytes = base64ByteLength(templateBase64);
  let inputTotal = templateBytes;
  for (const it of items) inputTotal += dataByteLength(it && it.data);
  if (inputTotal > MAX_INPUT_TOTAL_BYTES) {
    throw new Error(
      `pdf_convert_batch: batch is ${(inputTotal / 1048576).toFixed(1)} MB, over the ` +
      `${MAX_INPUT_TOTAL_BYTES / 1048576} MB contract limit — dispatch a smaller batch`
    );
  }

  const wantQr = !(payload && payload.qr === false);
  const results = [];
  let outputTotal = 0;
  let truncated = false;

  // Sequential on purpose: keeps us within Google Drive's per-user rate limit and
  // bounds memory (one PDF in flight at a time). A single bad record does not fail
  // the whole batch — it is recorded as { ok:false } and the rest continue.
  for (const it of items) {
    const check = validateFillBatchItem(it);
    if (!check.ok) {
      // Refused BEFORE any fill/Drive work: an invalid item used to cost a full
      // upload-and-convert round-trip to discover.
      results.push({ recordId: (it && it.recordId) || null, ok: false, error: check.error });
      continue;
    }

    // Once the output budget is spent, stop CONVERTING. Continuing would spend Drive
    // quota producing bytes that cannot be delivered: the callback carries every PDF in
    // one body, and the Worker rejects a body over 10 MB — so the whole batch, including
    // the conversions that succeeded, would be thrown away on arrival.
    if (outputTotal >= MAX_OUTPUT_TOTAL_BYTES) {
      truncated = true;
      results.push({
        recordId: check.recordId,
        ok: false,
        error: 'batch output budget reached before this record — retry it in a smaller batch',
      });
      continue;
    }

    try {
      // 1) Generate the QR server-side from the DERIVED recordId and inject it, exactly
      //    as the auto path's docx_render does. Opt-out via payload.qr === false or a
      //    record whose data already carries QR_CODE. A blank QR never fails the doc.
      const data = { ...(check.data || {}) };
      if (wantQr && check.recordId && !data.QR_CODE) {
        try {
          data.QR_CODE = await generateQrDataUrl(publicRecordUrl(check.recordId));
        } catch (e) {
          data.QR_CODE = '';
        }
      }

      // 2) FILL the shared template with this record's data (byte-identical to the
      //    browser renderer — see lib/docxRender.js). The report travels with THIS
      //    record's result (no module-level singleton), so concurrent jobs never cross.
      const { filledBase64, report } = fillDocxTemplateFromBase64(templateBase64, data);

      // 3) CONVERT the filled .docx to a PDF via Drive (the same call pdf_convert uses).
      const { pdfBase64, fileName } = await convertDocxToPdfBytes(filledBase64, check.fileName);
      const pdfBytes = base64ByteLength(pdfBase64);

      if (pdfBytes > MAX_OUTPUT_ITEM_BYTES) {
        // Do not accumulate it. One outsized PDF would push the callback past the
        // Worker's cap and take every other record in the batch down with it.
        results.push({
          recordId: check.recordId,
          ok: false,
          error: `converted PDF is too large (${(pdfBytes / 1048576).toFixed(1)} MB; limit ${MAX_OUTPUT_ITEM_BYTES / 1048576} MB)`,
          report,
        });
        continue;
      }
      if (outputTotal + pdfBytes > MAX_OUTPUT_TOTAL_BYTES) {
        truncated = true;
        results.push({
          recordId: check.recordId,
          ok: false,
          error: 'batch output budget exceeded — retry this record in a smaller batch',
          report,
        });
        continue;
      }

      outputTotal += pdfBytes;
      results.push({ recordId: check.recordId, ok: true, pdfBase64, fileName, report });
    } catch (e) {
      // Log the FULL error (incl. stack) to the Render console so a per-record
      // failure is diagnosable there, and always return a non-empty error string
      // to the Worker (a thrown non-Error, e.g. a string, has no `.message`).
      console.error(`[pdf_convert_batch] ${check.recordId} failed:`, (e && e.stack) || e);
      const msg = (e && (e.message || String(e))) || 'fill or conversion failed';
      results.push({ recordId: check.recordId, ok: false, error: msg });
    }
  }

  // `truncated` and `budget` are additive and let the bulk screen say WHY some records
  // came back unconverted, instead of the operator seeing an unexplained partial run.
  // The Worker already reconciles the response against the records it asked for.
  return {
    results,
    ...(truncated ? { truncated: true } : {}),
    budget: { outputBytes: outputTotal, outputLimitBytes: MAX_OUTPUT_TOTAL_BYTES },
  };
}
