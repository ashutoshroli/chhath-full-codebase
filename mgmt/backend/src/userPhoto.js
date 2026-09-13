// ============ USER PROFILE PHOTO UPLOAD (R2-only) ============
//
// Uploads a member's profile picture to the R2 bucket and returns its PUBLIC URL,
// which the caller stores in users.photo (see migration 27-users-photo.sql). The
// public portal reads that URL and renders the member's avatar from it, falling
// back to the initials avatar when it is empty.
//
// R2-ONLY: unlike the popup / SEO uploaders, this path has NO Google Drive
// fallback — if R2 is not configured we return a clear, actionable error rather
// than silently writing somewhere else. Profile photos are a new feature, so
// there is no legacy Drive behaviour to preserve.
//
// SECURITY: staff-only (Admin/Superadmin), same gate as the other upload actions.
// The client-supplied mimeType is NOT trusted — the real format is sniffed from
// the bytes, and anything that isn't a browser-displayable image is rejected.
import { requireAdminOrAbove, ValidationError } from './auth.js';
import { base64ToBytes, sniffImageMime, MAX_IMAGE_UPLOAD_BYTES } from './base64.js';
import { r2Available, putToR2, keyForUserPhoto } from './r2.js';

export async function uploadUserPhoto(env, base64, fileName, idCode, user) {
  requireAdminOrAbove(user);

  // R2-only: no Drive fallback. Fail loudly and helpfully if it isn't set up.
  if (!r2Available(env)) {
    throw ValidationError(
      'Photo upload is not available: the R2 storage bucket is not configured on the server ' +
      '(R2_FILES binding and R2_PUBLIC_BASE). Ask an administrator to set it up.'
    );
  }

  // Decode with the shared image cap (rejects oversized/dirty payloads).
  const bytes = base64ToBytes(base64, { label: 'Profile photo', maxBytes: MAX_IMAGE_UPLOAD_BYTES });

  // Trust the bytes, not the client mimeType.
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) {
    throw ValidationError('That file is not a supported image (JPG, PNG, GIF or WebP).');
  }
  if (sniffed === 'image/heic') {
    throw ValidationError(
      'The iPhone HEIC format does not display in browsers. Save the photo as JPG and ' +
      'upload it (iPhone: Settings > Camera > Formats > Most Compatible).'
    );
  }

  const ext = sniffed.split('/')[1].replace('jpeg', 'jpg');
  const name = (fileName || '').toString().trim() || `photo.${ext}`;
  const key = keyForUserPhoto(idCode, name);
  const url = await putToR2(env, key, bytes, sniffed);
  return { success: true, url, photo: url, mimeType: sniffed, bytes: bytes.length };
}
