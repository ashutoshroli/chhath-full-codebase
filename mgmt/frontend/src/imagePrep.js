
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

export async function prepareImageForUpload(file) {
  if (!file) throw new Error('No file was selected.');

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
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(img, 0, 0, tw, th);
    const out = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    if (out && out.indexOf(',') !== -1) canvasBase64 = out.split(',')[1];
  } catch (e) {
    canvasBase64 = null;
  }

  if (!canvasBase64) return asIs();

  const uploadBytes = Math.floor((canvasBase64.length * 3) / 4);
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
