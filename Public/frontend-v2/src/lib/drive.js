// Google Drive image-URL helpers — framework-free, ported VERBATIM from
// Public/frontend/script.js so both portals share identical behaviour.
//
// WHY THIS EXISTS
// Popup images (and any other Drive-hosted image the portal may show) are often
// saved as the Drive VIEWER page URL (.../file/d/<id>/view), which is an HTML
// document and renders as a broken image when placed in an <img src>. These
// helpers extract the file id and rewrite it to a directly-embeddable image URL.
//
// `uc?export=view` does a 303 redirect to drive.usercontent.google.com, which
// returns `cross-origin-resource-policy: same-site` — i.e. the browser BLOCKS it
// from being embedded by another site, and the image silently appears blank.
// `lh3.googleusercontent.com` is Google's image CDN (ACAO *, no CORP), so we
// prefer it; the drive.google.com/thumbnail form is the fallback.
//
// These are factored into this pure module (rather than left inline in an .astro
// island) so the porting-sensitive id-extraction regexes are node --check-able
// and unit-tested — see test/drive.test.mjs.

// Extract the Drive file id from any of the common URL shapes. Returns the id
// string, or null when the input carries no recognisable id.
export function driveFileId(url) {
  const s = (url === undefined || url === null) ? '' : url.toString();
  if (!s) return null;
  var pats = [
    /\/file\/d\/([A-Za-z0-9_-]{10,})/,
    /lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]{10,})/,
    /[?&]id=([A-Za-z0-9_-]{10,})/,
    /\/d\/([A-Za-z0-9_-]{10,})/,
  ];
  for (var i = 0; i < pats.length; i++) {
    var m = pats[i].exec(s);
    if (m) return m[1];
  }
  return null;
}

// Preferred embeddable image URL via Google's image CDN (lh3). Falls back to the
// original URL when no id can be extracted, so a non-Drive URL passes through
// untouched.
export function driveImageUrl(url) {
  var id = driveFileId(url);
  return id ? 'https://lh3.googleusercontent.com/d/' + id + '=w1600' : url;
}

// Fallback embeddable image URL via the drive.google.com thumbnail endpoint,
// used when the lh3 CDN URL fails to load. Returns '' when no id is present.
export function driveImageFallbackUrl(url) {
  var id = driveFileId(url);
  return id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600' : '';
}
