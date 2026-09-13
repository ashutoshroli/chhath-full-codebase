// ============ DONATION UPI-QR IMAGE UPLOAD (R2-only) ============
//
// Uploads the committee's UPI QR image to the R2 bucket and returns its PUBLIC
// URL, which the caller stores in the portal_settings key `donation_qr_url` (via
// setPortalSetting from the mgmt "Donation" tab). The public "Donate Now" page
// reads that URL and renders the QR; when it is empty the QR block is hidden.
//
// R2-ONLY: like the user-photo uploader, this path has NO Google Drive fallback —
// if R2 is not configured we return a clear, actionable error rather than
// silently writing somewhere else.
//
// SECURITY: staff-only (Admin/Superadmin), same gate as the other upload actions.
// The client-supplied mimeType is NOT trusted — the real format is sniffed from
// the bytes, and anything that isn't a browser-displayable image is rejected.
import { requireAdminOrAbove, ValidationError } from './auth.js';
import { base64ToBytes, sniffImageMime, MAX_IMAGE_UPLOAD_BYTES } from './base64.js';
import { r2Available, putToR2, keyForDonationQr } from './r2.js';

export async function uploadDonationQr(env, base64, fileName, user) {
  requireAdminOrAbove(user);

  // R2-only: no Drive fallback. Fail loudly and helpfully if it isn't set up.
  if (!r2Available(env)) {
    throw ValidationError(
      'QR upload is not available: the R2 storage bucket is not configured on the server ' +
      '(R2_FILES binding and R2_PUBLIC_BASE). Ask an administrator to set it up.'
    );
  }

  // Decode with the shared image cap (rejects oversized/dirty payloads).
  const bytes = base64ToBytes(base64, { label: 'QR image', maxBytes: MAX_IMAGE_UPLOAD_BYTES });

  // Trust the bytes, not the client mimeType.
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) {
    throw ValidationError('That file is not a supported image (JPG, PNG, GIF or WebP).');
  }
  if (sniffed === 'image/heic') {
    throw ValidationError(
      'The iPhone HEIC format does not display in browsers. Save the QR as PNG or JPG and ' +
      'upload it (iPhone: Settings > Camera > Formats > Most Compatible).'
    );
  }

  const ext = sniffed.split('/')[1].replace('jpeg', 'jpg');
  const name = (fileName || '').toString().trim() || `qr.${ext}`;
  const key = keyForDonationQr(name);
  const url = await putToR2(env, key, bytes, sniffed);
  return { success: true, url, mimeType: sniffed, bytes: bytes.length };
}
