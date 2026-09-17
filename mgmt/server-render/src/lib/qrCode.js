// Server-side QR generator for the Render offload service — a port of the browser
// QR helper mgmt/frontend/src/qrCode.js. It produces the SAME data-URL the browser
// produced for a record's public portal URL, so moving the fill server-side does
// not change what the QR encodes or how it renders.
//
// WHY HERE (and not on the Worker): the QR is pure compute that belongs WITH the
// fill — the docx_render job already has the placeholder set and puts the QR into
// {QR_CODE}. The Worker resolves the template and DERIVES the recordId (P0-03), so
// the recordId this QR encodes is the authoritative one; it is passed in the
// dispatch payload as `recordId`, never trusted from a browser. Generating it on
// Render (alongside the fill) keeps the QR off the Worker's subrequest/CPU budget,
// exactly the reason this service exists.
//
// KEEP THE URL FORMAT IN SYNC with mgmt/frontend/src/qrCode.js — publicRecordUrl()
// there is `${PUBLIC_PORTAL_BASE}?record=${encodeURIComponent(recordId)}` and the
// QR options are { width: sizePx (300), margin: 1 }. Reproduced byte-for-byte here
// so a receipt filled on Render carries the identical QR to one filled in the
// browser.

import QRCode from 'qrcode';

const PUBLIC_PORTAL_BASE = 'https://chhath.shaharpura.com/';

export function publicRecordUrl(recordId) {
  return `${PUBLIC_PORTAL_BASE}?record=${encodeURIComponent(recordId)}`;
}

export async function generateQrDataUrl(url, sizePx = 300) {
  return QRCode.toDataURL(url, { width: sizePx, margin: 1 });
}
