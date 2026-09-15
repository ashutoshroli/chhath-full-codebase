// ============ STORAGE MANAGEMENT (Superadmin) ============
//
// New uploads live on R2 (see r2.js). This module powers the Superadmin
// "Storage Management" screen:
//   - getStorageOverview(): per-year, how many files are on R2 vs Drive.
//   - moveYearToDrive(year): archive one year — move every R2 file of that year
//     (generated PDFs + consent photos/signatures) to Google Drive, rewrite the
//     DB URLs to the new Drive links, and delete the R2 objects. Popups are NOT
//     touched (they are year-independent and stay on R2 forever).
//
// The move is PER-FILE SAFE: each file is copied to Drive, its DB row is updated
// AND VERIFIED, and only then is the R2 object deleted (audit P0-06 — the order
// used to be the reverse of what this comment claimed). A failure on one file
// doesn't abort the rest, and nothing is deleted unless its reference has already
// moved. Re-running the move is safe (already-moved files no longer have R2 URLs,
// so they're skipped).
//
// PERMISSIONS: generated PDFs are published by the public portal, so their Drive
// copy is anonymously readable. Consent photos/signatures are identity evidence
// and their Drive copy is PRIVATE (audit P0-06).

import { getSheetDataAsJSON } from './crud.js';
import { requireSuperadmin, ValidationError, InternalError } from './auth.js';
import { r2Available, isR2Url, keyFromR2Url, getFromR2, deleteFromR2, yearPrefix, listR2ByPrefix } from './r2.js';
import { getOrCreateFolder, setAnyoneReader } from './drive.js';
import { getDriveAccessToken } from './account.js';
import { logErrorAt } from './logger.js';

// Uploads raw bytes to Drive under Archived Files/<year>/ and returns a download
// URL — the same URL shape convertDocxToPdf used for Drive PDFs.
//
// `publicRead` (audit P0-06): generated PDFs are public documents (the portal
// serves them as "Verified Record"), but consent photos and SIGNATURES are
// identity evidence. Archiving used to call setAnyoneReader() on everything, so a
// year's archive silently turned every consent photo/signature into a
// world-readable Drive file — undoing the deliberate `makePublic: false` that
// uploadConsentFile() uses for the same data (see loans.js).
async function uploadBytesToDrive(env, buffer, fileName, mimeType, year, { publicRead = true } = {}) {
  const token = await getDriveAccessToken(env);
  const rootId = env.DRIVE_ROOT_FOLDER_ID;
  if (!rootId) throw InternalError('DRIVE_ROOT_FOLDER_ID not configured on server');
  const archId = await getOrCreateFolder(env, rootId, 'Archived Files');
  const yearId = await getOrCreateFolder(env, archId, String(year));

  const boundary = 'chhatharch' + crypto.randomUUID();
  const metadata = { name: fileName, parents: [yearId] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    new Uint8Array(buffer),
    `\r\n--${boundary}--`,
  ]);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw InternalError('Drive upload failed: ' + await res.text());
  const { id } = await res.json();
  // Only public documents are made anonymously readable. A private archive keeps
  // Drive's default (owner-only) permissions; the mgmt UI reaches such media
  // through an authenticated proxy, exactly as it does for the private R2/Drive
  // consent uploads.
  if (publicRead) await setAnyoneReader(env, id);
  // Images use the lh3 direct URL (renders in <img>); PDFs use the uc download URL.
  const isImage = /^image\//i.test(mimeType);
  return isImage
    ? `https://lh3.googleusercontent.com/d/${id}=w1600`
    : `https://drive.google.com/uc?export=download&id=${id}`;
}

