// Ported verbatim from mgmt/frontend/src/qrCode.js — builds the public-portal
// record URL and renders it as a QR data-URL (lazy-imported via safeImport).
import QRCode from 'qrcode';

const PUBLIC_PORTAL_BASE = 'https://chhath.shaharpura.com/';

export function publicRecordUrl(recordId: string): string {
  return `${PUBLIC_PORTAL_BASE}?record=${encodeURIComponent(recordId)}`;
}

export async function generateQrDataUrl(url: string, sizePx = 300): Promise<string> {
  return QRCode.toDataURL(url, { width: sizePx, margin: 1 });
}
