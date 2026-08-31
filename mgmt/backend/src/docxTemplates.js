import { getSheetDataAsJSON, filterByYear } from './crud.js';
import { requireSuperadmin, requireAdminOrAbove, requireYearAccess, requireStaffRole } from './auth.js';
import { getOrCreateFolder, uploadDocxFile, getFileBytesBase64, copyFile, convertDocxBytesToPdf } from './drive.js';

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
export async function getDocxTemplate(env, docType, year) {
  const row = await env.DB_TEMPLATES.prepare('SELECT * FROM docx_templates WHERE doc_type = ? AND year = ?').bind(docType, parseInt(year)).first();
  if (!row) return null;
  const base64 = await getFileBytesBase64(env, row.drive_file_id);
  return Object.assign({}, row, { base64, downloadUrl: `https://drive.google.com/uc?export=download&id=${row.drive_file_id}` });
}

// Public variant — same data, called from the no-login Consent page.
export async function getDocxTemplatePublic(env, docType, year) { return getDocxTemplate(env, docType, year); }

export async function uploadDocxTemplate(env, docType, year, base64, fileName, user) {
  requireSuperadmin(user);
  if (!DOC_TYPES.includes(docType)) throw new Error('Invalid doc type');
  if (!year) throw new Error('Year required');
  if (!base64) throw new Error('File required');
  if (!env.DRIVE_ROOT_FOLDER_ID) throw new Error('DRIVE_ROOT_FOLDER_ID not configured on server');

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
  if (!toYear) throw new Error('Target year required');
  const conflict = await env.DB_TEMPLATES.prepare('SELECT id FROM docx_templates WHERE doc_type = ? AND year = ?').bind(docType, parseInt(toYear)).first();
  if (conflict) throw new Error(`${toYear} ke liye pehle se ek template maujood hai.`);
  const source = await env.DB_TEMPLATES.prepare('SELECT * FROM docx_templates WHERE doc_type = ? AND year = ?').bind(docType, parseInt(fromYear)).first();
  if (!source) throw new Error('Source template nahi mila.');

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
  if (!result.meta.changes) throw new Error('Template nahi mila.');
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
      throw new Error('Missing required fields for recording generated file');
    }
    
    await env.DB_FILE_INDEX.prepare(
      'INSERT INTO generated_files (doc_type, year, record_id, file_name, public_link, drive_path, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(docType, parseInt(year), recordId, fileName, publicLink, drivePath, new Date().toISOString()).run();
    
    console.log('[recordGeneratedFile] Success:', { docType, year, recordId, fileName });
  } catch (err) {
    // Log to error_log table so admin can see what went wrong
    console.error('[recordGeneratedFile] Database insert failed:', err.message, { docType, year, recordId });
    await env.DB_LOGS.prepare(
      'INSERT INTO error_log (source, page, message, stack, context, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('backend-docxTemplates', 'recordGeneratedFile', err.message, err.stack || '', 
      JSON.stringify({ docType, year, recordId, fileName, publicLink, drivePath }), 
      new Date().toISOString()
    ).run().catch(() => {}); // Don't let error logging itself fail the main operation
    
    // Re-throw so caller knows it failed
    throw new Error(`Failed to record generated file in database: ${err.message}`);
  }
}

export async function getGeneratedFilesForYear(env, year, user, docType) {
  requireSuperadmin(user);
  const { results } = docType
    ? await env.DB_FILE_INDEX.prepare('SELECT * FROM generated_files WHERE year = ? AND doc_type = ? ORDER BY generated_at DESC').bind(parseInt(year), docType).all()
    : await env.DB_FILE_INDEX.prepare('SELECT * FROM generated_files WHERE year = ? ORDER BY generated_at DESC').bind(parseInt(year)).all();
  return results;
}

