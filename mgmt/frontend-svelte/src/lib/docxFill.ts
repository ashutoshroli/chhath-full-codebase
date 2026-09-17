// Ported verbatim from mgmt/frontend/src/docxFill.js — fills a DOCX template
// (base64 or URL) with placeholder data via docxtemplater + an image module,
// tracking missing tags/images. Lazy-imported via safeImport.
//
// DEPRECATED for the BULK + AUTO paths (FEAT-003 + FEAT-004): those now FILL
// server-side on Render. The ONLY remaining production caller is the public,
// token-gated CONSENT download (ConsentPdfDownload.svelte), which lazy-imports this
// so docxtemplater/pizzip/image-module stay in a lazy chunk, never in the main bundle.
// Delete this file once the consent path also moves server-side.
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
// docxtemplater-image-module-free ships no types.
// @ts-expect-error — no type declarations for this module.
import ImageModule from 'docxtemplater-image-module-free';

interface RenderReport {
  missingTags: string[];
  missingImages: string[];
}

export interface TemplateRow {
  base64?: string;
  downloadUrl?: string;
}

function base64FromDataUrl(str: string): string {
  const match = /^data:.+;base64,(.*)$/.exec(str || '');
  return match ? match[1] : str;
}

const BLANK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function base64ToBytes(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function createImageModule(report: RenderReport) {
  return new ImageModule({
    centered: false,
    getImage: (tagValue: string, tagName: string) => {
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
    getSize: () => [100, 100]
  });
}

let lastRenderReport: RenderReport = { missingTags: [], missingImages: [] };
export function getLastRenderReport(): RenderReport {
  return { missingTags: [...lastRenderReport.missingTags], missingImages: [...lastRenderReport.missingImages] };
}

function renderFromZip(zip: PizZip, data: Record<string, unknown>): string {
  const report: RenderReport = { missingTags: [], missingImages: [] };
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
    modules: [createImageModule(report)],
    nullGetter: (part: any) => {
      if (part && part.value) report.missingTags.push(part.value);
      return '';
    }
  });
  doc.render(data);
  lastRenderReport = report;
  return doc.getZip().generate({ type: 'base64', compression: 'DEFLATE' }) as string;
}

export function fillDocxTemplateFromBase64(templateBase64: string, data: Record<string, unknown>): string {
  const zip = new PizZip(templateBase64, { base64: true });
  return renderFromZip(zip, data);
}

export async function fillDocxTemplate(templateUrl: string, data: Record<string, unknown>): Promise<string> {
  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error('Could not download the template file');
  const arrayBuffer = await res.arrayBuffer();
  const zip = new PizZip(arrayBuffer);
  return renderFromZip(zip, data);
}

export async function fillDocxTemplateFromRow(templateRow: TemplateRow, data: Record<string, unknown>): Promise<string> {
  if (templateRow && templateRow.base64) return fillDocxTemplateFromBase64(templateRow.base64, data);
  if (templateRow && templateRow.downloadUrl) return fillDocxTemplate(templateRow.downloadUrl, data);
  throw new Error('Template file not found');
}
