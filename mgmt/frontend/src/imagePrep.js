// ============ Prepare an image before upload ============
//
// Previously `fileToBase64()` sent the file exactly as-is. A modern phone photo
// is 3-8 MB, which grows +33% to 4-11 MB as base64, and the whole thing was sent
// to the Worker in the JSON body. There it was decoded with
// `Uint8Array.from(atob(b64), c => c.charCodeAt(0))` — measured at 552ms CPU for
// 8 MB (15-23x slower than an indexed loop). So a single popup image upload burnt
// over half a second of Worker CPU on decoding alone, and failed outright on
// large photos.
//
// A popup is shown in a modal (max ~320px tall), so there is no benefit to an
// image larger than 1600px. Downscaling + JPEG re-encoding in the browser brings
// the payload down to ~200-400 KB.
//
// Bonus: an iPhone's default HEIC photo can be decoded by canvas in iOS Safari,
// so this converts it to JPEG — otherwise it would upload to Drive but fail to
// render in Chrome/Android (the popup appeared blank).

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', ''];

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be decoded.'));
    img.src = dataUrl;
  });
}

/**
 * Converts a file into upload-ready base64.
 * @returns {{ base64: string, mimeType: string, fileName: string, originalBytes: number, uploadBytes: number, downscaled: boolean }}
 */
export async function prepareImageForUpload(file) {
  if (!file) throw new Error('No file was selected.');

  // GIFs must be left alone: drawing to canvas kills the animation (only the
  // first frame survives). So a GIF is sent exactly as-is.
  const isGif = file.type === 'image/gif';

  if (file.type && !ALLOWED.includes(file.type) && !file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (JPG, PNG, GIF, WebP).');
  }

  const dataUrl = await readAsDataUrl(file);
  const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const originalBytes = file.size || Math.floor((rawBase64.length * 3) / 4);

  const asIs = () => {
    if (originalBytes > MAX_UPLOAD_BYTES) {
      throw new Error(
        `The image is too large (${(originalBytes / 1048576).toFixed(1)} MB). ` +
        `Please use an image smaller than ${(MAX_UPLOAD_BYTES / 1048576).toFixed(0)} MB.`
      );
    }
    return {
      base64: rawBase64, mimeType: file.type || 'image/jpeg', fileName: file.name || 'popup.jpg',
      originalBytes, uploadBytes: originalBytes, downscaled: false,
    };
  };

  if (isGif) return asIs();

  let img;
  try {
    img = await loadImage(dataUrl);
  } catch (e) {
    // HEIC on Chrome/Firefox lands here (they cannot decode HEIC). We send it
    // raw — the backend will reject it with a clear message, which is better than
    // a silently broken image.
    return asIs();
  }

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return asIs();

  const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  let canvasBase64 = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    // JPEG has no transparency — a PNG's transparent background would otherwise
    // turn black. So we fill it white first.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(img, 0, 0, tw, th);
    const out = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    if (out && out.indexOf(',') !== -1) canvasBase64 = out.split(',')[1];
  } catch (e) {
    canvasBase64 = null; // tainted canvas / memory — fallback is below
  }

  if (!canvasBase64) return asIs();

  const uploadBytes = Math.floor((canvasBase64.length * 3) / 4);
  // For very small PNG/WebP files, a JPEG re-encode can actually make them
  // larger. In that case the original is better.
  if (uploadBytes >= originalBytes && originalBytes <= MAX_UPLOAD_BYTES) return asIs();

  const baseName = (file.name || 'popup').replace(/\.[^.]+$/, '');
  return {
    base64: canvasBase64,
    mimeType: 'image/jpeg',
    fileName: `${baseName}.jpg`,
    originalBytes,
    uploadBytes,
    downscaled: scale < 1 || uploadBytes < originalBytes,
  };
}
