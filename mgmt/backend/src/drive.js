import { getDriveAccessToken } from './account.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function driveFetch(env, path, opts = {}) {
  const token = await getDriveAccessToken(env);
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Drive API ${path} failed: ${await res.text()}`);
  return res;
}

// Finds (or creates) a named subfolder under `parentId` — same as Code.js's
// getOrCreateFolder(parent, name).
export async function getOrCreateFolder(env, parentId, name) {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const listRes = await driveFetch(env, `/files?q=${q}&fields=files(id,name)`);
  const { files } = await listRes.json();
  if (files && files.length) return files[0].id;

  const token = await getDriveAccessToken(env);
  const createRes = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  if (!createRes.ok) throw new Error('Drive folder create failed: ' + await createRes.text());
  const { id } = await createRes.json();
  return id;
}

function multipartBody(metadata, mimeType, bytes) {
  const boundary = 'chhathmgmt' + crypto.randomUUID();
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ]);
  return { boundary, body };
}

// Uploads a .docx as a real .docx file in Drive (used for DOCX_TEMPLATES storage —
// not converted, kept as the original editable Word file).
export async function uploadDocxFile(env, base64, fileName, folderId) {
  const token = await getDriveAccessToken(env);
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const { boundary, body } = multipartBody({ name: fileName, parents: [folderId] }, mimeType, bytes);
  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error('Drive docx upload failed: ' + await res.text());
  const file = await res.json();
  await setAnyoneReader(env, file.id);
  return file;
}

export async function setAnyoneReader(env, fileId) {
  const token = await getDriveAccessToken(env);
  await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
}

export async function getFileBytesBase64(env, fileId) {
  const token = await getDriveAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Drive file download failed: ' + await res.text());
  const buf = await res.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export async function copyFile(env, fileId, newName, parentId) {
  const token = await getDriveAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files/${fileId}/copy?fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName, parents: [parentId] }),
  });
  if (!res.ok) throw new Error('Drive file copy failed: ' + await res.text());
  const file = await res.json();
  await setAnyoneReader(env, file.id);
  return file;
}

export async function trashFile(env, fileId) {
  try {
    const token = await getDriveAccessToken(env);
    await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  } catch (e) { /* non-fatal, matches Code.js's try/catch around setTrashed */ }
}

// ---- The actual DOCX -> PDF conversion, via Drive's own converter (same
// mechanism as Code.js's Drive.Files.create(..., {convert:true}) + getAs(PDF)):
// 1. Upload the already-filled .docx bytes AS a Google Doc (convert=true triggers
//    Drive's real Word-compatible renderer — tables, page breaks, images preserved).
// 2. Export that Google Doc as PDF bytes.
// 3. Upload those PDF bytes as a plain file into the target folder.
// 4. Trash the intermediate Google Doc.
export async function convertDocxBytesToPdf(env, base64, fileName, folderId) {
  const token = await getDriveAccessToken(env);
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const baseName = (fileName || 'document').replace(/\.docx$/i, '');

  // Step 1: upload-with-convert.
  const { boundary, body } = multipartBody(
    { name: baseName, mimeType: 'application/vnd.google-apps.document', parents: [folderId] },
    docxMime, bytes
  );
  const convertRes = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!convertRes.ok) throw new Error('Drive docx->doc conversion failed: ' + await convertRes.text());
  const { id: googleDocId } = await convertRes.json();

  // Step 2: export as PDF bytes.
  const exportRes = await fetch(`${DRIVE_API}/files/${googleDocId}/export?mimeType=application/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!exportRes.ok) { await trashFile(env, googleDocId); throw new Error('Drive PDF export failed: ' + await exportRes.text()); }
  const pdfBytes = await exportRes.arrayBuffer();

  // Step 3: upload the PDF as a plain file.
  const pdfName = baseName + '.pdf';
  const { boundary: b2, body: body2 } = multipartBody({ name: pdfName, parents: [folderId] }, 'application/pdf', pdfBytes);
  const pdfRes = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${b2}` },
    body: body2,
  });
  if (!pdfRes.ok) { await trashFile(env, googleDocId); throw new Error('Drive PDF file upload failed: ' + await pdfRes.text()); }
  const pdfFile = await pdfRes.json();
  await setAnyoneReader(env, pdfFile.id);

  // Step 4: clean up the intermediate Google Doc.
  await trashFile(env, googleDocId);

  return { fileId: pdfFile.id, fileName: pdfFile.name };
}
