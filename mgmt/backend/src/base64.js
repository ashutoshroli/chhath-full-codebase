import { ValidationError } from './auth.js';

// ============ base64 -> bytes ============
//
// Do problems is file ne solve kiye:
//
// 1) SPEED. Teen jagah `Uint8Array.from(atob(b64), c => c.charCodeAt(0))` tha.
//    Woh per-character callback chalata hai, jo indexed loop se 15-23x SLOWER hai
//    (maapa gaya: 8 MB photo => 552ms vs 24ms). Ek phone photo 3-8 MB ki hoti hai,
//    to popup image upload aadha second se zyada CPU akele decode me jala deta tha.
//
// 2) CRASH ON DIRTY INPUT. `atob()` data-URL prefix ("data:image/jpeg;base64,")
//    ya newline milte hi `TypeError: atob() called with invalid base64-encoded
//    data` phenkta hai — production log me iski 4 rows hain (dekho
//    docxTemplates.js ka comment). Ab prefix/whitespace saaf hote hain aur galat
//    input pe user ko samajh aane wala message milta hai, raw TypeError nahi.

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** data-URL prefix aur whitespace hata kar saaf base64 deta hai. */
export function cleanBase64(input, label = 'File') {
  if (input === undefined || input === null || input === '') {
    throw ValidationError(`${label} zaroori hai.`);
  }
  let s = input.toString();
  // "data:image/jpeg;base64,AAAA..." -> "AAAA..."
  const comma = s.indexOf(',');
  if (s.slice(0, 5) === 'data:' && comma !== -1) s = s.slice(comma + 1);
  s = s.replace(/\s+/g, '');           // newlines/spaces (chunked base64)
  s = s.replace(/-/g, '+').replace(/_/g, '/'); // URL-safe variant
  if (!s) throw ValidationError(`${label} khaali hai.`);
  if (s.length % 4 === 1 || !BASE64_RE.test(s)) {
    throw ValidationError(`${label} ka data theek nahi hai (invalid base64). Dobara upload karein.`);
  }
  return s;
}

/** base64 ka asli byte size, decode kiye bina. */
export function base64ByteLength(b64) {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * base64 -> Uint8Array. Fast path (indexed loop, no per-char callback).
 * @param maxBytes agar diya ho to isse bada payload reject hota hai.
 */
export function base64ToBytes(input, { label = 'File', maxBytes = 0 } = {}) {
  const b64 = cleanBase64(input, label);
  if (maxBytes) {
    const size = base64ByteLength(b64);
    if (size > maxBytes) {
      throw ValidationError(
        `${label} bahut badi hai (${(size / 1048576).toFixed(1)} MB). ` +
        `Maximum ${(maxBytes / 1048576).toFixed(1)} MB allowed hai.`
      );
    }
  }
  let raw;
  try {
    raw = atob(b64);
  } catch (e) {
    throw ValidationError(`${label} decode nahi hui (invalid base64). Dobara upload karein.`);
  }
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// ---- Image sniffing ----
// mimeType client se aata hai, to uspe bharosa nahi kiya ja sakta. Asli bytes ke
// magic number se format nikala jata hai. Pehle popup upload me KOI validation
// nahi thi — koi bhi file (PDF, .exe) "image" bankar Drive pe chali jati thi aur
// har user ko login popup me broken image dikhta tha.
const IMAGE_MIME_BY_MAGIC = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/gif',  test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: 'image/webp', test: (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  // HEIC/HEIF (iPhone ka default) — 'ftyp' box @4, brand @8
  { mime: 'image/heic', test: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
];

/** Bytes se asli image mime deta hai, ya null agar image nahi hai. */
export function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 12) return null;
  for (const c of IMAGE_MIME_BY_MAGIC) if (c.test(bytes)) return c.mime;
  return null;
}
