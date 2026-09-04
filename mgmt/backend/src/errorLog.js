import { requireSuperadmin, ValidationError } from './auth.js';
import { queuePersonMessageDirect } from './whatsapp.js';
import { logError, logErrorAt, logWarn } from './logger.js';
import { waNumber } from './phone.js';
import { isTruthyFlag } from './flags.js';

// The actual INSERT now lives in logger.js so that whatsapp.js / docxTemplates.js /
// index.js can all use the SAME writer (they each had their own, and two of the
// three wrote columns that either didn't exist or left error_id/reported NULL).
// Re-exported here so existing imports keep working.
export { logError };

// isTruthyFlag comes from the shared flags.js util (audit 6.1) — see import above.

// ---- Abuse guard for the two PUBLIC error endpoints ----
// logError and reportErrorToWhatsApp must stay callable without a session (the
// Consent and Announce pages are no-login pages and ReportErrorButton lives on
// them), but previously anyone could mint unlimited errorIds and then trigger a
// 'priority' WhatsApp to EVERY Superadmin, repeatedly, with no rate limit at all.
const REPORT_LIMIT_PER_HOUR = 10;
const REPORT_LIMIT_KEY = 'errreport:count';

async function withinReportRateLimit(env) {
  if (!env.KV_SESSIONS) {
    // Audit 4.3: fail open (don't break error reporting) but make it visible.
    await logWarn(env, 'backend-errorLog', 'withinReportRateLimit',
      'KV_SESSIONS binding missing — error-report WhatsApp rate limit is DISABLED (failing open).', {});
    return true;
  }
  try {
    const hourBucket = Math.floor(Date.now() / 3600000);
    const key = `${REPORT_LIMIT_KEY}:${hourBucket}`;
    const used = parseInt((await env.KV_SESSIONS.get(key)) || '0', 10);
    if (used >= REPORT_LIMIT_PER_HOUR) return false;
    await env.KV_SESSIONS.put(key, String(used + 1), { expirationTtl: 7200 });
    return true;
  } catch (e) {
    await logWarn(env, 'backend-errorLog', 'withinReportRateLimit',
      'Error-report rate-limit check failed (failing open): ' + (e && e.message), {}).catch(() => {});
    return true;
  }
}

// ============ WHO GETS THE ERROR REPORT (audit H-2) ============
//
// THE BUG: this used to be
//     (await getSheetDataAsJSON(env, 'COMMITEE MEMBERS')).filter(m => m.Role === 'Superadmin')
// but `committee_members` HAS NO `role` COLUMN. Its columns are
//     year, name, created_by, view_role, view_role_hindi, whatsapp
// (mgmt/db/schema/core.sql), and fromColumnRow() surfaces `view_role` as
// 'View Role'. So `m.Role` was ALWAYS undefined, the filter ALWAYS produced an
// empty array, and every single call ended at
//     throw ValidationError('No Superadmin WhatsApp/Mobile number is registered in USERS.')
//
// Consequence: "Report this to Superadmin" — the only escalation path from the
// PUBLIC, no-login Consent and Announce pages, and from the Receipt modal — has
// never delivered a message. Not once. It failed identically whether or not a
// Superadmin's number was on file, which is why the error text sent everyone
// looking in the wrong place.
//
// Also fixed here, because it is the same query: this endpoint is UNAUTHENTICATED,
// and it used to read the ENTIRE users table plus the ENTIRE committee table into
// memory (32k+ rows) just to find a handful of numbers. That is a large slice of
// the shared D1 daily row-read budget, reachable by anyone. We now select only the
// Superadmin names (a tiny indexed read) and then fetch just those users by
// id_code with a single IN (...) query.
//
// Returns a de-duplicated array of canonical 91XXXXXXXXXX numbers.
async function superadminWhatsappNumbers(env) {
  if (!env.DB_CORE) return [];

  // 1) Committee members tagged Superadmin for any year. TRIM+LOWER so a stray
  //    'superadmin ' or 'SuperAdmin' still counts (the column is free text).
  const { results: committee } = await env.DB_CORE.prepare(
    "SELECT DISTINCT name FROM committee_members WHERE LOWER(TRIM(view_role)) = 'superadmin'"
  ).all().catch(() => ({ results: [] }));
  let names = (committee || []).map(r => (r.name == null ? '' : r.name.toString().trim())).filter(Boolean);

  // 2) Fallback: the actual Superadmin LOGINS. Without this, a committee list that
  //    simply never used the word "Superadmin" in View Role leaves error escalation
  //    with no recipient at all — the failure mode we just fixed. A login row is
  //    the authoritative definition of who a Superadmin is.
  if (!names.length) {
    const { results: logins } = await env.DB_CORE.prepare(
      "SELECT name FROM login_users WHERE role = 'Superadmin'"
    ).all().catch(() => ({ results: [] }));
    names = (logins || []).map(r => (r.name == null ? '' : r.name.toString().trim())).filter(Boolean);
  }
  if (!names.length) return [];

  // 3) Their numbers, in ONE indexed lookup instead of a full-table scan.
  const placeholders = names.map(() => '?').join(', ');
  const { results: rows } = await env.DB_CORE.prepare(
    `SELECT id_code, mobile, whatsapp FROM users WHERE id_code IN (${placeholders})`
  ).bind(...names).all().catch(() => ({ results: [] }));

  // waNumber() normalises to 91XXXXXXXXXX and rejects anything that is not a real
  // 10-digit Indian mobile, including the REAL-affinity artefacts these columns
  // produce ("9876543210.0", "9.87654321e9").
  return [...new Set(
    (rows || [])
      .map(r => waNumber(r.whatsapp) || waNumber(r.mobile))
      .filter(Boolean)
  )];
}

