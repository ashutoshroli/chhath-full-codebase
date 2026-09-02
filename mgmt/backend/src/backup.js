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

import { requireSuperadmin } from './auth.js';

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
  if (!SAFE_IDENT.test(table)) throw new Error(`Unsafe table identifier: ${table}`);
  return table;
}

function dbHandle(env, binding) {
  const db = env[binding];
  if (!db) throw new Error(`D1 binding ${binding} not configured on server`);
  return db;
}

// Reads every row of one table. Returns [] if the table happens not to exist on
// this deployment (older schema) rather than failing the whole backup.
async function dumpTable(db, table) {
  assertSafeTable(table);
  try {
    const { results } = await db.prepare(`SELECT * FROM ${table}`).all();
    return results || [];
  } catch (e) {
    // Missing table / other read error — record it as empty but don't abort.
    return [];
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
export async function restoreBackup(env, user, backup, confirm) {
  requireSuperadmin(user);

  if ((confirm || '').toString().trim().toUpperCase() !== 'RESTORE') {
    throw new Error('Restore not confirmed — type exactly "RESTORE" in the confirmation box.');
  }
  if (!backup || typeof backup !== 'object' || !backup.data) {
    throw new Error('The backup file is not valid (no data found).');
  }
  if (backup.formatVersion && backup.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error(`The backup's format version (${backup.formatVersion}) is newer than this server — please update the deployment first.`);
  }

  // 1) Safety snapshot of CURRENT data before we overwrite anything.
  let safetySnapshot = null;
  try {
    safetySnapshot = (await exportBackup(env, user)).backup;
  } catch (e) {
    // If we can't snapshot, refuse to proceed — restoring without a rollback
    // option is too dangerous.
    throw new Error('Restore stopped: could not create a safety snapshot of the current data (' + e.message + '). Your data is safe, nothing was changed.');
  }

  // partialTables = restored fine but a few individual rows were skipped (e.g.
  //   duplicate rows inside the backup itself). NOT a hard failure.
  // errors = the whole table could not be restored (missing table, etc.).
  const report = { restoredTables: {}, partialTables: {}, skippedTables: {}, errors: [] };

  for (const [binding, tables] of Object.entries(backup.data)) {
    if (!BACKUP_MAP[binding]) { report.skippedTables[binding] = 'unknown db binding'; continue; }
    const db = env[binding];
    if (!db) { report.skippedTables[binding] = 'binding not configured on server'; continue; }

    for (const [table, rows] of Object.entries(tables)) {
      // Only allow tables we know about for this binding.
      if (!BACKUP_MAP[binding].includes(table)) { report.skippedTables[`${binding}.${table}`] = 'not in backup map'; continue; }
      if (!SAFE_IDENT.test(table)) { report.skippedTables[`${binding}.${table}`] = 'unsafe identifier'; continue; }

      const rowArr = Array.isArray(rows) ? rows : [];
      try {
        const res = await restoreOneTable(db, table, rowArr);
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

  const partialCount = Object.keys(report.partialTables).length;
  const errCount = report.errors.length;
  let message;
  if (errCount === 0 && partialCount === 0) {
    message = `Restore complete — ${Object.keys(report.restoredTables).length} table(s) restored.`;
  } else if (errCount === 0) {
    message = `Restore complete. Some duplicate/invalid rows were skipped in ${partialCount} table(s) (everything else was restored) — see the report.`;
  } else {
    message = `Restore completed, but ${errCount} table(s) could not be restored — see the report.`;
  }

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

// DELETE-all + batched INSERT for one table. Column list is derived from the
// union of keys across the backup rows (so a NULL-in-some-rows column is still
// written). Values are always bound (never interpolated).
// Returns { inserted, skipped, examples } — throws ONLY on a whole-table failure
// (e.g. the table doesn't exist on this deployment). Individual bad/duplicate
// rows are skipped and reported, not fatal.
async function restoreOneTable(db, table, rows) {
  assertSafeTable(table);

  // Wipe the table first. If the table doesn't exist on this deployment, treat
  // that as fatal for THIS table only (reported by the caller).
  await db.prepare(`DELETE FROM ${table}`).run();

  if (!rows.length) return { inserted: 0, skipped: 0, examples: [] };

  // Union of columns across all rows, in first-seen order.
  const colSet = [];
  const seen = new Set();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k) && SAFE_IDENT.test(k)) { seen.add(k); colSet.push(k); }
    }
  }
  if (!colSet.length) return { inserted: 0, skipped: 0, examples: [] };

  const placeholders = colSet.map(() => '?').join(', ');
  // INSERT OR REPLACE (not plain INSERT): the backup preserves each row's own
  // `id`, and three tables carry UNIQUE indexes (generated_files,
  // docx_templates, group_messages/person_messages message_id). If a backup
  // happens to contain two rows that collide on a PRIMARY KEY or UNIQUE index —
  // which is exactly what made a whole table's restore fail before — REPLACE lets
  // the later row win instead of aborting the entire table. For a clean backup
  // (no dupes) this behaves identically to INSERT.
  const sql = `INSERT OR REPLACE INTO ${table} (${colSet.join(', ')}) VALUES (${placeholders})`;

  const bindRow = (row) => colSet.map(c => (row[c] === undefined ? null : row[c]));

  // D1 batches are limited; chunk to stay well within statement limits. A D1
  // batch is atomic, so if ONE row in a chunk still fails (e.g. a value that
  // violates a CHECK/type the schema enforces), the whole chunk would roll back.
  // To avoid losing the other 49 good rows, we retry a failed chunk row-by-row
  // and only skip the genuinely bad ones — reported back to the caller.
  const CHUNK = 50;
  let inserted = 0;
  let skipped = 0;
  const examples = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    try {
      const stmts = slice.map(row => db.prepare(sql).bind(...bindRow(row)));
      await db.batch(stmts);
      inserted += slice.length;
    } catch (batchErr) {
      // Fall back to per-row inserts so one bad row can't drop the whole chunk.
      for (const row of slice) {
        try {
          await db.prepare(sql).bind(...bindRow(row)).run();
          inserted++;
        } catch (rowErr) {
          skipped++;
          if (examples.length < 5) examples.push(rowErr.message);
        }
      }
    }
  }

  return { inserted, skipped, examples };
}
