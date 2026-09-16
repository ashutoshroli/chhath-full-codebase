// Job: pdf_convert_batch — convert up to MAX_BATCH_ITEMS filled .docx files to PDFs in
// ONE job, SEQUENTIALLY (Render has no 50-subrequest cap, unlike the Worker), and return
// per-record results in a single callback. The Worker then writes each PDF to R2 + the
// generated_files index (binding-only) on that one callback.
//
// payload: { docType, year, force, items: [{ recordId, base64, fileName }] }
// returns (as the callback `result`):
//   { results: [{ recordId, ok, pdfBase64?, fileName?, error? }], truncated?, budget? }
//
// audit Render/offload #2 — every limit here comes from `../lib/batchContract.js`, which
// the Worker enforces before dispatch and this file enforces on arrival. See that file
// for why one shared contract exists at all.

import { convertDocxToPdfBytes } from '../lib/drive.js';
import {
  MAX_BATCH_ITEMS,
  MAX_INPUT_TOTAL_BYTES,
  MAX_OUTPUT_ITEM_BYTES,
  MAX_OUTPUT_TOTAL_BYTES,
  base64ByteLength,
  validateBatchItem,
} from '../lib/batchContract.js';

export async function runPdfConvertBatch(payload) {
  const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
  if (items.length === 0) throw new Error('pdf_convert_batch: payload.items is required (non-empty)');

  // A batch bigger than the contract is a caller bug, not a per-record problem: the
  // Worker is supposed to have split it. Fail the JOB so it is visible as one clear
  // error, rather than silently converting the first twenty and dropping the rest.
  if (items.length > MAX_BATCH_ITEMS) {
    throw new Error(`pdf_convert_batch: ${items.length} items exceeds the contract limit of ${MAX_BATCH_ITEMS}`);
  }

  // Aggregate INPUT check, before any Drive work. Twenty items each inside the per-item
  // cap can still be far past what one job may carry.
  let inputTotal = 0;
  for (const it of items) inputTotal += base64ByteLength(it && it.base64);
  if (inputTotal > MAX_INPUT_TOTAL_BYTES) {
    throw new Error(
      `pdf_convert_batch: batch is ${(inputTotal / 1048576).toFixed(1)} MB, over the ` +
      `${MAX_INPUT_TOTAL_BYTES / 1048576} MB contract limit — dispatch a smaller batch`
    );
  }

  const results = [];
  let outputTotal = 0;
  let truncated = false;

  // Sequential on purpose: keeps us within Google Drive's per-user rate limit and
  // bounds memory (one PDF in flight at a time). A single bad record does not fail
  // the whole batch — it is recorded as { ok:false } and the rest continue.
  for (const it of items) {
    const check = validateBatchItem(it);
    if (!check.ok) {
      // Refused BEFORE Drive: an invalid item used to cost a full upload-and-convert
      // round-trip to discover, and a non-.docx was uploaded as if it were one.
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
      const { pdfBase64, fileName } = await convertDocxToPdfBytes(it.base64, check.fileName);
      const pdfBytes = base64ByteLength(pdfBase64);

      if (pdfBytes > MAX_OUTPUT_ITEM_BYTES) {
        // Do not accumulate it. One outsized PDF would push the callback past the
        // Worker's cap and take every other record in the batch down with it.
        results.push({
          recordId: check.recordId,
          ok: false,
          error: `converted PDF is too large (${(pdfBytes / 1048576).toFixed(1)} MB; limit ${MAX_OUTPUT_ITEM_BYTES / 1048576} MB)`,
        });
        continue;
      }
      if (outputTotal + pdfBytes > MAX_OUTPUT_TOTAL_BYTES) {
        truncated = true;
        results.push({
          recordId: check.recordId,
          ok: false,
          error: 'batch output budget exceeded — retry this record in a smaller batch',
        });
        continue;
      }

      outputTotal += pdfBytes;
      results.push({ recordId: check.recordId, ok: true, pdfBase64, fileName });
    } catch (e) {
      // Log the FULL error (incl. stack) to the Render console so a per-record
      // failure is diagnosable there, and always return a non-empty error string
      // to the Worker (a thrown non-Error, e.g. a string, has no `.message`).
      console.error(`[pdf_convert_batch] ${check.recordId} failed:`, (e && e.stack) || e);
      const msg = (e && (e.message || String(e))) || 'conversion failed';
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
