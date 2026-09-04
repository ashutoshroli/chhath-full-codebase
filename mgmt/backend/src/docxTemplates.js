import { getSheetDataAsJSON, getSheetDataByColumn, getSheetDataByYear } from './crud.js';
import { requireSuperadmin, requireYearAccess, requireStaffRole, PermissionError, ValidationError, InternalError } from './auth.js';
import { getOrCreateFolder, uploadDocxFile, getFileBytesBase64, copyFile, convertDocxBytesToPdf, convertDocxBytesToPdfRaw } from './drive.js';
import { r2Available, putToR2, keyForYear } from './r2.js';
import { logErrorAt } from './logger.js';
import { consentPlaceholderFactory } from './consentPlaceholders.js';
import { isTruthyFlag } from './flags.js';
import { usersByIdCodes, loansByBorrower, loansByLoanIds, generatedFilesByRecordIds, consentsForPerson, consentsForLoanIds } from './lookups.js';
import { base64ByteLength, MAX_DOCX_BYTES } from './base64.js';

export const DOC_TYPES = ['receipt', 'certificate', 'samaan', 'consent_loaner', 'consent_guarantor', 'report_en', 'report_hi', 'report_both'];

const TYPE_FOLDER_NAMES = {
  receipt: 'Receipts', certificate: 'Certificates', samaan: 'Samaan',
  consent_loaner: 'Consents-Loaner', consent_guarantor: 'Consents-Guarantor',
  report_en: 'Reports-English', report_hi: 'Reports-Hindi', report_both: 'Reports-Both',
};

// ---- DOCX_TEMPLATES CRUD (Superadmin) ----

export async function getDocxTemplates(env, docType) {
  const { results } = await env.DB_TEMPLATES.prepare('SELECT year, file_name, updated_at FROM docx_templates WHERE doc_type = ?').bind(docType).all();
  return results;
}

// Returns the row plus the raw .docx bytes as base64 (browser fills it client-side
// with docxtemplater — same reason Code.js reads server-side rather than handing
// back a Drive URL: Drive's download URL doesn't send CORS headers).
// audit P-4: the template BYTES were re-downloaded from Google Drive on every single
// call — every receipt, every consent-page load, every record in a bulk run. Each
// download is a Drive API round-trip, so it costs a SUBREQUEST (the free plan allows
// 50 per invocation), it costs latency on the critical path of a save, and it burns
// Drive API quota for data that changes only when a Superadmin uploads a new template.
//
// The bytes are now cached in KV, keyed on `drive_file_id` + `updated_at`. That key
// is the important part:
//   * an upload writes a new drive_file_id AND a new updated_at, so a new template is
//     picked up IMMEDIATELY — there is no staleness window and nothing to invalidate;
//   * the key is otherwise stable, so a template is written to KV about once per TTL
//     period rather than once per read. KV allows only ~1000 writes/day (the tightest
//     limit in the system), and with ~8 doc types x a few years that is a handful of
//     writes a week. Read quota is 100,000/day, which this comfortably fits.
// A .docx is capped at 10 MB (audit H-6), so its base64 stays well under KV's 25 MB
// value limit. Every KV interaction is best-effort: any failure falls straight back
// to the Drive download, so caching can never break document generation.
const DOCX_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function getDocxTemplate(env, docType, year) {
  const row = await env.DB_TEMPLATES.prepare('SELECT * FROM docx_templates WHERE doc_type = ? AND year = ?').bind(docType, parseInt(year)).first();
  if (!row) return null;

  const cacheKey = `docxtpl:${row.drive_file_id}:${row.updated_at || ''}`;
  let base64 = null;
  if (env.KV_SESSIONS) {
    base64 = await env.KV_SESSIONS.get(cacheKey).catch(() => null);
  }
  if (!base64) {
    base64 = await getFileBytesBase64(env, row.drive_file_id);
    if (env.KV_SESSIONS && base64) {
      // Fire-and-forget: a cache write must never delay or fail the response.
      await env.KV_SESSIONS.put(cacheKey, base64, { expirationTtl: DOCX_CACHE_TTL_SECONDS }).catch(() => {});
    }
  }

  return Object.assign({}, row, { base64, downloadUrl: `https://drive.google.com/uc?export=download&id=${row.drive_file_id}` });
}

