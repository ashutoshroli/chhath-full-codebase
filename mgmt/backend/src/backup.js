// ============ FULL BACKUP & RESTORE (Superadmin only) ============
//
// Purpose: give the Superadmin a one-click "download everything" backup of the
// portal's DATABASE data (all 8 D1 databases, every table), and a guarded
// "restore from that backup" path.
//
// SCOPE / DESIGN NOTES (read before changing):
//   * This backs up the D1 *data* only. Uploaded FILES (consent photos/
//     signatures, generated PDFs, popup images) live on R2 / Google Drive and
//     are NOT copied into the backup — a single year can be many GB and a Worker
//     cannot build a multi-GB zip within its memory/CPU limits. The backup DOES
//     record every file URL (they are ordinary columns in the DB rows), so after
//     a restore the rows still point at the same R2/Drive objects. Keep the R2
//     bucket / Drive folder backed up separately for true file durability.
//   * The zip is assembled CLIENT-SIDE (see Backup.jsx) from the JSON this module
//     returns, so the Worker never has to hold a big binary in memory.
//   * RESTORE IS DESTRUCTIVE. It replaces the contents of each table with the
//     backup's rows. It is Superadmin-only, requires an explicit typed
//     confirmation from the UI, and always takes an automatic safety snapshot of
//     the CURRENT data first (returned to the caller so the UI can offer to save
//     it) before touching anything.
//
// This module deliberately does NOT import or modify any existing behaviour — it
// only READS every table (export) and, on restore, writes rows back through the
// same D1 bindings. Nothing else in the codebase calls into here.

import { requireSuperadmin, ValidationError, InternalError } from './auth.js';
import { randomHex } from './random.js';

const BACKUP_FORMAT_VERSION = 1;

// Every (dbBinding -> [tables]) the portal owns. This is the authoritative list
// of what a full backup contains. It mirrors tableRegistry.js's TABLE_REGISTRY
// but is expressed per-D1-binding because that is how we actually read/write.
// If a NEW table is ever added to the schema, add it here too so it is included
// in backups.
const BACKUP_MAP = {
  DB_CORE: [
    'users', 'committee_members', 'login_users', 'manual_years', 'locked_years',
    'festival_dates', 'portal_settings', 'dropdown_lists',
  ],
  DB_COLLECTIONS: ['collections'],
  DB_LOANS_EXPENSES: [
    'loans', 'expenses', 'loan_guarantors', 'loan_consents', 'loan_message_templates',
  ],
  DB_TEMPLATES: [
    'receipt_templates', 'certificate_templates', 'samaan_templates',
    'consent_page_templates', 'docx_templates', 'doc_pdf_templates', 'pdf_templates',
  ],
  DB_FILE_INDEX: ['generated_files'],
  DB_WHATSAPP_INDEX: [
    'whatsapp_groups', 'group_message_templates', 'person_message_templates',
    'group_messages', 'person_messages',
  ],
  DB_LOGS: ['error_log', 'activity_log'],
  DB_MISC: ['popups', 'popup_slides', 'custom_announcements', 'announcement_links'],
};

// A table name only ever comes from BACKUP_MAP above (never from client input),
// so it is safe to interpolate into SQL. This guard is belt-and-braces: it
// refuses anything that isn't a plain snake_case identifier, so a future typo in
// BACKUP_MAP can never turn into an injection.
const SAFE_IDENT = /^[a-z][a-z0-9_]*$/;
function assertSafeTable(table) {
  if (!SAFE_IDENT.test(table)) throw InternalError(`Unsafe table identifier: ${table}`);
  return table;
}

