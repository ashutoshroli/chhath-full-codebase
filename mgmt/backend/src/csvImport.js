// ============ CSV BULK IMPORT (Superadmin) ============
//
// Bulk-creates rows for the ordinary data sheets from a CSV the Superadmin
// uploads on the "Upload CSVs" screen. It deliberately REUSES saveRecord() for
// every row, so each import goes through the SAME validation, id allocation
// (USER####, per-year sl_no) and year-lock/access checks as a manual add — there
// is no separate, drift-prone insert path. That is what keeps a bulk import from
// creating rows a manual add never could.
//
// SUPPORTED SHEETS (safe generic-CRUD sheets only):
//   USERS             — people (name, village, mobile, ...). NOT login accounts.
//   COLLECTIONS       — contributions (name, amount, contribution type, ...).
//   COMMITEE MEMBERS  — committee roster (year, name, view role, ...).
//
// DELIBERATELY EXCLUDED:
//   LOANS — a loan is not a single row. saveLoanTransaction() requires exactly 3
//   distinct, non-committee guarantors AND creates 4 consent records + WhatsApp
//   invitations in one transaction. A raw bulk insert of loan rows would create
//   orphan loans with no guarantors/consents that can never be approved or repaid
//   — an unrecoverable state. Loans must be entered through the Loans screen.
//   LOGIN accounts, EXPENSES(*) and everything else are likewise out of scope
//   here (expenses could be added later; kept minimal on purpose).

import { saveRecord } from './crud.js';
import { requireSuperadmin, ValidationError } from './auth.js';

// The only sheets this importer will touch, with the exact HEADER names each CSV
// column maps to (these are the same header-keyed names saveRecord/tableRegistry
// already use). `required` mirrors what a manual add needs; `known` is the full
// set of columns we will read (any other CSV column is ignored, not an error).
const IMPORT_SHEETS = {
  USERS: {
    label: 'Users',
    required: ['Name'],
    known: ['Name', 'Name (Hindi)', 'Village', 'Village (Hindi)', "Father's Name",
      "Father's Name (Hindi)", 'Mobile', 'Designation', 'Designation (Hindi)', 'Email', 'WhatsApp'],
  },
  COLLECTIONS: {
    label: 'Collections',
    required: ['Name', 'Amount'], // Amount is conditionally required — saveRecord enforces the real rule
    known: ['Year', 'Name', 'Amount', 'Payment Mode', 'Date', 'Contribution Type',
      'Detail', 'Certificate Or Receipt', 'UTR', 'Is Resell'],
  },
  'COMMITEE MEMBERS': {
    label: 'Committee Members',
    required: ['Name'],
    known: ['Year', 'Name', 'View Role', 'View Role (Hindi)', 'WhatsApp'],
  },
};

export function importableSheets() {
  return Object.keys(IMPORT_SHEETS).map(k => ({ key: k, label: IMPORT_SHEETS[k].label }));
}

// Normalise a sheet name the client sent to one of our allowed keys.
function resolveImportSheet(sheetName) {
  const n = (sheetName || '').toString().trim().toUpperCase();
  return IMPORT_SHEETS[n] ? n : null;
}

// rows: array of plain objects keyed by the CSV header (already parsed on the
// client). We validate/insert them one at a time via saveRecord and collect a
// per-row outcome so the UI can show "X imported, Y skipped, and WHY".
//
// The import is NOT atomic on purpose: a bad row must not discard the good ones
// (a volunteer fixing a 500-row sheet wants the 480 valid rows in, and a precise
// list of the 20 to fix). Each saveRecord is its own statement/allocation.
export async function importCsvRows(env, sheetName, rows, user) {
  // Superadmin-only — the same gate the Upload CSVs tab is behind. saveRecord()
  // additionally enforces requireRole('add') per row, so this is defence in depth.
  requireSuperadmin(user);

  const sheetKey = resolveImportSheet(sheetName);
  if (!sheetKey) {
    throw ValidationError('This section cannot be bulk-imported. Choose Users, Collections, or Committee Members.');
  }
  if (!Array.isArray(rows)) throw ValidationError('No rows were provided.');

  const spec = IMPORT_SHEETS[sheetKey];
  const MAX_ROWS = 2000; // a generous cap; keeps one request well within limits
  if (rows.length > MAX_ROWS) {
    throw ValidationError(`Too many rows (${rows.length}). Please split the file into chunks of ${MAX_ROWS} or fewer.`);
  }

  const report = {
    sheet: sheetKey,
    label: spec.label,
    total: rows.length,   // rows READ from the CSV (excluding the header)
    imported: 0,          // rows successfully inserted
    skipped: 0,           // rows rejected (with a reason)
    failures: [],         // [{ row: <1-based data row #>, reason, name }]
  };

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i] || {};
    const rowNum = i + 1; // 1-based, matching what a user sees under the header

    // Keep only the columns we know about, trimming strings. Unknown columns are
    // ignored (not an error) so an extra column in the sheet doesn't fail a row.
    const payload = {};
    for (const col of spec.known) {
      if (raw[col] !== undefined && raw[col] !== null) {
        payload[col] = raw[col].toString().trim();
      }
    }

    // A completely blank line (common trailing row in exported CSVs) is skipped
    // silently — it isn't a real record and shouldn't count as a failure.
    const hasAnyValue = Object.values(payload).some(v => v !== '');
    if (!hasAnyValue) {
      report.skipped++;
      report.failures.push({ row: rowNum, name: '', reason: 'Empty row — skipped.' });
      continue;
    }

    try {
      await saveRecord(env, sheetKey, payload, user);
      report.imported++;
    } catch (err) {
      report.skipped++;
      report.failures.push({
        row: rowNum,
        name: (payload.Name || payload['Name'] || '').toString(),
        // saveRecord throws ValidationError/PermissionError with a human message
        // (e.g. "Mobile must be 10 digits", "Missing required field: Amount",
        // year locked, etc.). Surface that exact reason so the operator knows
        // what to fix, without leaking internal detail.
        reason: (err && err.message) ? err.message : 'Could not be imported.',
      });
    }
  }

  return { success: true, report };
}
