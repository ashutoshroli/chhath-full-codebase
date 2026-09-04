import { resolveSheet, toColumnPayload, fromColumnRow } from './tableRegistry.js';
import { requireRole, requireYearUnlocked, requireYearAccess, PermissionError, ValidationError, InternalError } from './auth.js';
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
  if (!binding || !env[binding]) throw InternalError(`No D1 binding for db "${dbName}" (expected env.${binding})`);
  return env[binding];
}

// ============ GENERIC-CRUD SHEET WHITELIST (audit C-1) ============
//
// SECURITY: the `sheet` parameter of the generic saveRecord / updateRecord /
// deleteRecord router actions is CLIENT-SUPPLIED, and resolveSheet() happily
// resolves every entry in TABLE_REGISTRY — including `login` (login_users),
// `loan_consents`, `generated_files`, `activity log`, `error_log` and
// `portal_settings`.
//
// requireRole() only scoped the sheet name for the 'add' action, and an Admin
// holds 'edit'. So an Admin could send
//     { action:'updateRecord', sheet:'LOGIN', rowIndex:<own row>,
//       payload:{ Role:'Superadmin' } }
// and escalate to Superadmin (verifyToken re-reads the live role, so it took
// effect on the very next request). The same primitive also allowed:
//   * sheet:'loan_consents' -> flip a consent to 'accepted' / 'verified' with no
//     OTP, photo, signature or geolocation — forging a legally binding document;
//   * sheet:'generated_files' -> repoint a public_link the public portal renders
//     as a "Verified Record";
//   * sheet:'activity log' -> edit the audit trail meant to prove who did what.
// None of those tables carry a `year` column either, so even the year-lock and
// year-access checks were skipped, and validatePayload() has no required fields
// for them.
//
// Every one of those tables has its own dedicated, individually-gated handler
// (updateLoginUser, setConsentVerification, convertDocxToPdf, ...). The generic
// endpoint therefore only needs the six ordinary data sheets the UI actually
// posts to — verified against the frontend, which passes exactly USERS,
// COLLECTIONS, EXPENSES, 'COMMITEE MEMBERS' and LOANS ('LOAN GUARANTOR' is
// written by saveLoanTransaction, not through this path, but is kept here so the
// six real data sheets stay symmetric).
const GENERIC_CRUD_SHEETS = new Set([
  'USERS', 'COLLECTIONS', 'EXPENSES', 'COMMITEE MEMBERS', 'LOANS', 'LOAN GUARANTOR',
]);

