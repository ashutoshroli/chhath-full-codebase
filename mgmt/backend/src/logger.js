// ============ CENTRAL ERROR LOGGER ============
//
// Single source of truth for writing to `error_log`. Before this module there
// were THREE different writers with three different column lists:
//   - errorLog.js       -> correct
//   - docxTemplates.js  -> missing error_id + reported (row unreportable)
//   - whatsapp.js       -> columns that DON'T EXIST (category/location/timestamp)
//                          so every WhatsApp failure silently vanished
// Everything now goes through logError() below.
//
// This lives in its own module (rather than in errorLog.js) purely to avoid an
// import cycle: errorLog.js imports queuePersonMessageDirect from whatsapp.js,
// and whatsapp.js needs to log — so whatsapp.js imports from here instead.

// Real schema (mgmt/db/schema/logs.sql):
//   id INTEGER PK AUTOINCREMENT, error_id, source, page, message, stack,
//   context, created_at, reported
const INSERT_SQL =
  'INSERT INTO error_log (error_id, source, page, message, stack, context, created_at, reported) VALUES (?, ?, ?, ?, ?, ?, ?, 0)';

// Occurrences of the SAME (source, page, message) inside this window reuse the
// existing row instead of inserting a new one. Fixes the log-spam that pushed
// real errors out of the Superadmin's 300-row view (the migrated data has 7
// identical "Receipt template missing" rows within 7 seconds, and 5 identical
// "Script error." rows within 6 seconds).
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

export function newErrorId() {
  return 'ERR' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function clamp(v, max) {
  return (v === undefined || v === null ? '' : v.toString()).slice(0, max);
}

/**
 * Writes one row to error_log, with de-duplication.
 * Never throws — callers must be able to log from inside a catch block.
 * @returns {{success: boolean, errorId?: string, deduped?: boolean}}
 */
export async function logError(env, source, page, message, stack, context) {
  try {
    if (!env || !env.DB_LOGS) return { success: false, message: 'DB_LOGS binding missing' };

    const src = clamp(source || 'unknown', 100);
    const pg = clamp(page, 200);
    const msg = clamp(message, 1000);
    const stk = clamp(stack, 2000);
    const ctx = clamp(context, 500);

    // Dedup: same source+page+message logged very recently -> reuse that row.
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const dupe = await env.DB_LOGS.prepare(
      'SELECT error_id FROM error_log WHERE source = ? AND page = ? AND message = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1'
    ).bind(src, pg, msg, since).first().catch(() => null);
    if (dupe && dupe.error_id) return { success: true, errorId: dupe.error_id, deduped: true };

    const id = newErrorId();
    await env.DB_LOGS.prepare(INSERT_SQL)
      .bind(id, src, pg, msg, stk, ctx, new Date().toISOString())
      .run();
    return { success: true, errorId: id };
  } catch (e) {
    // Last resort: the log write itself failed (D1 down, table locked, ...).
    // Surface it in the Worker tail at least, and tell the caller so it can
    // decide (ReportErrorButton disables itself when there's no errorId).
    console.error('[logError] FAILED to persist error:', e && e.message, { source, page, message });
    return { success: false, message: e && e.message };
  }
}

/**
 * Logs a caught Error object (unwraps .message / .stack for you).
 * Never throws. `context` may be an object — it gets JSON-stringified.
 */
export async function logErrorAt(env, source, page, err, context) {
  const message = (err && err.message) || String(err);
  const stack = (err && err.stack) || '';
  const ctx = (context && typeof context === 'object') ? safeJson(context) : context;
  return logError(env, source, page, message, stack, ctx);
}

/**
 * Logs a plain warning/diagnostic message (no Error object involved) — used for
 * "no active template found", "invalid WhatsApp number", etc.
 */
export async function logWarn(env, source, page, message, context) {
  const ctx = (context && typeof context === 'object') ? safeJson(context) : context;
  return logError(env, source, page, message, '', ctx);
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return '[unserializable context]';
  }
}


// ============ ACTIVITY LOG ============
//
// Records WHAT a logged-in user did (add / edit / delete a record), so the
// Superadmin audit page can show a real activity trail. The activity_log table
// existed (migrated from the old Google Sheet) but NOTHING was writing to it —
// so no action taken in the Worker era was ever recorded. This closes that gap.
//
// Real schema (mgmt/db/schema/logs.sql):
//   id, timestamp, name, action, details, device_info, ip_client_reported, device_id
//
// Best-effort and NEVER throws: an activity-log failure must never break or
// roll back the action the user just performed successfully.
const ACTIVITY_INSERT_SQL =
  'INSERT INTO activity_log (timestamp, name, action, details, device_info, ip_client_reported, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)';

export async function logActivity(env, { name, action, details, deviceInfo, ip, deviceId }) {
  try {
    if (!env || !env.DB_LOGS) return { success: false };
    await env.DB_LOGS.prepare(ACTIVITY_INSERT_SQL).bind(
      new Date().toISOString(),
      clamp(name || 'unknown', 100),
      clamp(action, 100),
      clamp(details, 1000),
      clamp(deviceInfo, 300),
      clamp(ip, 60),
      clamp(deviceId, 80)
    ).run();
    return { success: true };
  } catch (e) {
    console.error('[logActivity] failed:', e && e.message);
    return { success: false };
  }
}

// Superadmin: recent activity for the audit page. Optional name filter + capped limit.
export async function getActivityLog(env, opts) {
  if (!env || !env.DB_LOGS) return { activity: [] };
  const o = opts || {};
  const limit = Math.min(Math.max(parseInt(o.limit) || 200, 1), 1000);
  const where = [];
  const args = [];
  if (o.name) { where.push('name = ?'); args.push(o.name.toString().trim()); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { results } = await env.DB_LOGS.prepare(
    `SELECT id, timestamp, name, action, details, device_info, ip_client_reported
       FROM activity_log ${clause} ORDER BY id DESC LIMIT ?`
  ).bind(...args, limit).all();
  return { activity: results || [] };
}
