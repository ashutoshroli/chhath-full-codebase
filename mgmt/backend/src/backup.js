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
    throw new Error('Restore confirm nahi hua — confirmation box mein exactly "RESTORE" likhein.');
  }
  if (!backup || typeof backup !== 'object' || !backup.data) {
    throw new Error('Backup file valid nahi hai (koi data nahi mila).');
  }
  if (backup.formatVersion && backup.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error(`Backup ka format version (${backup.formatVersion}) is server se naya hai — pehle deploy update karein.`);
  }

  // 1) Safety snapshot of CURRENT data before we overwrite anything.
  let safetySnapshot = null;
  try {
    safetySnapshot = (await exportBackup(env, user)).backup;
  } catch (e) {
    // If we can't snapshot, refuse to proceed — restoring without a rollback
    // option is too dangerous.
    throw new Error('Restore rok diya: current data ka safety snapshot nahi ban paya (' + e.message + '). Data safe hai, kuch change nahi hua.');
  }

  const report = { restoredTables: {}, skippedTables: {}, errors: [] };

  for (const [binding, tables] of Object.entries(backup.data)) {
    if (!BACKUP_MAP[binding]) { report.skippedTables[binding] = 'unknown db binding'; continue; }
    const db = env[binding];
    if (!db) { report.skippedTables[binding] = 'binding not configured on server'; continue; }

    for (const [table, rows] of Object.entries(tables)) {
      // Only allow tables we know about for this binding.
      if (!BACKUP_MAP[binding].includes(table)) { report.skippedTables[`${binding}.${table}`] = 'not in backup map'; continue; }
      if (!SAFE_IDENT.test(table)) { report.skippedTables[`${binding}.${table}`] = 'unsafe identifier'; continue; }

      try {
        await restoreOneTable(db, table, Array.isArray(rows) ? rows : []);
        report.restoredTables[`${binding}.${table}`] = Array.isArray(rows) ? rows.length : 0;
      } catch (err) {
        report.errors.push(`${binding}.${table}: ${err.message}`);
      }
    }
  }

  return {
    success: report.errors.length === 0,
    report,
    // The caller (UI) can offer to download this so the operator always has a
    // pre-restore rollback point.
    safetySnapshot,
    message: report.errors.length === 0
      ? `Restore complete — ${Object.keys(report.restoredTables).length} table(s) restore ho gaye.`
      : `Restore hua lekin ${report.errors.length} table(s) mein problem — report dekhein.`,
  };
}

// DELETE-all + batched INSERT for one table. Column list is derived from the
// union of keys across the backup rows (so a NULL-in-some-rows column is still
// written). Values are always bound (never interpolated).
async function restoreOneTable(db, table, rows) {
  assertSafeTable(table);

  // Wipe the table first. If the table doesn't exist on this deployment, treat
  // that as fatal for THIS table only (reported by the caller).
  await db.prepare(`DELETE FROM ${table}`).run();

  if (!rows.length) return;

  // Union of columns across all rows, in first-seen order.
  const colSet = [];
  const seen = new Set();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k) && SAFE_IDENT.test(k)) { seen.add(k); colSet.push(k); }
    }
  }
  if (!colSet.length) return;

  const placeholders = colSet.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${colSet.join(', ')}) VALUES (${placeholders})`;

  // D1 batches are limited; chunk to stay well within statement limits.
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const stmts = slice.map(row =>
      db.prepare(sql).bind(...colSet.map(c => (row[c] === undefined ? null : row[c])))
    );
    await db.batch(stmts);
  }
}