// Quote a validated (SAFE_IDENT) identifier for use in SQL. Several real columns
// are SQLite RESERVED WORDS — `order` (custom_announcements), `key`
// (portal_settings), `from` (group_messages / person_messages). They pass
// SAFE_IDENT (all lowercase letters) but, emitted UNQUOTED into an INSERT column
// list, raise a syntax error for EVERY row — which (because the table is DELETEd
// first) wiped those four tables' entire contents on restore while the report
// only showed a harmless "rows skipped". Double-quoting makes any identifier,
// reserved or not, safe. Only ever called on identifiers already validated by
// SAFE_IDENT, so there is nothing to escape beyond the quote char itself.
function quoteIdent(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

function dbHandle(env, binding) {
  const db = env[binding];
  if (!db) throw InternalError(`D1 binding ${binding} not configured on server`);
  return db;
}

// Reads every row of one table.
//
// DATA-SAFETY (was a silent data-loss path): this used to `return []` on ANY
// error. A transient read error (timeout, momentary lock, etc.) therefore made a
// table that actually HAD rows come out EMPTY in the backup — and because restore
// wipes each table before inserting, restoring that backup later DELETEd the live
// rows and inserted nothing. Worse, exportBackup is also used to build the
// pre-restore safety snapshot, so a read hiccup could poison the rollback too.
//
// Now: a genuinely ABSENT table (older schema — "no such table") is still treated
// as `[]` (nothing to back up). ANY OTHER error is re-thrown so the whole backup
// fails loudly instead of quietly producing an incomplete/poisoned file.
async function dumpTable(db, table) {
  assertSafeTable(table);
  try {
    const { results } = await db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all();
    return results || [];
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).toLowerCase();
    if (msg.includes('no such table') || msg.includes('no such column')) {
      return []; // table genuinely not on this deployment — safe to treat as empty
    }
    throw InternalError(
      `Backup aborted: could not read table "${table}": ${e && e.message || e}`,
      `The backup was aborted because table "${table}" could not be read. `
      + 'No partial or empty backup file was produced — your data is untouched.'
    );
  }
}

// ---- EXPORT ----
//
// Returns a single JSON-serialisable object containing every table's rows plus
// metadata. The frontend zips this up and triggers a download. Superadmin only.
export async function exportBackup(env, user) {
  requireSuperadmin(user);

  const data = {};
  const counts = {};
  for (const [binding, tables] of Object.entries(BACKUP_MAP)) {
    const db = env[binding];
    data[binding] = {};
    for (const table of tables) {
      const rows = db ? await dumpTable(db, table) : [];
      data[binding][table] = rows;
      counts[`${binding}.${table}`] = rows.length;
    }
  }

  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);

  // SCALE GUARD (audit): exportBackup materialises every row of every table into
  // one in-memory object in a single Worker request. At 32k members + years of
  // collections + message/activity logs this can approach the Worker's memory
  // (128MB) and CPU/wall-clock limits and fail HALF-WAY with an opaque error. We
  // don't refuse (a real backup must still be possible), but we surface a clear
  // warning so a Superadmin knows a very large export may time out and can prune
  // old logs first (activity_log / error_log / message logs are the usual bulk).
  const BACKUP_ROW_WARN = 150000;
  const warnings = [];
  if (totalRows >= BACKUP_ROW_WARN) {
    warnings.push(
      `This backup contains ${totalRows.toLocaleString()} rows. Very large exports can be slow ` +
      `or time out on the free tier — if it fails, clear old activity/error/message logs and retry.`
    );
  }

  return {
    success: true,
    backup: {
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      createdBy: user.name,
      totalRows,
      counts,
      data,
    },
    warnings,
  };
}

