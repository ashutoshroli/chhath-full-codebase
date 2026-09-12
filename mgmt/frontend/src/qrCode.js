import QRCode from 'qrcode';

const PUBLIC_PORTAL_BASE = 'https://chhath.shaharpura.com/';

export function publicRecordUrl(recordId) {
  return `${PUBLIC_PORTAL_BASE}?record=${encodeURIComponent(recordId)}`;
}

export async function generateQrDataUrl(url, sizePx = 300) {
  return QRCode.toDataURL(url, { width: sizePx, margin: 1 });
}
