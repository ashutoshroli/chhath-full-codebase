export function renderReceiptTemplate(templateText, placeholders) {
  const withConditionals = (templateText || '').replace(
    /\{\{#IF\s+([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/IF\}\}/g,
    (match, key, inner) => (placeholders[key] ? inner : '')
  );
  return withConditionals.replace(/\[([A-Z0-9_]+)\]/g, (m, key) => (placeholders[key] !== undefined ? String(placeholders[key]) : m));
}

export const PAGE_SIZES_MM = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
};
