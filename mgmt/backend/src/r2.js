// ============ R2 OBJECT STORAGE ============
//
// New uploads (consent photos/signatures, generated PDFs, popup images) go to a
// Cloudflare R2 bucket instead of Google Drive. R2 has zero egress fees, no Drive
// API rate limits, and lives right next to the Worker — so images/PDFs serve
// faster and the "atob/Drive" failure class in the error log goes away.
//
// LAYOUT (year-wise, mirrors the old Drive "Generated PDFs/<type>/<year>/"):
//   <year>/pdf/<docType>/<name>.pdf         generated PDFs
//   <year>/consent/<name>.jpg               consent photos & signatures
//   popups/<name>.<ext>                     popup images (NO year — never moved)
//
// The year prefix is what makes the Superadmin "Move <year> to Drive" feature a
// simple prefix listing (see storage.js).
//
// PUBLIC ACCESS: files are served from a public R2 custom domain configured as
// env.R2_PUBLIC_BASE (e.g. "https://files-chhath.shaharpura.com"). The public
// URL of an object is `${R2_PUBLIC_BASE}/${key}`.
//
// GRACEFUL FALLBACK: if the R2 binding (env.R2_FILES) or R2_PUBLIC_BASE is not
// configured, r2Available(env) returns false and every caller falls back to the
// existing Drive path — so deploying this code BEFORE creating the bucket does
// not break anything.

// True only when both the bucket binding AND the public base URL are configured.
export function r2Available(env) {
  return !!(env && env.R2_FILES && env.R2_PUBLIC_BASE && env.R2_PUBLIC_BASE.toString().trim());
}

// Base without a trailing slash.
function publicBase(env) {
  return (env.R2_PUBLIC_BASE || '').toString().trim().replace(/\/+$/, '');
}

// Full public URL for a stored key.
export function r2PublicUrl(env, key) {
  return `${publicBase(env)}/${key.replace(/^\/+/, '')}`;
}

// True when a stored URL points at our R2 public domain (vs a legacy Drive URL).
// Used by the move/delete paths to tell R2 objects apart from Drive files.
export function isR2Url(env, url) {
  if (!url) return false;
  const base = publicBase(env);
  return !!base && url.toString().startsWith(base + '/');
}

// Extract the object key back out of a public URL (inverse of r2PublicUrl).
export function keyFromR2Url(env, url) {
  if (!isR2Url(env, url)) return null;
  const base = publicBase(env);
  return url.toString().slice(base.length + 1); // drop "base/"
}

// Sanitize a filename into a safe key segment.
function safeName(name, fallback) {
  // The old pattern `[^\w.\-]+` treats `\w` as ASCII-only ([A-Za-z0-9_]), so a
  // Devanagari filename (e.g. a member's Hindi name) had EVERY character stripped
  // and collapsed to the fallback ('file'), making distinct uploads share one
  // key. Use a Unicode-aware class so Hindi and other scripts are preserved:
  //   \p{L} letters, \p{N} digits, and crucially \p{M} combining MARKS — Indic
  //   scripts write vowels as combining marks (e.g. the "े" in "रमेश"), so without
  //   \p{M} the name is mangled rather than dropped. Path separators, whitespace
  //   and control characters are still replaced with '_', which is what keeps the
  //   R2 key layout (year/subdir/name) intact — a "/" can never survive, so path
  //   traversal is impossible regardless of dots. `/u` enables the property
  //   escapes. Leading/trailing separators are trimmed.
  const s = (name || '').toString().trim()
    .replace(/[^\p{L}\p{M}\p{N}.\-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return s || fallback;
}

// ---- Key builders (single source of truth for the layout) ----

// Year-wise key under a subdir, e.g. keyForYear(2026, 'consent', 'photo_CN1.jpg')
// -> "2026/consent/photo_CN1.jpg". docType (optional) adds a nesting level for
// PDFs: keyForYear(2026, 'pdf', 'receipt-2026-45.pdf', 'receipt')
// -> "2026/pdf/receipt/receipt-2026-45.pdf".
export function keyForYear(year, subdir, fileName, docType) {
  const y = parseInt(year);
  const yr = Number.isFinite(y) && y > 0 ? String(y) : 'unknown-year';
  const parts = [yr, subdir];
  if (docType) parts.push(safeName(docType, 'misc'));
  parts.push(safeName(fileName, 'file'));
  return parts.join('/');
}

// Popup key (no year — popups are year-independent and never moved to Drive).
export function keyForPopup(fileName) {
  return `popups/${Date.now()}_${safeName(fileName, 'popup.jpg')}`;
}

// SEO / social link-preview image key (no year — a single site-wide preview
// image, never moved to Drive by the "Move year" feature).
export function keyForSeo(fileName) {
  return `seo/${Date.now()}_${safeName(fileName, 'preview.jpg')}`;
}

// User profile-picture key (no year — a member's photo is not tied to a Chhath
// year, and it is never moved to Drive by the "Move year" feature). The id_code
// (e.g. "USER0007") groups a person's uploads; the timestamp keeps each new photo
// a distinct object so a stale CDN copy is never served after a re-upload.
export function keyForUserPhoto(idCode, fileName) {
  const who = safeName(idCode, 'user');
  return `users/${who}_${Date.now()}_${safeName(fileName, 'photo.jpg')}`;
}

// The year prefix used by the move feature, e.g. "2026/".
export function yearPrefix(year) {
  const y = parseInt(year);
  return (Number.isFinite(y) && y > 0 ? String(y) : 'unknown-year') + '/';
}

// ---- R2 operations (all no-throw-friendly; callers handle the fallback) ----

// Stores bytes at `key`. Returns the public URL.
export async function putToR2(env, key, bytes, contentType) {
  await env.R2_FILES.put(key, bytes, {
    httpMetadata: { contentType: contentType || 'application/octet-stream' },
  });
  return r2PublicUrl(env, key);
}

// Reads an object back as an ArrayBuffer (used by the R2->Drive move). Returns
// null if the object is missing.
export async function getFromR2(env, key) {
  const obj = await env.R2_FILES.get(key);
  if (!obj) return null;
  const buf = await obj.arrayBuffer();
  return { buffer: buf, contentType: (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream' };
}

export async function deleteFromR2(env, key) {
  await env.R2_FILES.delete(key);
}

// Lists every object key under a prefix (handles pagination / >1000 objects).
export async function listR2ByPrefix(env, prefix) {
  const keys = [];
  let cursor;
  do {
    const res = await env.R2_FILES.list({ prefix, cursor, limit: 1000 });
    for (const o of res.objects || []) keys.push({ key: o.key, size: o.size });
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return keys;
}
