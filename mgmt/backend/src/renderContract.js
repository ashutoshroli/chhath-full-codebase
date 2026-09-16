// ============ THE PDF-BATCH BYTE CONTRACT (Worker side) ============
//
// audit Render/offload #1 and #2. `pdf_convert_batch` is the one render job that carries
// real bytes — up to ~20 filled `.docx` files out, the same number of PDFs back — and
// nothing agreed on how many bytes that was allowed to be. The Render service parsed
// every request with a 1 MB JSON limit, so a real bulk run of twenty documents was
// rejected by body-parser before its router ran; this Worker then treated that as
// "Render unreachable" and converted the entire batch ITSELF, which is precisely the CPU
// and subrequest limit the offload exists to stay under. A size mismatch turned a working
// offload into a Worker-killing fallback, and it did so on the largest batches only.
//
// The contract below is now enforced at every hop: here before dispatch, there on
// arrival, and on the way back so a completed batch always fits inside its callback.
//
// KEEP IN SYNC with `mgmt/server-render/src/lib/batchContract.js`. The two deployments
// share no code by design, so the constants are duplicated — and
// `test/render-batch-contract.test.mjs` reads BOTH files and fails on drift, which is the
// same guard the public Worker's duplicated column maps have.
// ---- 8< ---- CONTRACT (kept byte-identical in both copies) ---- 8< ----
export const MAX_BATCH_ITEMS = 20;

// One filled .docx. A consent or receipt document is tens of KB; a letterheaded
// template with images is a few hundred. 2 MB is generous for a real document and
// still rejects an item that could only be abuse or a client bug.
export const MAX_ITEM_BYTES = 2 * 1024 * 1024;

// The whole batch, DECODED. This is the cap that actually binds: 20 items at the
// per-item maximum would be 40 MB, and no batch is allowed to be that.
export const MAX_INPUT_TOTAL_BYTES = 8 * 1024 * 1024;

// The request body as it arrives, which is base64 (+1/3) plus JSON overhead. The
// Express limit is DERIVED from this constant rather than written next to it, so the
// parser and the contract cannot drift apart again.
export const MAX_REQUEST_BYTES = Math.ceil(MAX_INPUT_TOTAL_BYTES * 4 / 3) + 512 * 1024;

// One converted PDF, and the whole batch's PDFs, DECODED. The total is what keeps the
// single callback under the Worker's 10 MB body cap once base64 has expanded it:
// 6 MB -> 8 MB of base64, leaving room for the JSON around it.
export const MAX_OUTPUT_ITEM_BYTES = 4 * 1024 * 1024;
export const MAX_OUTPUT_TOTAL_BYTES = 6 * 1024 * 1024;

// The public chat endpoint is the only browser-facing route on this service and carries
// one short question. It had the same 1 MB allowance as everything else; it needs 16 KB.
export const MAX_CHAT_REQUEST_BYTES = 16 * 1024;
// ---- 8< ---- END CONTRACT ---- 8< ----

/**
 * Splits the records to convert into batches that each satisfy the contract, so the
 * dispatch can never be the thing that breaks it.
 *
 * Two limits apply together and the size one is what usually bites: twenty small consent
 * documents fit in one batch, but a handful of image-heavy templates do not.
 *
 * An item that cannot go in ANY batch (over the per-item cap) is returned in `rejected`
 * rather than silently dropped or wedged into a batch that will fail — the caller reports
 * it per record, exactly as it reports a conversion failure.
 */
export function planBatches(items, byteLengthOf) {
  const batches = [];
  const rejected = [];
  let current = [];
  let currentBytes = 0;

  for (const it of items || []) {
    const bytes = byteLengthOf(it.base64);
    if (bytes > MAX_ITEM_BYTES) {
      rejected.push({
        item: it,
        error: `document is too large (${(bytes / 1048576).toFixed(1)} MB; limit ${MAX_ITEM_BYTES / 1048576} MB)`,
      });
      continue;
    }
    const wouldExceed = current.length >= MAX_BATCH_ITEMS
      || currentBytes + bytes > MAX_INPUT_TOTAL_BYTES;
    if (current.length && wouldExceed) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(it);
    currentBytes += bytes;
  }
  if (current.length) batches.push(current);
  return { batches, rejected };
}