// ---- Public (no-login) access control ----
//
// getDocxTemplatePublic and convertDocxToPdfPublic used to have NO auth of any
// kind and convertDocxToPdf's gate was `if (user) {...}` — so with user=null every
// role check was skipped. Any anonymous caller could:
//   (a) download the committee's raw .docx templates for any docType/year,
//   (b) push ARBITRARY base64 through Google Docs into the committee's Drive
//       (shared role:reader,type:anyone), and
//   (c) INSERT arbitrary rows into generated_files, which the public portal then
//       renders as a green "✅ Verified Record".
// The old code comment claimed "the record_id + token-gated data flow already
// authorized the request upstream" — it did not; no token ever reached here.
//
// Now the consent token IS verified server-side, and the docType/year/recordId are
// DERIVED from the consent row rather than trusted from the client.
async function resolveConsentContext(env, token) {
  if (!token) throw PermissionError('Consent token required.');
  const row = await env.DB_LOANS_EXPENSES.prepare(
    'SELECT * FROM loan_consents WHERE token = ?'
  ).bind(token.toString().trim()).first();
  if (!row) throw PermissionError('This consent link is not valid or has expired.');
  if (row.status !== 'accepted' && row.status !== 'declined') {
    throw PermissionError('The consent PDF can only be downloaded after a response has been recorded.');
  }

  const loans = await getSheetDataAsJSON(env, 'LOANS');
  const loan = loans.find(l => l['Loan ID'] === row.loan_id);
  if (!loan) throw PermissionError('Loan record not found.');

  const docType = row.role === 'loaner' ? 'consent_loaner' : 'consent_guarantor';
  const year = parseInt(loan.Year);
  return {
    consent: row,
    loan,
    docType,
    year,
    // Always the consent's OWN id. The client used to compute
    // `LOAN_CONSENT_ID || CONSENT_ID`, which for a guarantor picked the LOANER's
    // id — so every guarantor PDF was indexed under the wrong key and never
    // appeared in Download Center or the public portal again.
    recordId: `${docType}-${year}-${row.consent_id}`,
    fileName: `Consent-${row.consent_id}.docx`,
  };
}

// Token-gated. Returns ONLY the template for this consent's own role+year.
export async function getDocxTemplatePublic(env, docType, year, token) {
  const ctx = await resolveConsentContext(env, token);
  return getDocxTemplate(env, ctx.docType, ctx.year);
}

// Staff-only variant used by the logged-in portal (Home auto-PDF, ReceiptModal,
// Bulk, Download Center, PdfExport). Was `withAuth` with NO role check at all, so
// any logged-in user of any role could pull down full template bytes.
export async function getDocxTemplateForDoc(env, docType, year, user) {
  requireStaffRole(user);
  return getDocxTemplate(env, docType, year);
}

// A .docx is a ZIP, so its base64 always begins with "UEsDB" (PK\x03\x04).
// Checking this turns two confusing production failures into clear guidance:
//   "atob() called with invalid base64-encoded data" (4 occurrences in the log)
//   — the browser handed over something that wasn't a clean base64 payload
// and the case where an admin picks a .doc / .pdf / image by mistake.
function assertValidDocxBase64(base64) {
  const b64 = (base64 || '').toString().replace(/\s+/g, '');
  if (!b64) throw ValidationError('File required');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) {
    throw ValidationError(
      'The file did not upload correctly (the base64 data is corrupt). Refresh the page and select the file again.'
    );
  }
  if (!b64.startsWith('UEsDB')) {
    throw ValidationError(
      'This does not appear to be a .docx file. In Word, use "Save As" and choose the "Word Document (.docx)" format — ' +
      'an older .doc, a .pdf, or an image will not work.'
    );
  }
  // audit H-6: this validator gates BOTH template uploads and every filled document
  // sent for conversion, but it only ever checked the FORMAT. Check the size too,
  // cheaply, without decoding.
  const size = base64ByteLength(b64);
  if (size > MAX_DOCX_BYTES) {
    throw ValidationError(
      `This document is too large (${(size / 1048576).toFixed(1)} MB). The maximum is ${MAX_DOCX_BYTES / 1048576} MB — ` +
      'please compress or remove any large images in the template.'
    );
  }
  return b64;
}

