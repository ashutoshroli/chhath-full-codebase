import { resolveSheet, toColumnPayload, fromColumnRow } from './tableRegistry.js';
import { requireRole, requireYearUnlocked, requireYearAccess } from './auth.js';
import { logErrorAt } from './logger.js';
import { isTruthyFlag } from './flags.js';

const DB_BINDINGS = {
  core: 'DB_CORE',
  collections: 'DB_COLLECTIONS',
  loans_expenses: 'DB_LOANS_EXPENSES',
  templates: 'DB_TEMPLATES',
  file_index: 'DB_FILE_INDEX',
  whatsapp_index: 'DB_WHATSAPP_INDEX',
  logs: 'DB_LOGS',
  misc: 'DB_MISC',
};

export function dbFor(env, dbName) {
  const binding = DB_BINDINGS[dbName];
  if (!binding || !env[binding]) throw new Error(`No D1 binding for db "${dbName}" (expected env.${binding})`);
  return env[binding];
}

// D1 tables (resolved names) that carry a `year` column and are therefore
// subject to the year-lock / year-access checks. USERS and LOGIN have no year
// column, so a `SELECT year` there would D1-error — they're deliberately absent.
const TABLES_WITH_YEAR = new Set(['collections', 'expenses', 'committee_members', 'loans', 'loan_guarantors']);

// Equivalent of getSheetDataAsJSON(sheetName) — returns rows in the original
// header-keyed shape the frontend already expects, `__rowIndex` included.
export async function getSheetDataAsJSON(env, sheetName) {
  const { db, table } = resolveSheet(sheetName);
  const d1 = dbFor(env, db);
  const { results } = await d1.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all();
  return results.map(r => fromColumnRow(table, r));
}

export function filterByYear(rows, year) {
  if (!year || year === 'All') return rows;
  return rows.filter(r => parseInt(r.Year) === parseInt(year));
}

// Verbatim copy of Code.js's REQUIRED_FIELDS (line ~1012).
const REQUIRED_FIELDS = {
  COLLECTIONS: ['Name', 'Amount'],
  EXPENSES: ['Discription', 'Amount'],
  USERS: ['Name'],
  'COMMITEE MEMBERS': ['Name'],
  LOANS: ['Name', 'Amount'],
};

// isTruthyFlag now comes from the shared flags.js util (audit 6.1) — see the
// import at the top of this file.

function validatePayload(sheetName, payload) {
  const normalized = sheetName.toString().trim().toUpperCase();
  const isResell = normalized === 'COLLECTIONS' && isTruthyFlag(payload['Is Resell']);
  const required = REQUIRED_FIELDS[normalized] || [];
  for (const f of required) {
    if (normalized === 'COLLECTIONS' && f === 'Amount' && (payload['Contribution Type'] || '1').toString() !== '1') continue;
    if (normalized === 'COLLECTIONS' && f === 'Name' && isResell) continue;
    if (payload[f] === undefined || payload[f] === null || payload[f].toString().trim() === '') {
      throw new Error(`Missing required field: ${f}`);
    }
  }
  if (normalized === 'COLLECTIONS' && isResell && !(payload.Detail || '').toString().trim()) {
    throw new Error('The name of the resold item is required');
  }
  if (normalized === 'COLLECTIONS' && !isResell && (payload['Contribution Type'] || '1').toString() !== '1' && !(payload.Detail || '').toString().trim()) {
    throw new Error('Detail is required for this Contribution Type');
  }
  if (payload.Amount !== undefined && payload.Amount !== '' && isNaN(parseFloat(payload.Amount))) {
    throw new Error('Amount must be a number');
  }
  ['Mobile', 'WhatsApp'].forEach(f => {
    if (payload[f] !== undefined && payload[f] !== null && payload[f].toString().trim() !== '') {
      if (!/^\d{10}$/.test(payload[f].toString().trim())) {
        throw new Error(f + ' must be 10 digits');
      }
    }
  });
}

export async function saveRecord(env, sheetName, payload, user) {
  requireRole(user, 'add', sheetName);
  if (payload.Year) await requireYearUnlocked(env, payload.Year);
  if (payload.Year) await requireYearAccess(env, user, payload.Year);
  validatePayload(sheetName, payload);

  const { db, table } = resolveSheet(sheetName);
  const d1 = dbFor(env, db);
  const normalized = sheetName.toString().trim().toUpperCase();

  if (normalized === 'USERS') {
    const last = await d1.prepare("SELECT id_code FROM users WHERE id_code LIKE 'USER%' ORDER BY CAST(SUBSTR(id_code,5) AS INTEGER) DESC LIMIT 1").first();
    let maxId = 0;
    if (last && last.id_code) maxId = parseInt(last.id_code.replace('USER', '')) || 0;
    payload.ID = 'USER' + String(maxId + 1).padStart(4, '0');
  }
  if (normalized === 'COLLECTIONS') {
    const row = await d1.prepare('SELECT MAX(sl_no) as maxSl FROM collections WHERE year = ?').bind(payload.Year).first();
    payload['Sl. No.'] = (row && row.maxSl ? row.maxSl : 0) + 1;
  }

  payload['Created By'] = user ? user.name : payload['Created By'];
  const cols = toColumnPayload(table, payload);
  const keys = Object.keys(cols);
  const placeholders = keys.map(() => '?').join(', ');
  const result = await d1.prepare(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
  ).bind(...keys.map(k => cols[k])).run();

  const rowIndex = result.meta.last_row_id;
  return { success: true, id: payload.ID || null, rowIndex };
}