// ---- Docx -> PDF conversion ----
// isAutoGenerate=true: called right after a COLLECTIONS save (own new entry's own
// document) — allowed for Admin/Subadmin. false/omitted (Download Center manual
// "Generate Now", Bulk Generate PDFs) stays Superadmin-only. Public callers
// (Consent page) pass user=null — the record_id + token-gated data flow already
// authorized the request upstream.
export async function convertDocxToPdf(env, docType, year, recordId, base64, fileName, user, isAutoGenerate) {
  if (user) { isAutoGenerate ? requireAdminOrAbove(user) : requireSuperadmin(user); }
  if (!DOC_TYPES.includes(docType)) throw new Error('Invalid doc type');
  if (!base64) throw new Error('File required');
  if (!env.DRIVE_ROOT_FOLDER_ID) throw new Error('DRIVE_ROOT_FOLDER_ID not configured on server');

  if (recordId) {
    const existing = await isFileGenerated(env, docType, year, recordId);
    if (existing) return { success: true, skipped: true, publicLink: existing.public_link };
  }

  const genFolderId = await getOrCreateFolder(env, env.DRIVE_ROOT_FOLDER_ID, 'Generated PDFs');
  const typeFolderName = TYPE_FOLDER_NAMES[docType];
  const typeFolderId = await getOrCreateFolder(env, genFolderId, typeFolderName);
  const yearFolderId = await getOrCreateFolder(env, typeFolderId, String(year));

  const { fileId, fileName: pdfName } = await convertDocxBytesToPdf(env, base64, fileName || 'document.docx', yearFolderId);
  const publicLink = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const drivePath = `Generated PDFs/${typeFolderName}/${year}/${pdfName}`;
  
  // Record in database - this MUST succeed for public portal to show the file
  if (recordId) {
    try {
      await recordGeneratedFile(env, docType, year, recordId, pdfName, publicLink, drivePath);
    } catch (err) {
      // PDF was created in Drive but database record failed - this is critical
      console.error('[convertDocxToPdf] PDF created but database record failed:', err.message);
      // Return the link anyway so frontend can show it, but flag that index failed
      return { 
        success: true, 
        skipped: false, 
        publicLink, 
        fileName: pdfName,
        indexFailed: true,
        error: 'PDF generated but not indexed for public portal. Contact admin.'
      };
    }
  }

  return { success: true, skipped: false, publicLink, fileName: pdfName };
}

export async function convertDocxToPdfPublic(env, docType, year, recordId, base64, fileName) {
  return convertDocxToPdf(env, docType, year, recordId, base64, fileName, null, false);
}

// ---- Batch placeholder resolution for Bulk "Generate PDFs" ----

const parseAmt = (v) => parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;
// Same fix as templates.js's formatAmt — guard on the parsed number, not raw
// truthiness, so a literal "0" is treated as "no amount" too.
const formatAmt = (v) => (parseAmt(v) > 0 ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(parseAmt(v)) : '');
const isTruthyFlag = (v) => v === true || v === 'true' || v === 'TRUE' || v === '1';

function statusLabel(s, c) {
  if (s === 'accepted') return 'Accepted / स्वीकृत' + (c.verification_status === 'verified' ? ' — Verified / सत्यापित' : c.verification_status === 'rejected' ? ' — Rejected / अस्वीकृत' : ' — Pending Verification / सत्यापन लंबित');
  if (s === 'declined') return 'Declined / अस्वीकृत';
  return 'Pending / लंबित';
}

