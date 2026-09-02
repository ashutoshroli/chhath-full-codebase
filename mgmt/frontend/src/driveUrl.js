// ============ Google Drive image URL ============
//
// THE ROOT CAUSE (the image never displayed in the browser):
//
// `https://drive.google.com/uc?export=view&id=<ID>` is a **303 redirect** to
// `https://drive.usercontent.google.com/download?...`, and that final response
// carries these headers:
//
//     cross-origin-resource-policy: same-site
//     cross-origin-embedder-policy: require-corp
//
// `CORP: same-site` means the browser **BLOCKS the resource from being embedded
// by any other site**. Our site (mgmt-chhath / chhath.shaharpura.com) is not
// same-site with `drive.usercontent.google.com`, so `<img src>` failed silently.
//
// This was impossible to catch with `curl`: curl does not enforce CORP, only the
// browser does. curl returns 200 + `image/jpeg`, so the first test reported
// "everything is fine" while nothing showed in the browser.
//
// Measured (with Referer: https://chhath.shaharpura.com/):
//
//   uc?export=view          -> 303 -> drive.usercontent... | CORP same-site | BLOCKED
//   lh3.googleusercontent.com/d/<ID>  | ACAO * | no CORP header | WORKS
//   drive.google.com/thumbnail?id=..  | ACAO * | no CORP header | WORKS
//
// So we now use `lh3.googleusercontent.com/d/<ID>` — Google's image CDN, built
// for embedding. The `=w1600` suffix controls size (without a suffix it shrinks
// the image on its own; verified: at =w1600 the original 1080x2273 comes through
// in full).

const DEFAULT_WIDTH = 1600;

// All Drive URL forms that contain a file ID.
const ID_PATTERNS = [
  /\/file\/d\/([A-Za-z0-9_-]{10,})/,            // .../file/d/<id>/view
  /lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]{10,})/, // already correct
  /[?&]id=([A-Za-z0-9_-]{10,})/,                // uc?export=view&id=, thumbnail?id=, open?id=
  /\/d\/([A-Za-z0-9_-]{10,})/,                  // generic /d/<id>
];

/** Extracts the file ID from any Drive URL, or null if none. */
export function driveFileId(url) {
  const s = (url === undefined || url === null) ? '' : url.toString();
  if (!s) return null;
  for (const re of ID_PATTERNS) {
    const m = re.exec(s);
    if (m) return m[1];
  }
  return null;
}

/**
 * Converts a Drive URL into a browser-embeddable form.
 * A non-Drive URL is returned unchanged (so custom CDN links keep working).
 */
export function driveImageUrl(url, width = DEFAULT_WIDTH) {
  const id = driveFileId(url);
  if (!id) return url;
  return `https://lh3.googleusercontent.com/d/${id}=w${width}`;
}

/**
 * If lh3 fails for any reason, this is a second CORP-free endpoint.
 * Use it in `<img onError>`.
 */
export function driveImageFallbackUrl(url, width = DEFAULT_WIDTH) {
  const id = driveFileId(url);
  if (!id) return null;
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`;
}

/**
 * A ready-made onError handler for `<img>`: it first tries the thumbnail
 * endpoint, then gives up (a flag prevents an infinite loop).
 */
export function driveImgOnError(originalUrl, width = DEFAULT_WIDTH) {
  return (e) => {
    const img = e.currentTarget;
    if (img.dataset.driveFallbackTried === '1') return;
    const fb = driveImageFallbackUrl(originalUrl, width);
    if (!fb || fb === img.src) return;
    img.dataset.driveFallbackTried = '1';
    img.src = fb;
  };
}
