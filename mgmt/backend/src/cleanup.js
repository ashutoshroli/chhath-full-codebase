// ============================================================================
// Manual data cleanup (Superadmin) — lets an operator trim the noisy history
// tables from the portal instead of the shell. Strictly allowlisted: `target`
// only ever maps to a fixed (db, table, status/date column) triple, so no
// caller-supplied SQL ever reaches D1.
//
// Modes:
//   'all'        delete everything in the target
//   'sent'       delete rows with status='sent'    (message/mail targets only)
//   'failed'     delete rows with status='failed'  (message/mail targets only)
//   'olderThan'  keep the last N days; delete rows whose date column < cutoff
//
// Deletes are bounded per call (SWEEP cap) and looped a few times so a big
// backlog is cleared without a single unbounded statement blowing the D1 write
// budget. Returns the number of rows removed.
// ============================================================================

import { requireSuperadmin, ValidationError } from './auth.js';
import { logWarn } from './logger.js';

// db: which binding on env. table: physical table(s) — an array means the target
// spans more than one table (WhatsApp = person + group). statusCol/dateCol are
// FIXED here; nothing about them comes from the request.
const TARGETS = {
  whatsapp_messages: { db: 'DB_WHATSAPP_INDEX', tables: ['person_messages', 'group_messages'], statusCol: 'status', dateCol: 'created_at', hasStatus: true },
  noreply_mails:     { db: 'DB_WHATSAPP_INDEX', tables: ['email_messages'],                     statusCol: 'status', dateCol: 'created_at', hasStatus: true },
  error_log:         { db: 'DB_LOGS',           tables: ['error_log'],                          statusCol: null,     dateCol: 'created_at', hasStatus: false },
  activity_log:      { db: 'DB_LOGS',           tables: ['activity_log'],                       statusCol: null,     dateCol: 'timestamp',  hasStatus: false },
};

const MAX_PER_STATEMENT = 500; // one bounded DELETE
const MAX_LOOPS = 40;          // up to 20,000 rows per table per call (plenty; test data)

// One bounded, allowlisted DELETE loop against a single table.
async function deleteBounded(db, table, whereSql, binds) {
  let removed = 0;
  for (let i = 0; i < MAX_LOOPS; i++) {
    const res = await db.prepare(
      `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table}${whereSql ? ' WHERE ' + whereSql : ''} LIMIT ${MAX_PER_STATEMENT})`
    ).bind(...binds).run();
    const n = (res && res.meta && res.meta.changes) || 0;
    removed += n;
    if (n < MAX_PER_STATEMENT) break; // drained
  }
  return removed;
}

// Preview: how many rows the given cleanup WOULD remove (no delete).
export async function cleanupPreview(env, target, mode, days, user) {
  requireSuperadmin(user);
  const spec = TARGETS[target];
  if (!spec) throw ValidationError('Unknown cleanup target.');
  const db = env[spec.db];
  if (!db) throw ValidationError('Storage for this target is not configured.');
  const { whereSql, binds } = buildWhere(spec, mode, days);
  let total = 0;
  for (const table of spec.tables) {
    const row = await db.prepare(
      `SELECT COUNT(*) AS n FROM ${table}${whereSql ? ' WHERE ' + whereSql : ''}`
    ).bind(...binds).first().catch(() => null);
    total += row ? (parseInt(row.n) || 0) : 0;
  }
  return { success: true, count: total };
}

// Build the (allowlisted) WHERE clause for a mode. Throws on an invalid combo.
function buildWhere(spec, mode, days) {
  if (mode === 'all') return { whereSql: '', binds: [] };
  if (mode === 'sent' || mode === 'failed') {
    if (!spec.hasStatus) throw ValidationError('This log has no sent/failed status — use "All" or "keep last N days".');
    return { whereSql: `${spec.statusCol} = ?`, binds: [mode] };
  }
  if (mode === 'olderThan') {
    const n = parseInt(days);
    if (!Number.isFinite(n) || n < 0) throw ValidationError('Enter a valid number of days to keep.');
    const cutoff = new Date(Date.now() - n * 86400000).toISOString();
    return { whereSql: `${spec.dateCol} < ?`, binds: [cutoff] };
  }
  throw ValidationError('Invalid cleanup mode.');
}

export async function cleanupData(env, target, mode, days, user) {
  requireSuperadmin(user);
  const spec = TARGETS[target];
  if (!spec) throw ValidationError('Unknown cleanup target.');
  const db = env[spec.db];
  if (!db) throw ValidationError('Storage for this target is not configured.');
  const { whereSql, binds } = buildWhere(spec, mode, days);

  let removed = 0;
  for (const table of spec.tables) {
    removed += await deleteBounded(db, table, whereSql, binds);
  }
  // Audit the action — but NOT when the target is the error_log itself, because
  // logWarn writes to error_log and would immediately re-add a row to the table
  // the admin just cleared.
  if (target !== 'error_log') {
    await logWarn(env, 'cleanup', 'cleanupData',
      `Superadmin ${user && user.name} cleaned ${target} (${mode}${mode === 'olderThan' ? ' keep ' + days + 'd' : ''}): ${removed} row(s) removed.`,
      { target, mode, days, removed });
  }
  return { success: true, removed };
}
