import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import ImageModule from 'docxtemplater-image-module-free';

function base64FromDataUrl(str) {
  const match = /^data:.+;base64,(.*)$/.exec(str || '');
  return match ? match[1] : str;
}

const BLANK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
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

let lastRenderReport = { missingTags: [], missingImages: [] };
export function getLastRenderReport() {
  return { missingTags: [...lastRenderReport.missingTags], missingImages: [...lastRenderReport.missingImages] };
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
  lastRenderReport = report;
  return doc.getZip().generate({ type: 'base64', compression: 'DEFLATE' });
}

export function fillDocxTemplateFromBase64(templateBase64, data) {
  const zip = new PizZip(templateBase64, { base64: true });
  return renderFromZip(zip, data);
}

export async function fillDocxTemplate(templateUrl, data) {
  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error('Could not download the template file');
  const arrayBuffer = await res.arrayBuffer();
  const zip = new PizZip(arrayBuffer);
  return renderFromZip(zip, data);
}

export async function fillDocxTemplateFromRow(templateRow, data) {
  if (templateRow && templateRow.base64) return fillDocxTemplateFromBase64(templateRow.base64, data);
  if (templateRow && templateRow.downloadUrl) return fillDocxTemplate(templateRow.downloadUrl, data);
  throw new Error('Template file not found');
}
