// Google Drive docx→PDF conversion — ported from the Worker's drive.js +
// account.js getDriveAccessToken. Render does this (the heavy network round-trips)
// and returns the PDF bytes; the Worker stores them (R2) and writes the D1 index.
//
// Auth: OAuth refresh-token flow (same creds as the Worker). Access tokens are
// cached in-process for their lifetime (Render has no KV; a warm instance reuses
// the token, a cold start re-mints one — fine).

import { config } from '../config.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

let _token = null;
let _tokenExpiresAt = 0;

async function getDriveAccessToken() {
  if (_token && Date.now() < _tokenExpiresAt) return _token;
  const { driveOAuthClientId, driveOAuthClientSecret, driveOAuthRefreshToken } = config;
  if (!driveOAuthClientId || !driveOAuthClientSecret || !driveOAuthRefreshToken) {
    throw new Error('DRIVE_OAUTH_CLIENT_ID / DRIVE_OAUTH_CLIENT_SECRET / DRIVE_OAUTH_REFRESH_TOKEN not configured on Render');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: driveOAuthClientId,
      client_secret: driveOAuthClientSecret,
      refresh_token: driveOAuthRefreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) throw new Error('Drive OAuth token refresh failed: ' + (await res.text()).slice(0, 200));
  const { access_token, expires_in } = await res.json();
  _token = access_token;
  _tokenExpiresAt = Date.now() + Math.max(60, (expires_in || 3600) - 300) * 1000;
  return _token;
}

function multipartBody(metadata, mimeType, bytes) {
  const boundary = 'chhathrender' + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return { boundary, body };
}

async function trashFile(fileId) {
  try {
    const token = await getDriveAccessToken();
    await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  } catch (e) {
    console.warn('[drive.trashFile] non-fatal:', e && e.message);
  }
}

// Render a filled .docx (base64) to PDF BYTES via Drive's Google-Docs converter.
// Returns { pdfBase64, fileName }. Mirrors the Worker's convertDocxBytesToPdfRaw:
// upload-with-convert -> export PDF -> trash the intermediate Google Doc.
export async function convertDocxToPdfBytes(base64, fileName) {
  const token = await getDriveAccessToken();
  const bytes = Buffer.from((base64 || '').replace(/\s+/g, ''), 'base64');
  const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const baseName = (fileName || 'document').replace(/\.docx$/i, '');

  const { boundary, body } = multipartBody(
    { name: baseName, mimeType: 'application/vnd.google-apps.document' },
    docxMime, bytes
  );
  const convertRes = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!convertRes.ok) throw new Error('Drive docx->doc conversion failed: ' + (await convertRes.text()).slice(0, 200));
  const { id: googleDocId } = await convertRes.json();

  const exportRes = await fetch(`${DRIVE_API}/files/${googleDocId}/export?mimeType=application/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!exportRes.ok) {
    await trashFile(googleDocId);
    throw new Error('Drive PDF export failed: ' + (await exportRes.text()).slice(0, 200));
  }
  const pdfBuf = Buffer.from(await exportRes.arrayBuffer());
  await trashFile(googleDocId);
  return { pdfBase64: pdfBuf.toString('base64'), fileName: baseName + '.pdf' };
}