// Throws PermissionError unless `sheetName` is one of the six ordinary data
// sheets. Returns the normalised (upper-case, trimmed) name.
export function assertGenericSheetAllowed(sheetName) {
  const normalized = (sheetName || '').toString().trim().toUpperCase();
  if (!GENERIC_CRUD_SHEETS.has(normalized)) {
    throw PermissionError(
      `"${sheetName}" cannot be changed from this screen. Please use its own dedicated screen instead.`
    );
  }
  return normalized;
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

// SCALABILITY (Phase 1): year-scoped variant of getSheetDataAsJSON. Instead of a
// full-table scan followed by a JS `filterByYear`, this pushes `WHERE year = ?`
// into D1 so the existing per-table year indexes (idx_<table>_year) are used.
// Returns the IDENTICAL header-keyed shape (same fromColumnRow mapping, same
// `ORDER BY id ASC`), so callers get byte-for-byte the same rows they got from
// `filterByYear(getSheetDataAsJSON(...), year)` — only cheaper.
//
// For year === 'All' / empty there is nothing to scope, so it falls back to the
// full read (that view genuinely needs every row). Only tables that actually have
// a `year` column are eligible; anything else falls back to the full read too, so
// this can never produce a "no such column: year" error.
export async function getSheetDataByYear(env, sheetName, year) {
  const { db, table } = resolveSheet(sheetName);
  if (!year || year === 'All' || !TABLES_WITH_YEAR.has(table)) {
    return getSheetDataAsJSON(env, sheetName);
  }
  const y = parseInt(year);
  if (!y) return getSheetDataAsJSON(env, sheetName);
  const d1 = dbFor(env, db);
  const { results } = await d1.prepare(`SELECT * FROM ${table} WHERE year = ? ORDER BY id ASC`).bind(y).all();
  return results.map(r => fromColumnRow(table, r));
}

// SCALABILITY (Phase 1): fetch rows of a table where an INDEXED text column equals
// a value (e.g. collections by contributor `name`, loans by `name`,
// loan_guarantors by `guarantor`). Same shape as getSheetDataAsJSON. `column` is a
// real D1 column name and MUST be validated by the caller against a fixed
// whitelist — never pass user input directly. Guarded by SNAKE_SAFE as defence in
// depth so it can never become an injection point.
export async function getSheetDataByColumn(env, sheetName, column, value) {
  const { db, table } = resolveSheet(sheetName);
  if (!/^[a-z][a-z0-9_]*$/.test(column)) {
    throw Object.assign(new Error(`Unsafe column for scoped read: ${column}`), { authError: false });
  }
  const d1 = dbFor(env, db);
  const { results } = await d1.prepare(`SELECT * FROM ${table} WHERE ${column} = ? ORDER BY id ASC`).bind(value).all();
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
      throw ValidationError(`Missing required field: ${f}`);
    }
  }
  if (normalized === 'COLLECTIONS' && isResell && !(payload.Detail || '').toString().trim()) {
    throw ValidationError('The name of the resold item is required');
  }
  if (normalized === 'COLLECTIONS' && !isResell && (payload['Contribution Type'] || '1').toString() !== '1' && !(payload.Detail || '').toString().trim()) {
    throw ValidationError('Detail is required for this Contribution Type');
  }
  if (payload.Amount !== undefined && payload.Amount !== '' && isNaN(parseFloat(payload.Amount))) {
    throw ValidationError('Amount must be a number');
  }
  ['Mobile', 'WhatsApp'].forEach(f => {
    if (payload[f] !== undefined && payload[f] !== null && payload[f].toString().trim() !== '') {
      if (!/^\d{10}$/.test(payload[f].toString().trim())) {
        throw ValidationError(f + ' must be 10 digits');
      }
    }
  });
}