export async function uploadDocxTemplate(env, docType, year, base64, fileName, user) {
  requireSuperadmin(user);
  if (!DOC_TYPES.includes(docType)) throw ValidationError('Invalid doc type');
  if (!year) throw ValidationError('Year required');
  base64 = assertValidDocxBase64(base64);
  if (!env.DRIVE_ROOT_FOLDER_ID) throw InternalError('DRIVE_ROOT_FOLDER_ID not configured on server');

  const folderId = await getOrCreateFolder(env, env.DRIVE_ROOT_FOLDER_ID, 'DOCX Templates');
  const file = await uploadDocxFile(env, base64, fileName || `${docType}-${year}.docx`, folderId);

  const now = new Date().toISOString();
  const existing = await env.DB_TEMPLATES.prepare('SELECT id FROM docx_templates WHERE doc_type = ? AND year = ?').bind(docType, parseInt(year)).first();
  if (existing) {
    // Leave the old Drive file itself in place (harmless orphan) rather than risk
    // deleting something still referenced elsewhere — matches Code.js exactly.
    await env.DB_TEMPLATES.prepare('UPDATE docx_templates SET drive_file_id = ?, file_name = ?, updated_at = ? WHERE id = ?')
      .bind(file.id, fileName || file.name, now, existing.id).run();
  } else {
    await env.DB_TEMPLATES.prepare('INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(docType, parseInt(year), file.id, fileName || file.name, now, now).run();
  }
  return { success: true };
}

export async function copyDocxTemplate(env, docType, fromYear, toYear, user) {
  requireSuperadmin(user);
  if (!toYear) throw ValidationError('Target year required');
  const conflict = await env.DB_TEMPLATES.prepare('SELECT id FROM docx_templates WHERE doc_type = ? AND year = ?').bind(docType, parseInt(toYear)).first();
  if (conflict) throw ValidationError(`A template already exists for ${toYear}.`);
  const source = await env.DB_TEMPLATES.prepare('SELECT * FROM docx_templates WHERE doc_type = ? AND year = ?').bind(docType, parseInt(fromYear)).first();
  if (!source) throw ValidationError('Source template not found.');

  const folderId = await getOrCreateFolder(env, env.DRIVE_ROOT_FOLDER_ID, 'DOCX Templates');
  const copy = await copyFile(env, source.drive_file_id, `${docType}-${toYear}.docx`, folderId);

  const now = new Date().toISOString();
  await env.DB_TEMPLATES.prepare('INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(docType, parseInt(toYear), copy.id, copy.name, now, now).run();
  return { success: true };
}

export async function deleteDocxTemplate(env, docType, year, user) {
  requireSuperadmin(user);
  const result = await env.DB_TEMPLATES.prepare('DELETE FROM docx_templates WHERE doc_type = ? AND year = ?').bind(docType, parseInt(year)).run();
  if (!result.meta.changes) throw ValidationError('Template not found.');
  return { success: true };
}

// ---- GENERATED_FILES log ----

export async function isFileGenerated(env, docType, year, recordId) {
  const row = await env.DB_FILE_INDEX.prepare('SELECT * FROM generated_files WHERE doc_type = ? AND year = ? AND record_id = ?')
    .bind(docType, parseInt(year), recordId).first();
  return row || null;
}

async function recordGeneratedFile(env, docType, year, recordId, fileName, publicLink, drivePath) {
  try {
    if (!recordId || !fileName || !publicLink) {
      console.error('[recordGeneratedFile] Missing required fields:', { docType, year, recordId, fileName, publicLink });
      throw ValidationError('Missing required fields for recording generated file');
    }

    // UPSERT instead of a bare INSERT. Backed by the new
    // UNIQUE(doc_type, year, record_id) index, this makes the "already
    // generated?" check race-proof: a concurrent duplicate now UPDATES the row to
    // point at the newest PDF instead of inserting a second row that the public
    // portal would then resolve arbitrarily via .find().
    await env.DB_FILE_INDEX.prepare(
      `INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link, drive_path, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(doc_type, year, record_id) DO UPDATE SET
         file_name = excluded.file_name,
         public_link = excluded.public_link,
         drive_path = excluded.drive_path,
         generated_at = excluded.generated_at`
    ).bind(docType, parseInt(year), recordId, fileName, publicLink, drivePath, new Date().toISOString()).run();
    // (audit 6.3) Removed a per-generation success console.log — it fired on
    // EVERY PDF and only added Worker-tail noise; the failure path below still
    // logs through the structured logger.
  } catch (err) {
    // The old INSERT here omitted error_id AND reported, so the resulting row
    // showed "Ref: undefined" in the UI, gave React duplicate null keys, and
    // "Report to WhatsApp" always threw "Error record not found." -- the one
    // diagnostic this code added could be SEEN but never ESCALATED.
    // logErrorAt() writes the correct column set.
    console.error('[recordGeneratedFile] Database insert failed:', err.message, { docType, year, recordId });
    await logErrorAt(env, 'backend-docxTemplates', 'recordGeneratedFile', err, {
      docType, year, recordId, fileName, publicLink, drivePath,
    });
    throw InternalError(`Failed to record generated file in database: ${err.message}`);
  }
}

// Clears the index row so the next generation becomes the canonical PDF. Used for
// deliberate regeneration (corrected data, re-run report).
export async function clearGeneratedFile(env, docType, year, recordId) {
  await env.DB_FILE_INDEX.prepare(
    'DELETE FROM generated_files WHERE doc_type = ? AND year = ? AND record_id = ?'
  ).bind(docType, parseInt(year), recordId).run();
}

export async function getGeneratedFilesForYear(env, year, user, docType) {
  requireSuperadmin(user);
  const { results } = docType
    ? await env.DB_FILE_INDEX.prepare('SELECT * FROM generated_files WHERE year = ? AND doc_type = ? ORDER BY generated_at DESC').bind(parseInt(year), docType).all()
    : await env.DB_FILE_INDEX.prepare('SELECT * FROM generated_files WHERE year = ? ORDER BY generated_at DESC').bind(parseInt(year)).all();
  return results;
}

// ---- Docx -> PDF conversion ----
//
// AUTHORIZATION (this was the single worst gate in the codebase):
//   OLD: `if (user) { isAutoGenerate ? requireAdminOrAbove(user) : requireSuperadmin(user); }`
//     - `if (user)` meant a PUBLIC caller (user=null) skipped every check, so the
//       unauthenticated convertDocxToPdfPublic route let anyone push arbitrary
//       bytes into the committee's Drive and insert arbitrary generated_files rows
//       that the public portal shows as "Verified Record".
//     - ReceiptModal calls this WITHOUT isAutoGenerate, so per-row "Download PDF"
//       demanded Superadmin even though the download icon renders for every role
//       -> Admin/Subadmin always got "Only a Superadmin can perform this action."
//   NEW: an explicit `mode`:
//       'auto'   Home auto-PDF after a save        -> staff (Admin/Subadmin/Superadmin)
//       'single' one row's own document (Receipt)  -> staff
//       'bulk'   Bulk Generate / Download Center   -> Superadmin
//       'public' Consent page                      -> consent TOKEN verified by the caller
const CONVERT_MODES = ['auto', 'single', 'bulk', 'public'];

// A consent PDF is a legal document (it carries the acceptance status, the
// verification state, the geolocation and the signature of a named person), and
// the public portal renders whatever `generated_files` points at as a "✅ Verified
// Record". So it may only ever be produced by:
//   'public' — the token-gated consent page, where docType/year/recordId are all
//              DERIVED from the verified consent row (convertDocxToPdfPublic), or
//   'bulk'   — a deliberate Superadmin run.
// It must never be reachable from an ordinary staff-level, client-chosen call.
const CONSENT_DOC_TYPES = new Set(['consent_loaner', 'consent_guarantor']);

// `recordId` is the primary key of the public file index, and callers pass it
// explicitly. It MUST describe the document actually being written, otherwise a
// caller allowed to generate (say) their own receipt could point the write at
// someone else's consent row. The scheme is `<docType>-<year>-<ref>` everywhere
// (see getRecordsForDocType / getPersonDownloads / resolveConsentContext).
function assertRecordIdMatches(docType, year, recordId) {
  if (!recordId) return;
  const expectedPrefix = `${docType}-${parseInt(year)}-`;
  if (!recordId.toString().startsWith(expectedPrefix)) {
    throw ValidationError(
      `This document could not be filed (its reference "${recordId}" does not match ${docType} ${year}). Please reload the page and try again.`
    );
  }
}

export async function convertDocxToPdf(env, docType, year, recordId, base64, fileName, user, mode, opts) {
  const m = CONVERT_MODES.includes(mode) ? mode : 'bulk'; // unknown -> most restrictive
  if (m === 'public') {
    if (user) requireStaffRole(user); // a logged-in caller still needs a real role
  } else if (m === 'bulk') {
    requireSuperadmin(user);
  } else {
    requireStaffRole(user);
  }

  if (!DOC_TYPES.includes(docType)) throw ValidationError('Invalid doc type');

  // SECURITY (audit C-2), defence in depth behind the per-endpoint gate in
  // index.js: even if a future caller passes a staff-level mode, it cannot be used
  // to write a consent document or to file a document under a foreign record id.
  if (CONSENT_DOC_TYPES.has(docType) && m !== 'public' && m !== 'bulk') {
    throw PermissionError('Consent documents cannot be generated from this screen.');
  }
  assertRecordIdMatches(docType, year, recordId);
  base64 = assertValidDocxBase64(base64);
  if (!env.DRIVE_ROOT_FOLDER_ID) throw InternalError('DRIVE_ROOT_FOLDER_ID not configured on server');

  const force = !!(opts && opts.force);

  if (recordId) {
    const existing = await isFileGenerated(env, docType, year, recordId);
    if (existing && !force) {
      return { success: true, skipped: true, publicLink: existing.public_link, fileName: existing.file_name };
    }
  }

  // The DOCX->PDF rendering can only be done by Google Drive (Google Docs
  // converter). Two paths:
  //   R2 configured  -> render to PDF BYTES only (no Drive PDF upload) and put
  //                     them straight into R2. This is actually FEWER network
  //                     round-trips than the old Drive-only flow (no PDF upload,
  //                     no re-download), so save/auto-generate is fast.
  //   R2 not configured -> the original Drive flow (create year folders, upload
  //                     the PDF to Drive, serve the Drive link) — unchanged, so
  //                     nothing breaks before the bucket exists.
  let publicLink, drivePath, pdfName;

  if (r2Available(env)) {
    const { pdfBytes, fileName: name } = await convertDocxBytesToPdfRaw(env, base64, fileName || 'document.docx');
    pdfName = name;
    const key = keyForYear(year, 'pdf', pdfName, docType);
    publicLink = await putToR2(env, key, new Uint8Array(pdfBytes), 'application/pdf');
    drivePath = key; // store the R2 key in drive_path so the move feature can find it
  } else {
    const genFolderId = await getOrCreateFolder(env, env.DRIVE_ROOT_FOLDER_ID, 'Generated PDFs');
    const typeFolderName = TYPE_FOLDER_NAMES[docType];
    const typeFolderId = await getOrCreateFolder(env, genFolderId, typeFolderName);
    const yearFolderId = await getOrCreateFolder(env, typeFolderId, String(year));
    const res = await convertDocxBytesToPdf(env, base64, fileName || 'document.docx', yearFolderId);
    pdfName = res.fileName;
    publicLink = `https://drive.google.com/uc?export=download&id=${res.fileId}`;
    drivePath = `Generated PDFs/${typeFolderName}/${year}/${pdfName}`;
  }

  // Record in the DB — this MUST succeed for the public portal to show the file.
  if (recordId) {
    try {
      await recordGeneratedFile(env, docType, year, recordId, pdfName, publicLink, drivePath);
    } catch (err) {
      console.error('[convertDocxToPdf] PDF created but database record failed:', err.message);
      // The flag is returned so the caller can surface it. Only 1 of 6 callers
      // used to check it — they all do now.
      return {
        success: true,
        skipped: false,
        publicLink,
        fileName: pdfName,
        indexFailed: true,
        error: 'The PDF was created but was not recorded in the public portal index. Please inform the Superadmin.',
      };
    }
  }

  return { success: true, skipped: false, publicLink, fileName: pdfName };
}

// PUBLIC (no login) — Consent page only.
// The consent token is now verified server-side and docType / year / recordId /
// fileName are DERIVED from the consent row, so a caller cannot choose what gets
// written or where it gets indexed.
export async function convertDocxToPdfPublic(env, base64, token) {
  const ctx = await resolveConsentContext(env, token);
  return convertDocxToPdf(
    env, ctx.docType, ctx.year, ctx.recordId, base64, ctx.fileName,
    null, 'public',
    // A consent PDF is a legal document that should reflect the CURRENT
    // verification/acceptance state, so re-downloading regenerates it rather than
    // silently handing back a stale copy.
    { force: true }
  );
}

// ---- Batch placeholder resolution for Bulk "Generate PDFs" ----

const parseAmt = (v) => parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;
// Same fix as templates.js's formatAmt — guard on the parsed number, not raw
// truthiness, so a literal "0" is treated as "no amount" too.
const formatAmt = (v) => (parseAmt(v) > 0 ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(parseAmt(v)) : '');
// isTruthyFlag comes from the shared flags.js util (audit 6.1) — see import above.

// statusLabel used to be a TRIMMED local copy that silently dropped the
// verification/decline remarks, so {GUARANTOR_1_STATUS} showed remarks on the
// consent page and dropped them in every bulk-generated PDF. It now comes from
// consentPlaceholders.js — one implementation for both paths.

export async function getRecordsForDocType(env, docType, year, user) {
  // audit M-2: this gated on year access ONLY, with no role check, and returns a
  // placeholder map for EVERY record of the year — MOBILE included, for every
  // contributor. So any Subadmin who sat on that year's committee could pull the
  // whole year's contact list in one call. It is the input to bulk generation,
  // which App.jsx exposes on the Superadmin-only "Bulk Generate" tab and whose
  // generate action has always been Superadmin-only (see C-2). Gate it to match.
  requireSuperadmin(user);
  await requireYearAccess(env, user, year);

  // audit M-17 — the Phase-1 index work reached views.js but never got applied
  // here. This function used `getSheetDataAsJSON` + `filterByYear`, i.e. read every
  // collection row and every loan row EVER RECORDED and then discarded all but one
  // year, plus a third full scan of USERS. `getSheetDataByYear` pushes the year into
  // an indexed `WHERE`, and USERS is now fetched only for the ids each branch
  // actually references (the H-11 batched-lookup approach) rather than in full.
  if (docType === 'receipt' || docType === 'certificate') {
    const wantCert = docType === 'certificate';
    const collections = (await getSheetDataByYear(env, 'COLLECTIONS', year))
      .filter(c => !isTruthyFlag(c['Is Resell']))
      .filter(c => c['Contribution Type'] !== '2')
      .filter(c => (wantCert ? c['Certificate Or Receipt'] === 'Certificate' : c['Certificate Or Receipt'] !== 'Certificate'));
    const userMap = await usersByIdCodes(env, collections.map(c => c.Name));
    return collections.map(entry => {
      const u = userMap[entry.Name] || {};
      const recordId = `${docType}-${year}-${entry.__rowIndex}`;
      const placeholders = wantCert ? {
        CERT_NO: `NCS-CERT-${year}-${entry['Sl. No.']}`, NAME: u.Name || entry.Name || '', DESIGNATION: u.Designation || '',
        FATHER_NAME: u["Father's Name"] || '', VILLAGE: u.Village || '', DETAIL: entry.Detail || '',
        DATE: entry.Date || '', YEAR: year,
      } : {
        RECEIPT_NO: `NCS-${year}-${entry['Sl. No.']}`, NAME: u.Name || entry.Name || '', DESIGNATION: u.Designation || '',
        FATHER_NAME: u["Father's Name"] || '', VILLAGE: u.Village || '', MOBILE: u.Mobile || '',
        AMOUNT: formatAmt(entry.Amount), DETAIL: entry.Detail || '', DATE: entry.Date || '', YEAR: year,
      };
      return { recordId, fileNameHint: `${docType}-${placeholders[wantCert ? 'CERT_NO' : 'RECEIPT_NO']}`, placeholders };
    });
  }

  if (docType === 'samaan') {
    const collections = (await getSheetDataByYear(env, 'COLLECTIONS', year))
      .filter(c => !isTruthyFlag(c['Is Resell']))
      .filter(c => c['Contribution Type'] === '2');
    const userMap = await usersByIdCodes(env, collections.map(c => c.Name));
    return collections.map(entry => {
      const u = userMap[entry.Name] || {};
      const recordId = `samaan-${year}-${entry.__rowIndex}`;
      const placeholders = {
        SAMAAN_NO: `NCS-SAMAAN-${year}-${entry['Sl. No.']}`, NAME: u.Name || entry.Name || '',
        FATHER_NAME: u["Father's Name"] || '', VILLAGE: u.Village || '',
        ITEM_DETAIL: entry.Detail || '', DATE: entry.Date || '', YEAR: year,
      };
      return { recordId, fileNameHint: `samaan-${placeholders.SAMAAN_NO}`, placeholders };
    });
  }

  // consent_loaner / consent_guarantor — only fully accepted consents.
  //
  // The `base` object here used to carry only 6 keys (FUND_YEAR, LOAN_AMOUNT,
  // MONTHLY_INTEREST_RATE, MINIMUM_TENURE_MONTHS, FINAL_REPAYMENT_DATE,
  // LOANER_NAME + guarantor names), while the UI documents — and the Consent page
  // supplies — 11 more: FINAL_REPAYMENT_DAY_NAME, DIWALI_NEXT_DAY_DATE/_DAY_NAME,
  // NAHAY_KHAY_DATE/_DAY_NAME, CHHATH_MORNING_ARGHYA_DATE/_DAY_NAME and
  // ACCEPTED_COUNT/PENDING_COUNT/DECLINED_COUNT. With docxFill's
  // `nullGetter: () => ''`, the SAME template therefore produced a complete PDF
  // from the Consent page and a PDF with blank dates/day-names/counts from Bulk
  // Generate — no error, no log. Now both paths call the same builder.
  const wantLoaner = docType === 'consent_loaner';
  const loans = await getSheetDataByYear(env, 'LOANS', year);
  // Was an unbounded `SELECT * FROM loan_consents WHERE status != 'replaced'` —
  // every consent of every year, to use the handful belonging to THIS year's loans.
  const allConsents = await consentsForLoanIds(env, loans.map(l => l['Loan ID']));
  // Names for the loaner + guarantors of these loans only.
  const userMap = await usersByIdCodes(env, allConsents.map(c => c.person_id));
  const nameOf = (id) => (userMap[(id == null ? '' : id).toString().trim()] || {}).Name || id;

  const out = [];
  for (const loan of loans) {
    const consents = allConsents.filter(c => c.loan_id === loan['Loan ID']);
    const targetConsents = consents.filter(c => c.role === (wantLoaner ? 'loaner' : 'guarantor') && c.status === 'accepted');
    if (!targetConsents.length) continue;
    // Resolves the loan-level parts (incl. the festival dates from DB_CORE) once
    // per loan rather than once per consent.
    const placeholdersFor = await consentPlaceholderFactory(env, loan, consents, nameOf);
    for (const c of targetConsents) {
      out.push({
        recordId: `${docType}-${year}-${c.consent_id}`,
        fileNameHint: `${docType}-${c.consent_id}`,
        placeholders: placeholdersFor(c),
      });
    }
  }
  return out;
}

// ---- Download Center ----

export async function searchUsersByVillageAndName(env, village, query, user) {
  // Had no role check at all beyond a valid session, yet it returns names +
  // mobile numbers for a whole village.
  requireStaffRole(user);
  if (!village) throw ValidationError('Village required');
  const q = (query || '').toString().trim().toLowerCase();
  // schema/core.sql already indexes `village`, so push the equality down instead of
  // reading every member row in the committee to keep the ones from one village.
  return (await getSheetDataByColumn(env, 'USERS', 'village', village.toString().trim()))
    .filter(u => {
      if (!q) return true;
      return (u.Name || '').toString().toLowerCase().includes(q) || (u.Mobile || '').toString().toLowerCase().includes(q) || (u.ID || '').toString().toLowerCase().includes(q);
    })
    .slice(0, 50)
    .map(u => ({ ID: u.ID, Name: u.Name, Village: u.Village, Mobile: u.Mobile || '' }));
}

export async function getPersonDownloads(env, userId, user) {
  requireStaffRole(user);
  if (!userId) throw ValidationError('User ID required');
  const id = userId.toString().trim();

  // audit H-11 / M-14: this read the WHOLE users table and the WHOLE collections
  // table, then filtered in JS, to build one person's download list. Both are now
  // scoped, and they run concurrently.
  const [ownMap, personCollections] = await Promise.all([
    usersByIdCodes(env, [id]),
    getSheetDataByColumn(env, 'COLLECTIONS', 'name', id),
  ]);
  const u = ownMap[id];
  if (!u) throw ValidationError('User not found');

  const allCollections = personCollections.filter(r => !isTruthyFlag(r['Is Resell']));

  // The generated-file index is read ONCE for every record id this function will
  // report on, instead of one query per row (audit H-11). Built up front so all three
  // sections below share it.
  const collectionRecordIds = allCollections.map(entry => {
    const year = parseInt(entry.Year);
    const isSamaan = entry['Contribution Type'] === '2';
    const wantCert = !isSamaan && entry['Certificate Or Receipt'] === 'Certificate';
    const docType = isSamaan ? 'samaan' : (wantCert ? 'certificate' : 'receipt');
    return `${docType}-${year}-${entry.__rowIndex}`;
  });

  // audit H-11 / M-14: everything below used to be built from THREE unbounded reads —
  // every loan_consents row, every loan, and (above) every user and every collection —
  // to assemble one person's download list. It is now scoped in four indexed steps:
  //
  //   1. this person's own consents          (idx_loan_consents_person_id)
  //   2. this person's own loans             (idx_loans_name)
  //   3. every consent of the loans involved (idx_loan_consents_loan_id) — the
  //      placeholder factory needs a loan's FULL consent set to compute the
  //      accepted/pending/declined counts and the guarantor names
  //   4. the loans referenced by 1, batched  (idx_loans_loan_id)
  const myConsents = await consentsForPerson(env, id);
  const guarantorConsents = myConsents.filter(c => c.role === 'guarantor' && c.status === 'accepted');

  const [ownLoans, referencedLoans] = await Promise.all([
    loansByBorrower(env, id),
    loansByLoanIds(env, guarantorConsents.map(c => c.loan_id)),
  ]);
  const loanById = { ...referencedLoans };
  ownLoans.forEach(l => { loanById[(l['Loan ID'] || '').toString().trim()] = l; });

  // Step 3 — the consents of exactly the loans this page will render.
  const involvedLoanIds = Object.keys(loanById);
  const allConsents = await consentsForLoanIds(env, involvedLoanIds);

  // Same 6-key-vs-24-key divergence as getRecordsForDocType above — Download
  // Center produced consent PDFs with every festival date and count blank.
  // Cached per loan so a person with several loans doesn't re-read festival dates.
  //
  // nameOf now resolves from a batched lookup of just the people involved (this
  // person plus each referenced loaner), instead of a whole-table userMap.
  const nameMap = await usersByIdCodes(env, [
    id,
    ...Object.values(loanById).map(l => l.Name),
    ...allConsents.map(c => c.person_id),
  ]);
  const nameOf = (pid) => (nameMap[pid] && nameMap[pid].Name) || pid;

  const factoryCache = new Map();
  const placeholderFactoryFor = async (loan) => {
    const key = loan['Loan ID'];
    if (!factoryCache.has(key)) {
      const consents = allConsents.filter(c => c.loan_id === key);
      factoryCache.set(key, await consentPlaceholderFactory(env, loan, consents, nameOf));
    }
    return factoryCache.get(key);
  };

  // One generated-file index read covering every record id all three sections will
  // report on, replacing one query per document (audit H-11).
  const consentRecordIds = [];
  for (const loan of ownLoans) {
    const c = allConsents.find(x => x.loan_id === loan['Loan ID'] && x.role === 'loaner' && x.status === 'accepted');
    if (c) consentRecordIds.push(`consent_loaner-${parseInt(loan.Year)}-${c.consent_id}`);
  }
  for (const c of guarantorConsents) {
    const loan = loanById[c.loan_id];
    if (loan) consentRecordIds.push(`consent_guarantor-${parseInt(loan.Year)}-${c.consent_id}`);
  }
  const genByRecordId = await generatedFilesByRecordIds(env, [...collectionRecordIds, ...consentRecordIds]);

  const collections = [];
  for (const entry of allCollections) {
    const year = parseInt(entry.Year);
    const isSamaan = entry['Contribution Type'] === '2';
    const wantCert = !isSamaan && entry['Certificate Or Receipt'] === 'Certificate';
    const docType = isSamaan ? 'samaan' : (wantCert ? 'certificate' : 'receipt');
    const recordId = `${docType}-${year}-${entry.__rowIndex}`;
    const placeholders = isSamaan ? {
      SAMAAN_NO: `NCS-SAMAAN-${year}-${entry['Sl. No.']}`, NAME: u.Name || entry.Name || '',
      FATHER_NAME: u["Father's Name"] || '', VILLAGE: u.Village || '',
      ITEM_DETAIL: entry.Detail || '', DATE: entry.Date || '', YEAR: year,
    } : wantCert ? {
      CERT_NO: `NCS-CERT-${year}-${entry['Sl. No.']}`, NAME: u.Name || entry.Name || '', DESIGNATION: u.Designation || '',
      FATHER_NAME: u["Father's Name"] || '', VILLAGE: u.Village || '', DETAIL: entry.Detail || '',
      DATE: entry.Date || '', YEAR: year,
    } : {
      RECEIPT_NO: `NCS-${year}-${entry['Sl. No.']}`, NAME: u.Name || entry.Name || '', DESIGNATION: u.Designation || '',
      FATHER_NAME: u["Father's Name"] || '', VILLAGE: u.Village || '', MOBILE: u.Mobile || '',
      AMOUNT: formatAmt(entry.Amount), DETAIL: entry.Detail || '', DATE: entry.Date || '', YEAR: year,
    };
    const docNoKey = isSamaan ? 'SAMAAN_NO' : (wantCert ? 'CERT_NO' : 'RECEIPT_NO');
    const gen = genByRecordId[recordId];
    collections.push({
      recordId, docType, year,
      label: `${isSamaan ? 'Samaan' : (wantCert ? 'Certificate' : 'Receipt')} — ${year}${placeholders.AMOUNT ? ' — ₹' + placeholders.AMOUNT : ''}`,
      fileNameHint: `${docType}-${placeholders[docNoKey]}`,
      placeholders,
      publicLink: gen ? gen.public_link : null,
    });
  }
  collections.sort((a, b) => b.year - a.year);


  const loanerItems = [];
  for (const loan of ownLoans) {
    const year = parseInt(loan.Year);
    const c = allConsents.find(x => x.loan_id === loan['Loan ID'] && x.role === 'loaner' && x.status === 'accepted');
    if (!c) continue;
    const recordId = `consent_loaner-${year}-${c.consent_id}`;
    const placeholders = (await placeholderFactoryFor(loan))(c);
    const gen = genByRecordId[recordId];
    loanerItems.push({
      recordId, docType: 'consent_loaner', year,
      label: `Loan Consent (as Loaner) — ${year} — ₹${loan.Amount}`,
      fileNameHint: `consent_loaner-${c.consent_id}`, placeholders,
      publicLink: gen ? gen.public_link : null,
    });
  }
  loanerItems.sort((a, b) => b.year - a.year);

  const guarantorItems = [];
  for (const c of guarantorConsents) {
    const loan = loanById[c.loan_id];
    if (!loan) continue;
    const year = parseInt(loan.Year);
    const recordId = `consent_guarantor-${year}-${c.consent_id}`;
    const placeholders = (await placeholderFactoryFor(loan))(c);
    const gen = genByRecordId[recordId];
    guarantorItems.push({
      recordId, docType: 'consent_guarantor', year,
      label: `Loan Consent (as Guarantor for ${nameOf(loan.Name)}) — ${year}`,
      fileNameHint: `consent_guarantor-${c.consent_id}`, placeholders,
      publicLink: gen ? gen.public_link : null,
    });
  }
  guarantorItems.sort((a, b) => b.year - a.year);

  return { collections, loanerItems, guarantorItems };
}
