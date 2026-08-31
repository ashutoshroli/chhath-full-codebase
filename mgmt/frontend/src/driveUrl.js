// ============ Google Drive image URL ============
//
// ASLI BUG (browser me image kabhi dikhti hi nahi thi):
//
// `https://drive.google.com/uc?export=view&id=<ID>` ek **303 redirect** hai
// `https://drive.usercontent.google.com/download?...` pe, aur us final response me
// ye headers hote hain:
//
//     cross-origin-resource-policy: same-site
//     cross-origin-embedder-policy: require-corp
//
// `CORP: same-site` ka matlab — browser is resource ko **kisi doosri site se embed
// hone par BLOCK kar deta hai**. Hamari site (mgmt-chhath / chhath.shaharpura.com)
// `drive.usercontent.google.com` ke saath same-site nahi hai, to `<img src>` chup
// chaap fail ho jata tha.
//
// Isko `curl` se pakadna namumkin tha: curl CORP enforce nahi karta, sirf browser
// karta hai. curl 200 + `image/jpeg` deta hai, isliye pehla test "sab theek hai"
// bata raha tha jabki browser me kuch nahi dikh raha tha.
//
// Maapa gaya (Referer: https://chhath.shaharpura.com/ ke saath):
//
//   uc?export=view          -> 303 -> drive.usercontent... | CORP same-site | BLOCK
//   lh3.googleusercontent.com/d/<ID>  | ACAO * | CORP header nahi | CHALTA HAI
//   drive.google.com/thumbnail?id=..  | ACAO * | CORP header nahi | CHALTA HAI
//
// Isliye ab `lh3.googleusercontent.com/d/<ID>` use karte hain — woh Google ka image
// CDN hai, embedding ke liye hi bana hai. `=w1600` suffix size control deta hai
// (bina suffix woh apne hisaab se chhota kar deta hai; verify kiya: =w1600 pe
// original 1080x2273 poora aata hai).

const DEFAULT_WIDTH = 1600;

// Drive ke saare URL form jinme file ID aata hai.
const ID_PATTERNS = [
  /\/file\/d\/([A-Za-z0-9_-]{10,})/,            // .../file/d/<id>/view
  /lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]{10,})/, // pehle se theek
  /[?&]id=([A-Za-z0-9_-]{10,})/,                // uc?export=view&id=, thumbnail?id=, open?id=
  /\/d\/([A-Za-z0-9_-]{10,})/,                  // generic /d/<id>
];

/** Kisi bhi Drive URL me se file ID nikalta hai, warna null. */
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
 * Drive URL ko browser me embed hone wale form me badalta hai.
 * Non-Drive URL waisa hi wapas aata hai (custom CDN link chalti rahe).
 */
export function driveImageUrl(url, width = DEFAULT_WIDTH) {
  const id = driveFileId(url);
  if (!id) return url;
  return `https://lh3.googleusercontent.com/d/${id}=w${width}`;
}

/**
 * Agar lh3 kisi wajah se fail ho jaye to ye doosra CORP-free endpoint hai.
 * `<img onError>` me use karo.
 */
export function driveImageFallbackUrl(url, width = DEFAULT_WIDTH) {
  const id = driveFileId(url);
  if (!id) return null;
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`;
}

/**
 * `<img>` ke liye ready-made onError handler: pehle thumbnail try karta hai,
 * uske baad haar maan leta hai (infinite loop se bachne ke liye flag).
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