export async function saveRecord(env, sheetName, payload, user) {
  assertGenericSheetAllowed(sheetName); // audit C-1 — must be the FIRST check
  requireRole(user, 'add', sheetName);
  if (payload.Year) await requireYearUnlocked(env, payload.Year);
  if (payload.Year) await requireYearAccess(env, user, payload.Year);
  validatePayload(sheetName, payload);

  const { db, table } = resolveSheet(sheetName);
  const d1 = dbFor(env, db);
  const normalized = sheetName.toString().trim().toUpperCase();

  // ---- audit H-9: allocate the sequential id INSIDE the INSERT ----
  //
  // Both USERS (`id_code` = 'USER####') and COLLECTIONS (`sl_no`, per year) used
  // to be allocated read-then-write:
  //
  //     const last = await ...SELECT MAX(...)      <-- statement 1
  //     payload.ID = 'USER' + (max + 1)
  //     await ...INSERT...                          <-- statement 2
  //
  // D1 has no interactive transaction spanning two awaits, so two saves that
  // interleave between statement 1 and statement 2 BOTH read the same MAX and
  // BOTH insert the same id. The window is a whole network round trip wide, and
  // the app makes it easy to hit: Home's Save and the Users screen's Save are the
  // two most-used buttons, and two data-entry volunteers working the same year
  // during a collection drive collide routinely. Nothing detected it — there was
  // no unique constraint — so the result was two members sharing one USER####
  // (which silently merges their profiles, receipts and loan consents, because
  // every lookup in the portal joins on id_code) or two collections sharing one
  // Sl. No. (duplicate receipt numbers).
  //
  // The fix makes allocation and insertion ONE statement. A single SQL statement
  // is atomic in SQLite/D1, so the MAX is read and the row is written without any
  // window for a second writer.
  //
  // Statement count is UNCHANGED (the removed MAX read pays for the read-back
  // below), so there is no free-tier cost.
  let generated = null; // { col, expr, binds, resultKey }
  if (normalized === 'USERS') {
    delete payload.ID; // never trust/keep a client-supplied ID — as before
    generated = {
      col: 'id_code',
      // printf('USER%04d', n) is exactly String(n).padStart(4, '0') with the
      // prefix, including past 9999 (-> 'USER10000'), matching the old JS.
      expr: "(SELECT printf('USER%04d', COALESCE(MAX(CAST(SUBSTR(id_code, 5) AS INTEGER)), 0) + 1) "
        + "FROM users WHERE id_code LIKE 'USER%')",
      binds: [],
      resultKey: 'id',
    };
  }
  if (normalized === 'COLLECTIONS') {
    delete payload['Sl. No.'];
    generated = {
      col: 'sl_no',
      expr: '(SELECT COALESCE(MAX(sl_no), 0) + 1 FROM collections WHERE year = ?)',
      binds: [payload.Year],
      resultKey: 'slNo',
    };
  }

  payload['Created By'] = user ? user.name : payload['Created By'];
  const cols = toColumnPayload(table, payload);
  const keys = Object.keys(cols);
  const valueSql = keys.map(() => '?');
  const binds = keys.map(k => cols[k]);
  if (generated) {
    keys.push(generated.col);
    valueSql.push(generated.expr);
    binds.push(...generated.binds);
  }

  const result = await d1.prepare(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${valueSql.join(', ')})`
  ).bind(...binds).run();

  const rowIndex = result.meta.last_row_id;

  // Read back the value the database assigned. RETURNING would save this hop, but
  // it is used nowhere else in this Worker, so it stays unverified against real
  // D1 — and `meta.last_row_id` is already relied on above. This costs the same
  // one statement the deleted MAX() lookup used to.
  const out = { success: true, id: null, rowIndex };
  if (generated) {
    const back = await d1.prepare(`SELECT ${generated.col} FROM ${table} WHERE id = ?`)
      .bind(rowIndex).first();
    const value = back ? back[generated.col] : null;
    out[generated.resultKey] = value;
    // QuickAddUser reads `res.id` to preselect the member it just created, and
    // index.js's activity-log summary reports the allocated Sl. No. Put the value
    // back on the payload so summarizePayload() still sees it.
    if (generated.col === 'id_code') payload.ID = value;
    if (generated.col === 'sl_no') payload['Sl. No.'] = value;
  }
  return out;
}

export async function updateRecordByIdx(env, sheetName, rowIndex, payload, user) {
  assertGenericSheetAllowed(sheetName); // audit C-1 — must be the FIRST check
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
      throw InternalError(
        `updateRecordByIdx: year lookup on ${table} failed: ${err && err.message || err}`,
        'The update was stopped because the record\'s year could not be checked. Nothing was changed — please try again.'
      );
    }
    if (!stored) throw ValidationError('Record not found (or it has already been deleted).');

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
  assertGenericSheetAllowed(sheetName); // audit C-1 — must be the FIRST check
  // The sheet name was previously NOT passed here, so no per-sheet policy could
  // ever apply to a delete.
  requireRole(user, 'delete', sheetName);
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
    throw InternalError(
      `deleteRecordByIdx: year lookup on ${table} failed: ${err && err.message || err}`,
      'The delete was stopped because the record\'s year could not be checked. Nothing was deleted — please try again.'
    );
  }
  if (!row) throw ValidationError('Record not found (or it has already been deleted).');

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