// Moves one R2-hosted URL to Drive.
//
// ---- audit P0-06: the ORDER was wrong ----
//
// This used to upload to Drive and DELETE THE R2 OBJECT here, leaving the caller
// to update the database afterwards:
//
//     const driveUrl = await uploadBytesToDrive(...)
//     await deleteFromR2(env, key)          // <-- source destroyed
//     return driveUrl                        // caller then does UPDATE ...
//
// If that UPDATE failed (a D1 blip, the isolate being evicted mid-archive), the
// row still pointed at an R2 object that no longer existed: a permanently broken
// link to a generated receipt or, worse, to a consent photo/signature that is
// legal evidence. The file-header comment claimed the DB was updated first; it
// was not.
//
// Now: upload -> apply the DB change -> VERIFY the row really carries the new URL
// -> only then delete the source. `applyUrl` must perform a CONDITIONAL update
// (guarded on the old URL) and report whether the row changed; `verifyUrl` reads
// the row back. If either step fails we keep BOTH copies and report it, because a
// duplicate is recoverable and a dangling reference is not.
async function moveOneUrl(env, url, fileName, mimeType, year, { publicRead = true, applyUrl, verifyUrl } = {}) {
  const key = keyFromR2Url(env, url);
  if (!key) return null;
  const obj = await getFromR2(env, key);
  if (!obj) return null; // already gone

  const driveUrl = await uploadBytesToDrive(
    env, obj.buffer, fileName, mimeType || obj.contentType, year, { publicRead }
  );

  if (typeof applyUrl === 'function') {
    const changed = await applyUrl(driveUrl);
    if (!changed) {
      throw InternalError(
        `Archive aborted for ${key}: the database row was not updated (it may have changed concurrently). `
        + `The R2 object was KEPT and a Drive copy now exists at ${driveUrl}.`,
        'This file could not be archived because its record could not be updated. Nothing was deleted — '
        + 'please try the archive again.'
      );
    }
    if (typeof verifyUrl === 'function') {
      const stored = await verifyUrl();
      if (stored !== driveUrl) {
        throw InternalError(
          `Archive aborted for ${key}: after the update the row reads "${stored}", not the new Drive URL. `
          + 'The R2 object was KEPT.',
          'This file could not be archived because its record did not save correctly. Nothing was deleted — '
          + 'please try the archive again.'
        );
      }
    }
  }

  // The database now points at Drive, so the source can go.
  await deleteFromR2(env, key).catch(() => {});
  return driveUrl;
}

// ---- Overview: where does each year's data live? ----
export async function getStorageOverview(env, user) {
  requireSuperadmin(user);

  const r2On = r2Available(env);

  // All years the portal knows about (union of collections/loans years).
  const collections = await getSheetDataAsJSON(env, 'COLLECTIONS');
  const loans = await getSheetDataAsJSON(env, 'LOANS');
  const yearSet = new Set();
  collections.forEach(c => { const y = parseInt(c.Year); if (y) yearSet.add(y); });
  loans.forEach(l => { const y = parseInt(l.Year); if (y) yearSet.add(y); });
  const years = Array.from(yearSet).sort((a, b) => b - a);

  const out = [];
  for (const year of years) {
    let r2Count = 0, r2Bytes = 0;
    if (r2On) {
      const objs = await listR2ByPrefix(env, yearPrefix(year)).catch(() => []);
      r2Count = objs.length;
      r2Bytes = objs.reduce((s, o) => s + (o.size || 0), 0);
    }
    out.push({
      year,
      r2Count,
      r2Bytes,
      location: r2Count > 0 ? 'R2' : 'Drive', // no R2 objects => already archived / never on R2
    });
  }
  return { r2Enabled: r2On, years: out };
}