// ---- RESTORE ----
//
// Replaces the contents of every table present in the supplied backup with the
// backup's rows. DESTRUCTIVE. Superadmin only + typed confirmation enforced here
// as a second line of defence (the UI also asks). Before touching anything we
// take a fresh export as a safety snapshot and hand it back to the caller.
//
// Strategy per table: DELETE all existing rows, then INSERT the backup rows in
// D1 batches. Column names are taken from each row object's own keys (the same
// shape dumpTable produced), so the round-trip is lossless. A row whose column
// set the live table doesn't have would fail — so a table's insert is wrapped in
// its own try/catch and reported, letting the rest of the restore proceed.
// audit H-16 — restore is now INCREMENTAL, one D1 binding per request.
//
// The old path called exportBackup() up front to build a safety snapshot, so the
// whole DB was materialised TWICE (snapshot + incoming backup) in one 128 MB
// invocation, and a memory/CPU kill could land in the MIDDLE of the table-by-table
// swap — some tables restored, others not, and the rollback snapshot never
// delivered. At the projected 32k-member scale that WILL happen.
//
// The fix (as the audit prescribes):
//   1. The operator must acknowledge they already have a fresh backup
//      (opts.snapshotAcknowledged). The UI downloads one first, so we no longer
//      build a second full export in-request — that is what doubled the memory.
//   2. Restore ONE binding per request (opts.onlyBinding). A kill can then never
//      straddle two databases; at worst one binding is half-swapped, and each
//      table's swap is already atomic + non-destructive (restoreOneTable).
//   3. Called WITHOUT onlyBinding, it is a PLANNING call: it validates, checks the
//      acknowledgement, and returns the ordered list of bindings the UI must walk,
//      one request each. It touches NO data.
//
// Backward-compatible escape hatch: opts.withInRequestSnapshot === true restores
// the whole backup in one request AND takes the in-request snapshot (the old
// behaviour), for a small deployment or a scripted caller. The UI no longer uses
// it. It carries the same scale caveat the old code did, now stated in a warning.
export async function restoreBackup(env, user, backup, confirm, opts = {}) {
  requireSuperadmin(user);

  if ((confirm || '').toString().trim().toUpperCase() !== 'RESTORE') {
    throw ValidationError('Restore not confirmed — type exactly "RESTORE" in the confirmation box.');
  }
  if (!backup || typeof backup !== 'object' || !backup.data) {
    throw ValidationError('The backup file is not valid (no data found).');
  }
  if (backup.formatVersion && backup.formatVersion > BACKUP_FORMAT_VERSION) {
    throw ValidationError(`The backup's format version (${backup.formatVersion}) is newer than this server — please update the deployment first.`);
  }

  const onlyBinding = (opts.onlyBinding || '').toString();
  const withInRequestSnapshot = opts.withInRequestSnapshot === true;

  // ---- PLANNING CALL (no onlyBinding, incremental mode) ----
  // Validate + gate on the acknowledged snapshot, then hand the UI the binding
  // list to walk one request at a time. Touches no data.
  if (!onlyBinding && !withInRequestSnapshot) {
    if (!opts.snapshotAcknowledged) {
      throw ValidationError(
        'Download a fresh backup of the CURRENT data first, then tick "I have a current backup" and run the restore again. '
        + 'This replaces the old automatic snapshot, which could run out of memory on a large database mid-restore.'
      );
    }
    const bindings = Object.keys(BACKUP_MAP).filter(b => backup.data[b]);
    if (!bindings.length) throw ValidationError('The backup contains no known databases to restore.');
    return {
      success: true,
      staged: true,
      incremental: true,
      bindings,
      message: `Ready to restore ${bindings.length} database(s), one at a time. Do not close this tab until it finishes.`,
    };
  }

  // ---- PER-BINDING RESTORE (incremental mode) ----
  if (onlyBinding) {
    if (!BACKUP_MAP[onlyBinding]) throw ValidationError(`Unknown database binding "${onlyBinding}".`);
    if (!opts.snapshotAcknowledged) {
      throw ValidationError('Restore requires an acknowledged current backup (snapshotAcknowledged).');
    }
    const report = { restoredTables: {}, partialTables: {}, emptyTables: {}, skippedTables: {}, errors: [] };
    const tables = backup.data[onlyBinding] || {};
    await restoreBindingTables(env, onlyBinding, tables, report);
    const errCount = report.errors.length;
    return {
      success: errCount === 0,
      report,
      binding: onlyBinding,
      incremental: true,
      message: errCount === 0
        ? `Restored database "${onlyBinding}".`
        : `Database "${onlyBinding}" restored with ${errCount} problem(s) — see the report.`,
    };
  }

  // ---- LEGACY WHOLE-BACKUP PATH (opts.withInRequestSnapshot === true) ----
  // 1) Safety snapshot of CURRENT data before we overwrite anything.
  let safetySnapshot = null;
  try {
    safetySnapshot = (await exportBackup(env, user)).backup;
  } catch (e) {
    // If we can't snapshot, refuse to proceed — restoring without a rollback
    // option is too dangerous.
    throw InternalError(
      'Restore stopped: safety snapshot failed: ' + (e && e.message || e),
      'The restore was stopped because a safety snapshot of the current data could not be '
      + 'taken. Your data is safe — nothing was changed.'
    );
  }

  // restoredTables = table restored (value = rows inserted).
  // partialTables   = restored, but SOME individual rows were skipped (e.g. a
  //                   duplicate inside the backup). Reported, not fatal.
  // emptyTables     = the backup had 0 rows for this table, so the live table was
  //                   left UNTOUCHED on purpose (see restoreOneTable / BUG 3).
  //                   Surfaced so the operator can tell a real-empty table apart
  //                   from an export glitch — no longer a silent wipe.
  // errors          = whole-table failure (missing table, or ALL rows failed so we
  //                   refused to wipe the live table). These flip success=false.
  const report = { restoredTables: {}, partialTables: {}, emptyTables: {}, skippedTables: {}, errors: [] };

  for (const [binding, tables] of Object.entries(backup.data)) {
    await restoreBindingTables(env, binding, tables, report);
  }

  const partialCount = Object.keys(report.partialTables).length;
  const emptyCount = Object.keys(report.emptyTables).length;
  const errCount = report.errors.length;
  const parts = [`${Object.keys(report.restoredTables).length} table(s) restored`];
  if (partialCount) parts.push(`${partialCount} with some rows skipped`);
  if (emptyCount) parts.push(`${emptyCount} left unchanged (backup had no rows)`);
  if (errCount) parts.push(`${errCount} FAILED`);
  const message = (errCount === 0)
    ? `Restore complete — ${parts.join(', ')}.`
    : `Restore finished with problems — ${parts.join(', ')}. See the report.`;

  return {
    // Partial-row skips do NOT count as failure — only whole-table errors do.
    success: errCount === 0,
    report,
    // The caller (UI) can offer to download this so the operator always has a
    // pre-restore rollback point.
    safetySnapshot,
    message,
  };
}

