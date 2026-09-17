// The server-side QR helper (src/lib/qrCode.js) must produce the SAME record URL
// and the SAME kind of data-URL the browser helper (mgmt/frontend/src/qrCode.js)
// produced, because moving the fill server-side must not change what the QR
// encodes. This pins the URL FORMAT (the byte the two copies must agree on) and
// the data-URL shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateQrDataUrl, publicRecordUrl } from '../src/lib/qrCode.js';

test('publicRecordUrl reproduces the browser format exactly', () => {
  // mgmt/frontend/src/qrCode.js: `${PUBLIC_PORTAL_BASE}?record=${encodeURIComponent(recordId)}`
  assert.equal(
    publicRecordUrl('receipt-2026-5'),
    'https://chhath.shaharpura.com/?record=receipt-2026-5'
  );
  // The recordId is URL-encoded, so a value with characters that must be escaped
  // is encoded the same way the browser encoded it.
  assert.equal(
    publicRecordUrl('consent_loaner-2026-CN 7'),
    'https://chhath.shaharpura.com/?record=consent_loaner-2026-CN%207'
  );
});

test('generateQrDataUrl returns a PNG data-URL for the record link', async () => {
  const dataUrl = await generateQrDataUrl(publicRecordUrl('receipt-2026-5'));
  assert.match(dataUrl, /^data:image\/png;base64,/, 'a PNG data-URL, like the browser produced');
  // Deterministic input -> deterministic output: the same record encodes the same QR.
  const again = await generateQrDataUrl(publicRecordUrl('receipt-2026-5'));
  assert.equal(dataUrl, again, 'the QR for a given record is stable');
  // A different record produces a different QR.
  const other = await generateQrDataUrl(publicRecordUrl('receipt-2026-6'));
  assert.notEqual(dataUrl, other);
});
