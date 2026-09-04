import { getDriveAccessToken } from './account.js';
import { logWarn } from './logger.js';
import { base64ToBytes, MAX_DOCX_BYTES } from './base64.js';
import { InternalError } from './auth.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function driveFetch(env, path, opts = {}) {
  const token = await getDriveAccessToken(env);
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!res.ok) throw InternalError(`Drive API ${path} failed: ${await res.text()}`);
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
  if (!createRes.ok) throw InternalError('Drive folder create failed: ' + await createRes.text());
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
  const bytes = base64ToBytes(base64, { label: fileName || 'DOCX file', maxBytes: MAX_DOCX_BYTES }); // audit H-6
  const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const { boundary, body } = multipartBody({ name: fileName, parents: [folderId] }, mimeType, bytes);
  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw InternalError('Drive docx upload failed: ' + await res.text());
  const file = await res.json();
  await setAnyoneReader(env, file.id);
  return file;
}

// This used to ignore res.ok entirely. If the permission grant failed, a
// `public_link` that NOBODY can open was still written into generated_files as a
// success — the file looked available in the portal and 404'd on click.
export async function setAnyoneReader(env, fileId) {
  const token = await getDriveAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Already-shared is not an error worth failing the whole generation for.
    if (/already ha(s|ve) (the )?permission|duplicate/i.test(body)) return;
    throw InternalError(`Drive public-share failed for file ${fileId} (${res.status}): ${body}`);
  }
}

// `btoa(String.fromCharCode(...new Uint8Array(buf)))` spread EVERY byte of the
// .docx as a function argument, so any template above roughly 100 KB — i.e. any
// template containing a logo or letterhead image — threw
// "RangeError: Maximum call stack size exceeded". Every caller wrapped this in
// `.catch(() => null)`, so the user was told "no template exists for this year,
// upload one" for a template that existed and worked perfectly.
// Chunked conversion has no argument-count limit.
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 32 KB per String.fromCharCode call
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function getFileBytesBase64(env, fileId) {
  const token = await getDriveAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw InternalError('Drive file download failed: ' + await res.text());
  const buf = await res.arrayBuffer();
  return arrayBufferToBase64(buf);
}

export async function copyFile(env, fileId, newName, parentId) {
  const token = await getDriveAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files/${fileId}/copy?fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName, parents: [parentId] }),
  });
  if (!res.ok) throw InternalError('Drive file copy failed: ' + await res.text());
  const file = await res.json();
  await setAnyoneReader(env, file.id);
  return file;
}

// Still non-fatal (a leftover intermediate Google Doc must never fail a PDF that
// was otherwise generated fine) — but it no longer swallows silently. Previously
// the fetch wasn't even awaited for its status, so orphaned Google Docs
// accumulated in the committee's Drive forever with nothing anywhere to show it.
export async function trashFile(env, fileId) {
  try {
    const token = await getDriveAccessToken(env);
    const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[trashFile] Could not trash intermediate Drive file ${fileId} (${res.status}): ${body}`);
      await logWarn(env, 'backend-drive', 'trashFile',
        `Orphaned intermediate Google Doc left in Drive: file ${fileId} could not be trashed (${res.status}).`,
        { fileId, status: res.status, body: body.slice(0, 300) });
    }
  } catch (e) {
    console.warn('[trashFile] non-fatal failure:', e && e.message);
    await logWarn(env, 'backend-drive', 'trashFile',
      `Orphaned intermediate Google Doc left in Drive: file ${fileId} — ${e && e.message}`,
      { fileId }).catch(() => {});
  }
}

// ---- The actual DOCX -> PDF conversion, via Drive's own converter (same
// mechanism as Code.js's Drive.Files.create(..., {convert:true}) + getAs(PDF)):
// 1. Upload the already-filled .docx bytes AS a Google Doc (convert=true triggers
//    Drive's real Word-compatible renderer — tables, page breaks, images preserved).
// 2. Export that Google Doc as PDF bytes.
// 3. Upload those PDF bytes as a plain file into the target folder.
// 4. Trash the intermediate Google Doc.
// Renders a filled .docx to PDF BYTES via Drive's Google-Docs converter and
// returns them directly — WITHOUT uploading the PDF back to Drive. Used by the
// R2 path: we take these bytes straight to R2, so the two extra Drive round-trips
// (upload the PDF, then download it again) are skipped entirely. Only the
// intermediate Google Doc is created and then trashed.
export async function convertDocxBytesToPdfRaw(env, base64, fileName) {
  const token = await getDriveAccessToken(env);
  const bytes = base64ToBytes(base64, { label: fileName || 'DOCX file', maxBytes: MAX_DOCX_BYTES }); // audit H-6
  const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const baseName = (fileName || 'document').replace(/\.docx$/i, '');

  // We still need a folder for the intermediate Google Doc; the Drive root is
  // fine since it's trashed immediately after export.
  const { boundary, body } = multipartBody(
    { name: baseName, mimeType: 'application/vnd.google-apps.document' },
    docxMime, bytes
  );
  const convertRes = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!convertRes.ok) throw InternalError('Drive docx->doc conversion failed: ' + await convertRes.text());
  const { id: googleDocId } = await convertRes.json();

  const exportRes = await fetch(`${DRIVE_API}/files/${googleDocId}/export?mimeType=application/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!exportRes.ok) { await trashFile(env, googleDocId); throw InternalError('Drive PDF export failed: ' + await exportRes.text()); }
  const pdfBytes = await exportRes.arrayBuffer();

  await trashFile(env, googleDocId); // clean up the intermediate Google Doc
  return { pdfBytes, fileName: baseName + '.pdf' };
}

export async function convertDocxBytesToPdf(env, base64, fileName, folderId) {
  const token = await getDriveAccessToken(env);
  const bytes = base64ToBytes(base64, { label: fileName || 'DOCX file', maxBytes: MAX_DOCX_BYTES }); // audit H-6
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
  if (!convertRes.ok) throw InternalError('Drive docx->doc conversion failed: ' + await convertRes.text());
  const { id: googleDocId } = await convertRes.json();

  // Step 2: export as PDF bytes.
  const exportRes = await fetch(`${DRIVE_API}/files/${googleDocId}/export?mimeType=application/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!exportRes.ok) { await trashFile(env, googleDocId); throw InternalError('Drive PDF export failed: ' + await exportRes.text()); }
  const pdfBytes = await exportRes.arrayBuffer();

  // Step 3: upload the PDF as a plain file.
  const pdfName = baseName + '.pdf';
  const { boundary: b2, body: body2 } = multipartBody({ name: pdfName, parents: [folderId] }, 'application/pdf', pdfBytes);
  const pdfRes = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${b2}` },
    body: body2,
  });
  if (!pdfRes.ok) { await trashFile(env, googleDocId); throw InternalError('Drive PDF file upload failed: ' + await pdfRes.text()); }
  const pdfFile = await pdfRes.json();
  await setAnyoneReader(env, pdfFile.id);

  // Step 4: clean up the intermediate Google Doc.
  await trashFile(env, googleDocId);

  return { fileId: pdfFile.id, fileName: pdfFile.name };
}
