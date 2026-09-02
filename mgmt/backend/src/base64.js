import { ValidationError } from './auth.js';

// ============ base64 -> bytes ============
//
// This file solves two problems:
//
// 1) SPEED. Three places used `Uint8Array.from(atob(b64), c => c.charCodeAt(0))`.
//    That runs a per-character callback, which is 15-23x SLOWER than an indexed
//    loop (measured: 8 MB photo => 552ms vs 24ms). A phone photo is 3-8 MB, so a
//    popup image upload was burning more than half a second of CPU on decoding alone.
//
// 2) CRASH ON DIRTY INPUT. As soon as `atob()` encounters a data-URL prefix
//    ("data:image/jpeg;base64,") or a newline it throws
//    `TypeError: atob() called with invalid base64-encoded data` — there are 4
//    rows of this in the production log (see the comment in docxTemplates.js). Now
//    the prefix/whitespace is stripped and invalid input gives the user an
//    understandable message rather than a raw TypeError.

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Returns clean base64 with the data-URL prefix and whitespace removed. */
export function cleanBase64(input, label = 'File') {
  if (input === undefined || input === null || input === '') {
    throw ValidationError(`${label} is required.`);
  }
  let s = input.toString();
  // "data:image/jpeg;base64,AAAA..." -> "AAAA..."
  const comma = s.indexOf(',');
  if (s.slice(0, 5) === 'data:' && comma !== -1) s = s.slice(comma + 1);
  s = s.replace(/\s+/g, '');           // newlines/spaces (chunked base64)
  s = s.replace(/-/g, '+').replace(/_/g, '/'); // URL-safe variant
  if (!s) throw ValidationError(`${label} is empty.`);
  if (s.length % 4 === 1 || !BASE64_RE.test(s)) {
    throw ValidationError(`${label} data is not valid (invalid base64). Please upload again.`);
  }
  return s;
}

/** Returns the actual byte size of base64, without decoding. */
export function base64ByteLength(b64) {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * base64 -> Uint8Array. Fast path (indexed loop, no per-char callback).
 * @param maxBytes if provided, a payload larger than this is rejected.
 */
export function base64ToBytes(input, { label = 'File', maxBytes = 0 } = {}) {
  const b64 = cleanBase64(input, label);
  if (maxBytes) {
    const size = base64ByteLength(b64);
    if (size > maxBytes) {
      throw ValidationError(
        `${label} is too large (${(size / 1048576).toFixed(1)} MB). ` +
        `Maximum allowed is ${(maxBytes / 1048576).toFixed(1)} MB.`
      );
    }
  }
  let raw;
  try {
    raw = atob(b64);
  } catch (e) {
    throw ValidationError(`${label} could not be decoded (invalid base64). Please upload again.`);
  }
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// ---- Image sniffing ----
// mimeType comes from the client, so it cannot be trusted. The real format is
// derived from the magic number in the actual bytes. Previously the popup upload
// had NO validation — any file (PDF, .exe) could go to Drive as an "image", and
// every user then saw a broken image in the login popup.
const IMAGE_MIME_BY_MAGIC = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/gif',  test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: 'image/webp', test: (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  // HEIC/HEIF (iPhone default) — 'ftyp' box @4, brand @8
  { mime: 'image/heic', test: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
];

/** Returns the real image mime from the bytes, or null if it is not an image. */
export function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 12) return null;
  for (const c of IMAGE_MIME_BY_MAGIC) if (c.test(bytes)) return c.mime;
  return null;
}
