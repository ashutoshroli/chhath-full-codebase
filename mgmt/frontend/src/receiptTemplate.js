// Template syntax:
//   {{#IF KEY}} ... [KEY] ... {{/IF}}   — block is dropped entirely if placeholders[KEY] is empty/undefined
//   [KEY]                                — replaced with placeholders[KEY] (outside or inside a block)
//
// This same function is called for both the on-screen preview and the DOM node
// that html2canvas snapshots for the PDF — so the two can never drift apart.
export function renderReceiptTemplate(templateText, placeholders) {
  const withConditionals = (templateText || '').replace(
    /\{\{#IF\s+([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/IF\}\}/g,
    (match, key, inner) => (placeholders[key] ? inner : '')
  );
  return withConditionals.replace(/\[([A-Z0-9_]+)\]/g, (m, key) => (placeholders[key] !== undefined ? String(placeholders[key]) : m));
}

// A5 = 148mm x 210mm, A4 = 210mm x 297mm — used both for the preview container's
// aspect ratio and the PDF page size, so what you see is what you get.
export const PAGE_SIZES_MM = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
};