export async function updateRecordByIdx(env, sheetName, rowIndex, payload, user) {
  requireRole(user, 'edit', sheetName);

  const { db, table } = resolveSheet(sheetName);
  const d1 = dbFor(env, db);

  // SECURITY (audit 2.1 — IDOR / year-lock bypass on edit): the lock + access
  // checks used to run ONLY against payload.Year, which is CLIENT-supplied. A
  // caller could send a payload.Year that is unlocked / they have access to,
  // while `rowIndex` actually points at a row in a LOCKED year (or a year they
  // must not touch), and the UPDATE went through. deleteRecordByIdx was already
  // hardened this way; the edit path must match it — enforce against the row's
  // STORED year first, then also against payload.Year so a record can't be moved
  // into a locked/forbidden year.
  //
  // Only tables that actually carry a `year` column participate in the lookup
  // (USERS / LOGIN have none — SELECTing `year` there would D1-error and wrongly
  // block every edit). For those year-less tables there is nothing to lock.
  if (TABLES_WITH_YEAR.has(table)) {
    let stored;
    try {
      stored = await d1.prepare(`SELECT year FROM ${table} WHERE id = ?`).bind(rowIndex).first();
    } catch (err) {
      await logErrorAt(env, 'backend-crud', 'updateRecordByIdx:yearLookup', err, { sheetName, table, rowIndex });
      throw new Error('Could not verify the record\'s year before updating — the update was stopped for safety. Please try again.');
    }
    if (!stored) throw new Error('Record not found (or it has already been deleted).');

    if (stored.year) {
      await requireYearUnlocked(env, stored.year);
      await requireYearAccess(env, user, stored.year);
    }
    if (payload.Year && parseInt(payload.Year) !== parseInt(stored.year)) {
      await requireYearUnlocked(env, payload.Year);
      await requireYearAccess(env, user, payload.Year);
    }
  }

  validatePayload(sheetName, payload);

  const cols = toColumnPayload(table, payload);
  const keys = Object.keys(cols);
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  await d1.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`)
    .bind(...keys.map(k => cols[k]), rowIndex).run();

  // Editing a Collection used to leave its already-generated PDF untouched:
  // autoGeneratePdf ran again but convertDocxToPdf saw the existing index row and
  // returned `{skipped:true}` with the OLD link, so a corrected amount/name never
  // reached the PDF while that stale link was still attached to WhatsApp messages
  // and served by the public portal. Dropping the index row makes the very next
  // generate produce a fresh, correct document.
  if (table === 'collections') {
    await purgeGeneratedFilesForCollection(env, payload.Year, rowIndex);
  }
  return { success: true, indexInvalidated: table === 'collections' };
}

export async function deleteRecordByIdx(env, sheetName, rowIndex, user) {
  requireRole(user, 'delete');
  const { db, table } = resolveSheet(sheetName);
  const d1 = dbFor(env, db);

  // SECURITY: this used to be
  //   .first().catch(() => null)
  // so if the SELECT failed for ANY reason, `row` became null, BOTH the
  // year-lock and the year-access checks below were skipped entirely, and the
  // DELETE still went through. A failing read must not silently escalate
  // privileges — let it throw.
  let row;
  try {
    row = await d1.prepare(`SELECT year FROM ${table} WHERE id = ?`).bind(rowIndex).first();
  } catch (err) {
    await logErrorAt(env, 'backend-crud', 'deleteRecordByIdx:yearLookup', err, { sheetName, table, rowIndex });
    throw new Error('Could not verify the record\'s year before deletion — the delete was stopped for safety. Please try again.');
  }
  if (!row) throw new Error('Record not found (or it has already been deleted).');

  if (row.year) {
    await requireYearUnlocked(env, row.year);
    await requireYearAccess(env, user, row.year);
  }

  await d1.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(rowIndex).run();

  // A deleted contribution used to keep its generated PDF indexed forever, so
  // the public portal still showed a downloadable "✅ Verified Record" for a
  // record that no longer exists. Drop the index rows for this record.
  if (table === 'collections') {
    await purgeGeneratedFilesForCollection(env, row.year, rowIndex);
  }
  return { success: true };
}

// A COLLECTIONS row can back a receipt, a certificate OR a samaan document, and
// the recordId scheme is `<docType>-<year>-<rowIndex>` — so clear all three.
async function purgeGeneratedFilesForCollection(env, year, rowIndex) {
  if (!env.DB_FILE_INDEX) return;
  try {
    const y = parseInt(year);
    for (const docType of ['receipt', 'certificate', 'samaan']) {
      await env.DB_FILE_INDEX.prepare(
        'DELETE FROM generated_files WHERE doc_type = ? AND year = ? AND record_id = ?'
      ).bind(docType, y, `${docType}-${y}-${rowIndex}`).run();
    }
  } catch (err) {
    // Non-fatal: the record IS deleted. But make the stale-index state visible.
    await logErrorAt(env, 'backend-crud', 'purgeGeneratedFilesForCollection', err, { year, rowIndex });
  }
}
