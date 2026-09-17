// Server-side DOCX renderer for the Render offload service — a port of the browser
// renderer mgmt/frontend/src/docxFill.js (byte-identical to
// mgmt/frontend-svelte/src/lib/docxFill.ts). It fills a .docx TEMPLATE with data
// and reports which tags/images could not be resolved.
//
// It reproduces the browser renderer EXACTLY so its output is byte-for-byte
// identical (proven by the golden-fixture parity test in test/docxRender.test.mjs):
//   - delimiters { start: '{', end: '}' }
//   - paragraphLoop: true, linebreaks: true
//   - the image module (centered:false, getSize ()=>[100,100]) with getImage doing
//     base64FromDataUrl then falling back to the 1x1 BLANK_PNG on an empty/throwing
//     value and recording the tag in missingImages
//   - a nullGetter that records the unresolved tag's value and renders it blank
//
// TWO DELIBERATE DIFFERENCES FROM THE BROWSER RENDERER:
//
//  1. NO MODULE-LEVEL REPORT SINGLETON. docxFill.js keeps `lastRenderReport` at
//     module scope and exposes getLastRenderReport(). On Render the process runs
//     up to config.jobsMaxConcurrent (=3) jobs at once, all sharing this module,
//     so a shared report is a data race: job A's getLastRenderReport() could return
//     job B's missing tags. Here the report travels WITH the result — fillDocxTemplate*
//     RETURNS { filledBase64, report } — so each concurrent fill carries its own.
//
//  2. Node Buffer instead of the browser atob/Uint8Array for base64<->bytes.

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import ImageModule from 'docxtemplater-image-module-free';

function base64FromDataUrl(str) {
  const match = /^data:.+;base64,(.*)$/.exec(str || '');
  return match ? match[1] : str;
}

const BLANK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Browser docxFill.js returns an ArrayBuffer here (base64ToBytes). On Node a
// Buffer is a Uint8Array view and is what the image module expects; returning the
// Buffer directly yields byte-identical output.
function base64ToBytes(b64) {
  return Buffer.from(b64, 'base64');
}

function createImageModule(report) {
  return new ImageModule({
    centered: false,
    getImage: (tagValue, tagName) => {
      const b64 = base64FromDataUrl(tagValue);
      if (!b64) {
        if (report) report.missingImages.push(tagName || 'unknown');
        return base64ToBytes(BLANK_PNG_B64);
      }
      try {
        return base64ToBytes(b64);
      } catch (e) {
        if (report) report.missingImages.push(tagName || 'unknown');
        return base64ToBytes(BLANK_PNG_B64);
      }
    },
    getSize: () => [100, 100],
  });
}

function renderFromZip(zip, data) {
  const report = { missingTags: [], missingImages: [] };
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
    modules: [createImageModule(report)],
    nullGetter: (part) => {
      if (part && part.value) report.missingTags.push(part.value);
      return '';
    },
  });
  doc.render(data);
  const filledBase64 = doc
    .getZip()
    .generate({ type: 'base64', compression: 'DEFLATE' });
  return { filledBase64, report };
}

// Fill a template supplied as base64. Returns { filledBase64, report } where
// report = { missingTags, missingImages }. No module-level state.
export function fillDocxTemplateFromBase64(templateBase64, data) {
  const zip = new PizZip(templateBase64, { base64: true });
  return renderFromZip(zip, data);
}

// Fill a template supplied as raw bytes (Buffer / Uint8Array / ArrayBuffer).
export function fillDocxTemplateFromBytes(templateBytes, data) {
  const zip = new PizZip(templateBytes);
  return renderFromZip(zip, data);
}