// Restores every table for ONE D1 binding into `report` (mutated in place). Shared
// by the incremental per-binding path and the legacy whole-backup loop so the
// per-table behaviour is identical in both. Never throws — a whole-table failure
// is recorded in report.errors, matching the original inline loop exactly.
async function restoreBindingTables(env, binding, tables, report) {
  if (!BACKUP_MAP[binding]) { report.skippedTables[binding] = 'unknown db binding'; return; }
  const db = env[binding];
  if (!db) { report.skippedTables[binding] = 'binding not configured on server'; return; }

  for (const [table, rows] of Object.entries(tables || {})) {
    // Only allow tables we know about for this binding.
    if (!BACKUP_MAP[binding].includes(table)) { report.skippedTables[`${binding}.${table}`] = 'not in backup map'; continue; }
    if (!SAFE_IDENT.test(table)) { report.skippedTables[`${binding}.${table}`] = 'unsafe identifier'; continue; }

    const rowArr = Array.isArray(rows) ? rows : [];
    try {
      const res = await restoreOneTable(db, table, rowArr);
      if (res.skippedEmpty) {
        // Backup carried no rows for this table — live data was left as-is.
        report.emptyTables[`${binding}.${table}`] = 'backup had 0 rows — live table left unchanged';
        continue;
      }
      if (res.allRowsFailed) {
        // Every row failed to insert; we refused to wipe the live table. This is
        // a real failure, NOT a silent success.
        report.errors.push(`${binding}.${table}: all ${res.skipped} row(s) failed to restore, live table left unchanged (${res.examples.join('; ')})`);
        continue;
      }
      report.restoredTables[`${binding}.${table}`] = res.inserted;
      if (res.skipped > 0) {
        report.partialTables[`${binding}.${table}`] = `${res.skipped} row(s) skipped: ${res.examples.join('; ')}`;
      }
    } catch (err) {
      // A genuine whole-table failure (e.g. the table doesn't exist here).
      report.errors.push(`${binding}.${table}: ${err.message}`);
    }
  }
}

