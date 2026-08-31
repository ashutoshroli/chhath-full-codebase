import QRCode from 'qrcode';

// Public portal base — every generated document's QR points back here with a
// ?record= query param so the portal can look up and display that exact record.
const PUBLIC_PORTAL_BASE = 'https://chhath.shaharpura.com/';

// Builds the URL a document's QR code should point to. recordId matches the
// same recordId scheme already used for Download Center / GENERATED_FILES,
// e.g. "receipt-2026-42", "samaan-2026-7", "consent_guarantor-2026-LC-9".
export function publicRecordUrl(recordId) {
  return `${PUBLIC_PORTAL_BASE}?record=${encodeURIComponent(recordId)}`;
}

// Returns a data:image/png;base64,... string — usable directly as an <img src>
// in the Markdown/HTML receipt templates, and also accepted by the docx image
// module (fillDocxTemplateFromBase64 strips the data-url prefix itself).
export async function generateQrDataUrl(url, sizePx = 300) {
  return QRCode.toDataURL(url, { width: sizePx, margin: 1 });
}