export async function getRecordsForDocType(env, docType, year, user) {
  await requireYearAccess(env, user, year);
  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  const nameOf = (id) => (userMap[id] && userMap[id].Name) || id;

  if (docType === 'receipt' || docType === 'certificate') {
    const wantCert = docType === 'certificate';
    const collections = filterByYear(await getSheetDataAsJSON(env, 'COLLECTIONS'), year)
      .filter(c => !isTruthyFlag(c['Is Resell']))
      .filter(c => c['Contribution Type'] !== '2')
      .filter(c => (wantCert ? c['Certificate Or Receipt'] === 'Certificate' : c['Certificate Or Receipt'] !== 'Certificate'));
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
    const collections = filterByYear(await getSheetDataAsJSON(env, 'COLLECTIONS'), year)
      .filter(c => !isTruthyFlag(c['Is Resell']))
      .filter(c => c['Contribution Type'] === '2');
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
  const wantLoaner = docType === 'consent_loaner';
  const loans = (await getSheetDataAsJSON(env, 'LOANS')).filter(l => parseInt(l.Year) === parseInt(year));
  const { results: allConsents } = await env.DB_LOANS_EXPENSES.prepare("SELECT * FROM loan_consents WHERE status != 'replaced'").all();

  const out = [];
  loans.forEach(loan => {
    const consents = allConsents.filter(c => c.loan_id === loan['Loan ID']);
    const targetConsents = consents.filter(c => c.role === (wantLoaner ? 'loaner' : 'guarantor') && c.status === 'accepted');
    if (!targetConsents.length) return;
    const guarantorConsents = consents.filter(c => c.role === 'guarantor');
    const base = {
      FUND_YEAR: year, LOAN_AMOUNT: loan.Amount, MONTHLY_INTEREST_RATE: loan['Intrest Rate'] || loan['Interest Rate'] || '0',
      MINIMUM_TENURE_MONTHS: loan.Tenure || '', FINAL_REPAYMENT_DATE: loan['Final Repayment Date'] || '',
      LOANER_NAME: nameOf(loan.Name),
    };
    guarantorConsents.forEach((c, i) => {
      base[`GUARANTOR_${i + 1}_NAME`] = nameOf(c.person_id);
      base[`GUARANTOR_${i + 1}_STATUS`] = statusLabel(c.status, c);
    });
    targetConsents.forEach(c => {
      const recordId = `${docType}-${year}-${c.consent_id}`;
      const placeholders = wantLoaner
        ? Object.assign({}, base, { LOAN_CONSENT_ID: c.consent_id })
        : Object.assign({}, base, { CONSENT_ID: c.consent_id, GUARANTOR_NAME: nameOf(c.person_id) });
      out.push({ recordId, fileNameHint: `${docType}-${c.consent_id}`, placeholders });
    });
  });
  return out;
}

// ---- Download Center ----

export async function searchUsersByVillageAndName(env, village, query) {
  if (!village) throw new Error('Village required');
  const q = (query || '').toString().trim().toLowerCase();
  return (await getSheetDataAsJSON(env, 'USERS'))
    .filter(u => (u.Village || '').toString().trim() === village.toString().trim())
    .filter(u => {
      if (!q) return true;
      return (u.Name || '').toString().toLowerCase().includes(q) || (u.Mobile || '').toString().toLowerCase().includes(q) || (u.ID || '').toString().toLowerCase().includes(q);
    })
    .slice(0, 50)
    .map(u => ({ ID: u.ID, Name: u.Name, Village: u.Village, Mobile: u.Mobile || '' }));
}

export async function getPersonDownloads(env, userId, user) {
  requireStaffRole(user);
  if (!userId) throw new Error('User ID required');
  const id = userId.toString().trim();

  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  const u = userMap[id];
  if (!u) throw new Error('User not found');
  const nameOf = (pid) => (userMap[pid] && userMap[pid].Name) || pid;

  const allCollections = (await getSheetDataAsJSON(env, 'COLLECTIONS'))
    .filter(r => (r.Name || '').toString().trim() === id)
    .filter(r => !isTruthyFlag(r['Is Resell']));

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
    const gen = await isFileGenerated(env, docType, year, recordId);
    collections.push({
      recordId, docType, year,
      label: `${isSamaan ? 'Samaan' : (wantCert ? 'Certificate' : 'Receipt')} — ${year}${placeholders.AMOUNT ? ' — ₹' + placeholders.AMOUNT : ''}`,
      fileNameHint: `${docType}-${placeholders[docNoKey]}`,
      placeholders,
      publicLink: gen ? gen.public_link : null,
    });
  }
  collections.sort((a, b) => b.year - a.year);

  const { results: allConsents } = await env.DB_LOANS_EXPENSES.prepare("SELECT * FROM loan_consents WHERE status != 'replaced'").all();
  const buildBase = (loan) => {
    const consents = allConsents.filter(c => c.loan_id === loan['Loan ID']);
    const guarantorConsents = consents.filter(c => c.role === 'guarantor');
    const base = {
      FUND_YEAR: loan.Year, LOAN_AMOUNT: loan.Amount, MONTHLY_INTEREST_RATE: loan['Intrest Rate'] || loan['Interest Rate'] || '0',
      MINIMUM_TENURE_MONTHS: loan.Tenure || '', FINAL_REPAYMENT_DATE: loan['Final Repayment Date'] || '',
      LOANER_NAME: nameOf(loan.Name),
    };
    guarantorConsents.forEach((c, i) => {
      base[`GUARANTOR_${i + 1}_NAME`] = nameOf(c.person_id);
      base[`GUARANTOR_${i + 1}_STATUS`] = statusLabel(c.status, c);
    });
    return base;
  };

  const allLoans = await getSheetDataAsJSON(env, 'LOANS');
  const loanById = {};
  allLoans.forEach(l => { loanById[l['Loan ID']] = l; });

  const loanerItems = [];
  for (const loan of allLoans.filter(l => (l.Name || '').toString().trim() === id)) {
    const year = parseInt(loan.Year);
    const c = allConsents.find(x => x.loan_id === loan['Loan ID'] && x.role === 'loaner' && x.status === 'accepted');
    if (!c) continue;
    const recordId = `consent_loaner-${year}-${c.consent_id}`;
    const placeholders = Object.assign({}, buildBase(loan), { LOAN_CONSENT_ID: c.consent_id });
    const gen = await isFileGenerated(env, 'consent_loaner', year, recordId);
    loanerItems.push({
      recordId, docType: 'consent_loaner', year,
      label: `Loan Consent (as Loaner) — ${year} — ₹${loan.Amount}`,
      fileNameHint: `consent_loaner-${c.consent_id}`, placeholders,
      publicLink: gen ? gen.public_link : null,
    });
  }
  loanerItems.sort((a, b) => b.year - a.year);

  const guarantorItems = [];
  for (const c of allConsents.filter(c => c.role === 'guarantor' && c.status === 'accepted' && (c.person_id || '').toString().trim() === id)) {
    const loan = loanById[c.loan_id];
    if (!loan) continue;
    const year = parseInt(loan.Year);
    const recordId = `consent_guarantor-${year}-${c.consent_id}`;
    const placeholders = Object.assign({}, buildBase(loan), { CONSENT_ID: c.consent_id, GUARANTOR_NAME: nameOf(c.person_id) });
    const gen = await isFileGenerated(env, 'consent_guarantor', year, recordId);
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