// Restores one table's rows.
//
// This was rewritten to close three data-loss bugs (all confirmed against the
// live schema + this code):
//
//   BUG 1 (reserved-word columns): the generated INSERT put column names in
//   UNQUOTED, so `order` / `key` / `from` (real columns on custom_announcements,
//   portal_settings, group_messages, person_messages) produced a SQL syntax error
//   on EVERY row — and since the table was DELETEd first, those four tables lost
//   ALL their data while the report showed only "rows skipped". FIX: every table
//   and column identifier is now double-quoted via quoteIdent().
//
//   BUG 3 (wipe-then-check ordering): the "no rows" guard ran AFTER `DELETE FROM`,
//   so an empty rows array wiped the live table. Combined with dumpTable's old
//   silent `[]` on a read error, a single export hiccup could erase a table on the
//   next restore. FIX: the live table is NOT touched until the new rows have been
//   successfully staged (see below), and an EMPTY backup for a table no longer
//   auto-wipes — it is reported as skippedEmpty so the operator notices instead of
//   silently losing data.
//
//   NON-DESTRUCTIVE SWAP: we insert every backup row into a TEMP staging table
//   first. Only if staging succeeds do we, in a single atomic db.batch, DELETE the
//   real table and copy the staged rows in. So if the inserts were going to fail,
//   the live data is left intact rather than wiped-then-empty.
//
// Returns { inserted, skipped, examples, skippedEmpty }.
//   - skippedEmpty=true means the backup had 0 rows for this table; the live table
//     was left UNTOUCHED on purpose (see BUG 3). The caller decides how to report.
//   - throws only on a genuine whole-table failure (e.g. the table doesn't exist).
async function restoreOneTable(db, table, rows) {
  assertSafeTable(table);
  const qTable = quoteIdent(table);

  // An empty backup array for a table is treated as "nothing to restore" and the
  // live table is deliberately NOT wiped (guards against an export read-glitch
  // that turned a populated table into []). A legitimately empty table simply
  // stays empty if it already was; if it had data, the operator is told.
  if (!rows.length) return { inserted: 0, skipped: 0, examples: [], skippedEmpty: true };

  // Union of columns across all rows, in first-seen order. All are validated by
  // SAFE_IDENT (defends the identifier) and then quoted (handles reserved words).
  const colSet = [];
  const seen = new Set();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k) && SAFE_IDENT.test(k)) { seen.add(k); colSet.push(k); }
    }
  }
  if (!colSet.length) return { inserted: 0, skipped: 0, examples: [], skippedEmpty: true };

  const qCols = colSet.map(quoteIdent).join(', ');
  const placeholders = colSet.map(() => '?').join(', ');

  // Unique per-restore staging table name (validated identifier). Temp tables are
  // per-connection; on D1 we create/drop an ordinary table with a random suffix to
  // avoid any collision, then always drop it in finally.
  // Must start with a lowercase letter to satisfy SAFE_IDENT (no leading '_').
  // A collision here would make one restore clobber another's staging table.
  const stg = `zzrestorestg_${table}_${randomHex(4)}`;
  assertSafeTable(stg);
  const qStg = quoteIdent(stg);

  const bindRow = (row) => colSet.map(c => (row[c] === undefined ? null : row[c]));

  let inserted = 0;
  let skipped = 0;
  const examples = [];

  try {
    // 1) Build the staging table with the SAME shape as the real table, but only
    //    the columns present in the backup (CREATE ... AS SELECT ... WHERE 0 keeps
    //    column affinities without copying rows). If the real table is missing,
    //    this throws -> caller records a whole-table error, live data untouched.
    await db.prepare(`CREATE TABLE ${qStg} AS SELECT ${qCols} FROM ${qTable} WHERE 0`).run();

    // 2) Insert the backup rows into STAGING (never the live table yet). Staging
    //    has no constraints, so every row lands here; duplicates in the backup are
    //    collapsed later by the OR REPLACE copy-in (step 3) against the REAL
    //    table's keys. Individually bad rows (e.g. a wrong type) are skipped and
    //    reported rather than aborting the whole table.
    const stgSql = `INSERT INTO ${qStg} (${qCols}) VALUES (${placeholders})`;
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      try {
        await db.batch(slice.map(row => db.prepare(stgSql).bind(...bindRow(row))));
        inserted += slice.length;
      } catch (batchErr) {
        // Fall back to per-row so one bad row doesn't drop the whole chunk.
        for (const row of slice) {
          try { await db.prepare(stgSql).bind(...bindRow(row)).run(); inserted++; }
          catch (rowErr) { skipped++; if (examples.length < 5) examples.push(rowErr.message); }
        }
      }
    }

    // 3) Atomic swap: only NOW do we touch the live table. DELETE + copy-in run in
    //    a single db.batch so the live rows are replaced in one shot. If every row
    //    was skipped (inserted === 0) we do NOT wipe the live table — that would be
    //    the exact "lost everything" outcome we are preventing; report it instead.
    if (inserted === 0) {
      return { inserted: 0, skipped, examples, skippedEmpty: false, allRowsFailed: true };
    }
    // INSERT OR REPLACE (not plain INSERT) on the final copy-in: the staging table
    // has no constraints (CREATE ... AS SELECT copies affinity only), so any
    // duplicate rows in the backup survive staging. REPLACE collapses them against
    // the REAL table's PRIMARY KEY / UNIQUE indexes instead of failing the swap.
    await db.batch([
      db.prepare(`DELETE FROM ${qTable}`),
      db.prepare(`INSERT OR REPLACE INTO ${qTable} (${qCols}) SELECT ${qCols} FROM ${qStg}`),
    ]);

    return { inserted, skipped, examples, skippedEmpty: false };
  } finally {
    // Always clean up the staging table, success or failure.
    try { await db.prepare(`DROP TABLE IF EXISTS ${qStg}`).run(); } catch (e) { /* best effort */ }
  }
}