export async function reportErrorToWhatsApp(env, errorId) {
  if (!errorId) throw ValidationError('errorId required');

  const row = await env.DB_LOGS.prepare('SELECT * FROM error_log WHERE error_id = ?').bind(errorId).first();
  if (!row) throw ValidationError('Error record not found.');
  if (isTruthyFlag(row.reported)) return { success: true, alreadyReported: true };

  if (!(await withinReportRateLimit(env))) {
    throw ValidationError('Too many error reports have been sent. Please try again after a while.');
  }

  const numbers = await superadminWhatsappNumbers(env);
  if (numbers.length === 0) {
    throw ValidationError('No Superadmin WhatsApp/Mobile number is registered in USERS.');
  }

  const msg = `⚠️ Error Report\nPage: ${row.page}\nSource: ${row.source}\nMessage: ${row.message}\nTime: ${row.created_at}\nRef: ${row.error_id}`;

  // Claim the row FIRST (conditional UPDATE — D1's write is atomic per statement,
  // so meta.changes === 0 means a concurrent call already claimed it) to stop a
  // double-send...
  const claim = await env.DB_LOGS.prepare(
    "UPDATE error_log SET reported = '1' WHERE error_id = ? AND (reported IS NULL OR reported IN ('0', 0, 'False', 'false', ''))"
  ).bind(errorId).run();
  if (!claim.meta.changes) return { success: true, alreadyReported: true };

  // ...but RELEASE the claim if queueing then fails, otherwise the error is
  // permanently flagged as reported while no message was ever sent — previously
  // an unrecoverable silent state with nothing written anywhere.
  let queued = 0;
  try {
    for (const num of numbers) {
      await queuePersonMessageDirect(env, num, msg, '', 'priority', '');
      queued++;
    }
  } catch (err) {
    if (queued === 0) {
      await env.DB_LOGS.prepare("UPDATE error_log SET reported = '0' WHERE error_id = ?")
        .bind(errorId).run().catch(() => {});
    }
    await logErrorAt(env, 'backend-errorLog', 'reportErrorToWhatsApp', err, {
      errorId, queued, total: numbers.length,
    });
    // ValidationError (not a bare Error): `reportErrorToWhatsApp` is in
    // NO_SERVER_AUTOLOG, so a non-expected throw here would be replaced by the
    // generic "Something went wrong" AND never logged by the router — the
    // Superadmin pressing "Report" would learn nothing at all. The real cause is
    // already persisted by the logErrorAt() above, so surface only the counts and
    // the log reference; `err.message` is deliberately NOT interpolated because it
    // is a raw upstream WhatsApp API body.
    throw ValidationError(
      `The error report could not be sent (${queued} of ${numbers.length} delivered). ` +
      `The reason was written to the Error Log — check the newest "reportErrorToWhatsApp" row.`
    );
  }

  return { success: true, sentTo: queued };
}

// `stack` and `context` were stored but never rendered in the UI, so an admin
// could never see a stack trace. They're returned here and the ErrorLog view now
// shows them behind a "Details" toggle.
export async function getErrorLog(env, user, limit) {
  requireSuperadmin(user);
  const lim = Math.min(Math.max(parseInt(limit) || 300, 1), 1000);
  const { results } = await env.DB_LOGS.prepare(
    'SELECT * FROM error_log ORDER BY created_at DESC LIMIT ?'
  ).bind(lim).all();
  return results;
}
