// ============ THE PDF-BATCH BYTE CONTRACT (Render side) ============
//
// audit Render/offload #1 and #2. `pdf_convert_batch` is the one job that carries real
// bytes — up to ~20 filled `.docx` files in, the same number of PDFs back out — and
// until now nothing agreed on how many bytes that was allowed to be:
//
//   * `server.js` parsed every request with `express.json({ limit: '1mb' })`, under a
//     comment claiming payloads "carry references + small text, never big blobs". That
//     is true of the AI jobs and false of this one. A bulk run of twenty documents is
//     comfortably over 1 MB once base64 has added its third, so body-parser rejected it
//     BEFORE the router — and the Worker's dispatch then fell back to converting the
//     whole batch synchronously in the Worker, which is precisely the CPU and subrequest
//     limit this offload service exists to stay under. A size mismatch turned a working
//     offload into a Worker-killing fallback.
//   * nothing capped the number of items, the size of one item, or the size of the
//     result, and every PDF was accumulated in memory and then serialised into ONE
//     callback — which the Worker rejects over 10 MB. A batch could therefore succeed
//     here, cost twenty Drive conversions, and be thrown away on arrival.
//
// So there is now ONE contract, stated in bytes, and every hop enforces the same numbers:
// the Worker refuses to dispatch a batch that breaks it, this service refuses to accept
// one, and the result is bounded so a completed batch always fits in its callback.
//
// KEEP IN SYNC with `mgmt/backend/src/renderContract.js`. The two deployments share no
// code by design (see the note on REVERSE_MAPS in the public Worker), so the constants
// are duplicated and a test on the Worker side reads BOTH files and fails on drift.
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

/** Bytes in a base64 string, without decoding it. */
export function base64ByteLength(b64) {
  const s = (b64 || '').toString().replace(/\s+/g, '');
  if (!s) return 0;
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - padding;
}

// `Buffer.from(x, 'base64')` SILENTLY DISCARDS anything that is not base64, so garbage
// in produces shorter garbage out rather than an error — which is how an arbitrary
// string ended up being uploaded to Drive as a "document". Validate the alphabet first.
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function isValidBase64(b64) {
  const s = (b64 || '').toString().replace(/\s+/g, '');
  if (!s || s.length % 4 === 1) return false;
  return BASE64_RE.test(s);
}

// A .docx is a ZIP, so the decoded bytes must start with the local-file-header magic
// `PK\x03\x04`. Nothing checked this: any bytes at all were uploaded to Drive and asked
// to convert, so a bad item cost a full Drive round-trip to discover.
// (`PK\x05\x06` is an EMPTY archive and `PK\x07\x08` is a spanned one — neither is a
// document, and both are rejected by requiring the local-file-header specifically.)
export function looksLikeDocx(bytes) {
  return Boolean(bytes) && bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// The file name reaches Google Drive and comes back on the callback as the stored PDF
// name, which the Worker turns into an R2 key. So it must be a plain file name: no path
// separators, no traversal, no control characters, and a bounded length.
const SAFE_NAME_RE = /^[A-Za-z0-9 ._()\-\u0900-\u097F]+$/; // Devanagari is legitimate here
export const MAX_FILE_NAME_LENGTH = 120;

export function safeFileName(name) {
  const s = (name === undefined || name === null ? '' : name.toString()).trim();
  if (!s || s.length > MAX_FILE_NAME_LENGTH) return null;
  if (s.includes('/') || s.includes('\\') || s.includes('\0')) return null;
  if (s === '.' || s === '..' || s.startsWith('.')) return null;
  if (!/\.docx$/i.test(s)) return null;
  if (!SAFE_NAME_RE.test(s.replace(/\.docx$/i, ''))) return null;
  return s;
}

/**
 * Validates ONE batch item against the contract and returns either the decoded bytes or
 * the reason it was refused. Refusal is per item and never throws: a batch of twenty
 * must not be lost because one record is malformed (that behaviour is unchanged).
 */
export function validateBatchItem(item) {
  const recordId = item && item.recordId;
  if (!recordId) return { ok: false, error: 'missing recordId' };
  if (!item.base64) return { ok: false, error: 'missing base64' };

  const fileName = safeFileName(item.fileName || 'document.docx');
  if (!fileName) return { ok: false, error: 'unsafe or unsupported fileName' };

  if (!isValidBase64(item.base64)) return { ok: false, error: 'base64 is not valid' };

  const declared = base64ByteLength(item.base64);
  if (declared > MAX_ITEM_BYTES) {
    return { ok: false, error: `document is too large (${(declared / 1048576).toFixed(1)} MB; limit ${MAX_ITEM_BYTES / 1048576} MB)` };
  }

  const bytes = Buffer.from(item.base64.toString().replace(/\s+/g, ''), 'base64');
  if (!looksLikeDocx(bytes)) return { ok: false, error: 'not a .docx file (bad ZIP signature)' };

  return { ok: true, recordId, fileName, bytes, declaredBytes: declared };
}
