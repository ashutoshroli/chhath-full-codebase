// ============ Upload se pehle image ko taiyaar karna ============
//
// Pehle `fileToBase64()` file ko jaisi hai waisi hi bhej deta tha. Ek aaj ke phone
// ki photo 3-8 MB hoti hai, jo base64 me +33% badh kar 4-11 MB ho jati hai, aur
// woh poora JSON body me Worker tak jata tha. Wahan uska decode
// `Uint8Array.from(atob(b64), c => c.charCodeAt(0))` se hota tha — maapa gaya
// 8 MB pe 552ms CPU (indexed loop se 15-23x slower). Yani ek popup image upload
// aadha second se zyada Worker CPU akele decode me jalata tha, aur badi photo pe
// fail ho jata tha.
//
// Popup ek modal me dikhta hai (max ~320px tall), to 1600px se badi image ka koi
// fayda hi nahi hai. Browser me downscale + JPEG re-encode karne se payload
// ~200-400 KB reh jata hai.
//
// Ek bonus: iPhone ki default HEIC photo iOS Safari me canvas se decode ho jati
// hai, to ye usko JPEG bana deta hai — warna woh Drive pe chadh kar Chrome/
// Android me render hi nahi hoti (popup khaali dikhta tha).

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', ''];

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('File padhi nahi ja saki.'));
    r.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode nahi hui.'));
    img.src = dataUrl;
  });
}

/**
 * File ko upload-ready base64 me badalta hai.
 * @returns {{ base64: string, mimeType: string, fileName: string, originalBytes: number, uploadBytes: number, downscaled: boolean }}
 */
export async function prepareImageForUpload(file) {
  if (!file) throw new Error('Koi file select nahi hui.');

  // GIF ko chhodna zaroori hai: canvas pe draw karne se animation mar jati hai
  // (sirf pehla frame bachta hai). Isliye GIF jaisi hai waisi hi jati hai.
  const isGif = file.type === 'image/gif';

  if (file.type && !ALLOWED.includes(file.type) && !file.type.startsWith('image/')) {
    throw new Error('Sirf image file chunein (JPG, PNG, GIF, WebP).');
  }

  const dataUrl = await readAsDataUrl(file);
  const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const originalBytes = file.size || Math.floor((rawBase64.length * 3) / 4);

  const asIs = () => {
    if (originalBytes > MAX_UPLOAD_BYTES) {
      throw new Error(
        `Image bahut badi hai (${(originalBytes / 1048576).toFixed(1)} MB). ` +
        `${(MAX_UPLOAD_BYTES / 1048576).toFixed(0)} MB se chhoti image use karein.`
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
    // HEIC on Chrome/Firefox lands here (woh HEIC decode nahi kar paate). Raw
    // bhej dete hain — backend saaf message ke saath reject karega, jo chupchap
    // toote image se behtar hai.
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
    // JPEG me transparency nahi hoti — PNG ka transparent background warna kaala
    // ho jata. Pehle safed bhar dete hain.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(img, 0, 0, tw, th);
    const out = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    if (out && out.indexOf(',') !== -1) canvasBase64 = out.split(',')[1];
  } catch (e) {
    canvasBase64 = null; // tainted canvas / memory — neeche fallback hai
  }

  if (!canvasBase64) return asIs();

  const uploadBytes = Math.floor((canvasBase64.length * 3) / 4);
  // Bahut chhoti PNG/WebP par JPEG re-encode ulta bada bana sakta hai. Aisi
  // haalat me original hi behtar hai.
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