// ---- Move a whole year's R2 files to Drive ----
export async function moveYearToDrive(env, year, user) {
  requireSuperadmin(user);
  if (!r2Available(env)) {
    throw InternalError(
      'moveYearToDrive: R2 binding (env.R2) is not configured on this deployment.',
      'File storage is not set up on the server, so no files were moved. Please contact the Superadmin.'
    );
  }
  const y = parseInt(year);
  if (!y) throw ValidationError('Valid year required');

  let moved = 0, failed = 0, skipped = 0;
  const errors = [];

  // 1) Generated PDFs (generated_files.public_link) for this year.
  const { results: genRows } = await env.DB_FILE_INDEX.prepare(
    'SELECT id, doc_type, record_id, file_name, public_link FROM generated_files WHERE year = ?'
  ).bind(y).all().catch(() => ({ results: [] }));
  for (const row of genRows || []) {
    if (!isR2Url(env, row.public_link)) { skipped++; continue; }
    try {
      const oldUrl = row.public_link;
      const newUrl = await moveOneUrl(
        env, oldUrl, row.file_name || `${row.record_id}.pdf`, 'application/pdf', y,
        {
          // A generated receipt/certificate IS published by the public portal.
          publicRead: true,
          // Guarded on the old URL: if something else re-generated this file while
          // the archive was running, we must not overwrite the newer link.
          applyUrl: async (driveUrl) => {
            const res = await env.DB_FILE_INDEX.prepare(
              'UPDATE generated_files SET public_link = ?, drive_path = ? WHERE id = ? AND public_link = ?'
            ).bind(driveUrl, `Archived Files/${y}/${row.file_name || row.record_id}`, row.id, oldUrl).run();
            return !!(res && res.meta && res.meta.changes);
          },
          verifyUrl: () => env.DB_FILE_INDEX
            .prepare('SELECT public_link FROM generated_files WHERE id = ?')
            .bind(row.id).first('public_link'),
        }
      );
      if (!newUrl) { skipped++; continue; }
      moved++;
    } catch (err) {
      failed++; errors.push(`PDF ${row.record_id}: ${err.message}`);
      await logErrorAt(env, 'backend-storage', 'moveYearToDrive:pdf', err, { year: y, recordId: row.record_id });
    }
  }

  // 2) Consent photos & signatures (loan_consents) — join to this year's loans.
  const loans = await getSheetDataAsJSON(env, 'LOANS');
  const loanIdsThisYear = new Set(loans.filter(l => parseInt(l.Year) === y).map(l => l['Loan ID']));
  const { results: consents } = await env.DB_LOANS_EXPENSES.prepare(
    'SELECT id, consent_id, loan_id, photo_url, signature_url FROM loan_consents'
  ).all().catch(() => ({ results: [] }));

  for (const c of consents || []) {
    if (!loanIdsThisYear.has(c.loan_id)) continue;
    for (const field of ['photo_url', 'signature_url']) {
      const url = c[field];
      if (!isR2Url(env, url)) { if (url) skipped++; continue; }
      try {
        const label = field === 'photo_url' ? 'photo' : 'signature';
        const newUrl = await moveOneUrl(
          env, url, `consent_${c.consent_id}_${label}.jpg`, 'image/jpeg', y,
          {
            // audit P0-06: identity evidence. NEVER anonymously readable — the
            // upload path deliberately stores these privately, and archiving must
            // not quietly publish them.
            publicRead: false,
            applyUrl: async (driveUrl) => {
              const res = await env.DB_LOANS_EXPENSES.prepare(
                `UPDATE loan_consents SET ${field} = ? WHERE id = ? AND ${field} = ?`
              ).bind(driveUrl, c.id, url).run();
              return !!(res && res.meta && res.meta.changes);
            },
            verifyUrl: () => env.DB_LOANS_EXPENSES
              .prepare(`SELECT ${field} AS v FROM loan_consents WHERE id = ?`)
              .bind(c.id).first('v'),
          }
        );
        if (!newUrl) { skipped++; continue; }
        moved++;
      } catch (err) {
        failed++; errors.push(`Consent ${c.consent_id} ${field}: ${err.message}`);
        await logErrorAt(env, 'backend-storage', 'moveYearToDrive:consent', err, { year: y, consentId: c.consent_id, field });
      }
    }
  }

  return {
    success: true,
    year: y,
    moved,
    failed,
    skipped,
    errors: errors.slice(0, 20),
    message: failed === 0
      ? `${y}: ${moved} file(s) moved to Drive${skipped ? `, ${skipped} were already on Drive` : ''}.`
      : `${y}: ${moved} moved, ${failed} failed — check the Error Log and try again.`,
  };
}
