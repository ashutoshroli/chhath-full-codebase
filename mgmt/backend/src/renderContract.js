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

// ---- SERVER-SIDE FILL (bulk moved server-side) ------------------------------
//
// The bulk path used to send N pre-FILLED .docx files (one `base64` per item), and
// `planBatches` sized a batch by the sum of those documents. Filling now happens on
// Render, so a batch carries the TEMPLATE bytes ONCE plus per-record fill DATA (small
// JSON, not a document). `planBatches` therefore sizes a batch by
// `templateBytes (once) + sum(per-record data)` — see the `opts.perBatchBytes`
// argument below — which is far smaller than N filled documents and means an ordinary
// run is still one batch, one job.
//
// The per-record cap that bounded one filled .docx now bounds one record's DATA. A
// record's data is a few hundred bytes of text normally; MAX_ITEM_BYTES (2 MB) still
// covers a record carrying an inline image and rejects anything that could only be abuse.
export const MAX_DATA_ITEM_BYTES = MAX_ITEM_BYTES;

/** Rough serialized byte size of a record's fill DATA (JSON, UTF-8). Mirrors the Render copy.
 *
 * A `BigInt` in the data makes `JSON.stringify` THROW ("Do not know how to serialize a
 * BigInt"), and the old `catch` returned Number.MAX_SAFE_INTEGER — which every caller then
 * compares against the 2 MB limit and rejects, with the tell-tale "8589934592.0 MB" message
 * (MAX_SAFE_INTEGER / 1048576). A D1 INTEGER column (year, amount, a Sl. No.) can arrive as a
 * BigInt, so an ordinary bulk run had every record rejected. Coerce BigInt to string in a
 * replacer so the size is real; the actual dispatch payload is coerced the same way. The
 * throw path stays as a last-resort guard against a genuinely un-serializable value (a
 * circular reference), which is real abuse, not a normal record. */
export function dataByteLength(data) {
  if (data === undefined || data === null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), 'utf8');
  } catch (e) {
    return Number.MAX_SAFE_INTEGER;
  }
}

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
 *
 * `byteLengthOf(itemInput)` returns the per-item input size. It is called with the value
 * the caller decides matters: the LEGACY filled-docx model passes `it.base64`; the
 * SERVER-FILL model passes `it.data`. `opts.perBatchBytes` is a fixed overhead charged
 * ONCE per batch — the server-fill model passes the shared template's decoded size there,
 * so a batch's input budget is `perBatchBytes + sum(per-item bytes)`. A single item that
 * cannot fit even in an empty batch alongside the template overhead is rejected. `opts.of`
 * picks the per-item value out of the item (defaults to `it.base64`, the legacy field), so
 * the sizer keeps receiving the raw value it always has.
 */
export function planBatches(items, byteLengthOf, opts = {}) {
  const batches = [];
  const rejected = [];
  const perBatchBytes = Math.max(0, Number(opts && opts.perBatchBytes) || 0);
  const pick = (opts && typeof opts.of === 'function') ? opts.of : (it) => it && it.base64;
  let current = [];
  let currentBytes = 0;

  for (const it of items || []) {
    const picked = pick(it);
    const bytes = byteLengthOf(picked);
    if (bytes > MAX_ITEM_BYTES) {
      // DIAGNOSTIC (temporary): the sentinel MAX_SAFE_INTEGER means the sizer's
      // JSON.stringify threw. Surface WHY so a live "8589934592.0 MB" report names its
      // cause (which key/type) instead of a mystery number. Remove once the cause is fixed.
      let why = ` [bytes=${bytes}; pickedType=${typeof picked}`;
      if (picked && typeof picked === 'object') {
        try {
          const s = JSON.stringify(picked, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
          why += `; stringifyLen=${s == null ? 'null' : s.length}`;
        } catch (e) {
          why += `; stringifyTHREW=${(e && e.message) ? e.message.slice(0, 80) : 'yes'}`;
        }
        why += `; keys=${Object.keys(picked).slice(0, 15).join(',')}`;
      }
      why += ']';
      rejected.push({
        item: it,
        error: `document is too large (${(bytes / 1048576).toFixed(1)} MB; limit ${MAX_ITEM_BYTES / 1048576} MB)${why}`,
      });
      continue;
    }
    // A record that cannot fit even in a fresh batch (template overhead + this record
    // alone over the total) can never be dispatched — report it rather than looping.
    if (perBatchBytes + bytes > MAX_INPUT_TOTAL_BYTES) {
      rejected.push({
        item: it,
        error: `document is too large to batch with the template (${((perBatchBytes + bytes) / 1048576).toFixed(1)} MB; limit ${MAX_INPUT_TOTAL_BYTES / 1048576} MB)`,
      });
      continue;
    }
    const wouldExceed = current.length >= MAX_BATCH_ITEMS
      || perBatchBytes + currentBytes + bytes > MAX_INPUT_TOTAL_BYTES;
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
