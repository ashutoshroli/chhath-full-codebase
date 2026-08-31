import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import ImageModule from 'docxtemplater-image-module-free';

// Strips a data:image/...;base64,XXXX prefix if present, otherwise assumes the
// string is already raw base64 (both forms are accepted, since QR_CODE is
// generated as a data-url but a template row could theoretically pass raw).
function base64FromDataUrl(str) {
  const match = /^data:.+;base64,(.*)$/.exec(str || '');
  return match ? match[1] : str;
}

// Enables the {%QR_CODE} image tag in .docx templates. Fixed 100x100px output
// size — the QR itself is generated at a higher resolution (see qrCode.js) so
// it stays sharp when Word/PDF renders it at this size.
//
// IMPORTANT: this must be a fresh instance PER RENDER, not a module-level
// singleton. Docxtemplater refuses to let the same module instance attach to
// more than one Docxtemplater instance ("Cannot attach a module that was
// already attached"), so a shared instance works exactly once per page load
// and then throws on every subsequent render (receipts, reports, auto-PDF-
// on-save, etc.) until the page is reloaded.
function createImageModule() {
  return new ImageModule({
    centered: false,
    getImage: (tagValue) => {
      const b64 = base64FromDataUrl(tagValue);
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    },
    getSize: () => [100, 100],
  });
}

function renderFromZip(zip, data) {
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
    modules: [createImageModule()],
    nullGetter: () => '', // an unrecognized/typo'd {TAG} renders blank instead of crashing the whole document
  });
  doc.render(data);
  return doc.getZip().generate({ type: 'base64', compression: 'DEFLATE' });
}

// Preferred path: template bytes already came from the backend as base64
// (getDocxTemplateForDoc/getDocxTemplatePublic now embed this — see Code.js).
// No network fetch involved, so it can't hit Drive's CORS wall.
export function fillDocxTemplateFromBase64(templateBase64, data) {
  const zip = new PizZip(templateBase64, { base64: true });
  return renderFromZip(zip, data);
}

// Legacy path: fetches the raw .docx bytes from a URL first. Kept only as a
// fallback for old cached template rows that don't have `base64` yet — Google
// Drive's direct-download URL usually fails cross-origin fetch() with
// "Failed to fetch" (no CORS headers on that response), so prefer the base64
// path above whenever the template row has it.
export async function fillDocxTemplate(templateUrl, data) {
  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error('Could not download the template file');
  const arrayBuffer = await res.arrayBuffer();
  const zip = new PizZip(arrayBuffer);
  return renderFromZip(zip, data);
}

// Convenience: pass the template row straight from getDocxTemplateForDoc/
// getDocxTemplatePublic — uses base64 if present, falls back to downloadUrl.
export async function fillDocxTemplateFromRow(templateRow, data) {
  if (templateRow && templateRow.base64) return fillDocxTemplateFromBase64(templateRow.base64, data);
  if (templateRow && templateRow.downloadUrl) return fillDocxTemplate(templateRow.downloadUrl, data);
  throw new Error('Template file not found');
}
