import { getSheetDataAsJSON } from './crud.js';
import { requireSuperadmin } from './auth.js';
import { queuePersonMessageDirect } from './whatsapp.js';
import { logError, logErrorAt, logWarn } from './logger.js';
import { waNumberOf } from './phone.js';
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

export async function reportErrorToWhatsApp(env, errorId) {
  if (!errorId) throw new Error('errorId required');

  const row = await env.DB_LOGS.prepare('SELECT * FROM error_log WHERE error_id = ?').bind(errorId).first();
  if (!row) throw new Error('Error record not found.');
  if (isTruthyFlag(row.reported)) return { success: true, alreadyReported: true };

  if (!(await withinReportRateLimit(env))) {
    throw new Error('Too many error reports have been sent. Please try again after a while.');
  }

  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  const superadminMembers = (await getSheetDataAsJSON(env, 'COMMITEE MEMBERS')).filter(m => m.Role === 'Superadmin');

  // Normalize + de-duplicate through phone.js so we never queue a bare 10-digit
  // number (which the external sender can't dial) or a REAL-affinity artefact.
  const numbers = [...new Set(
    superadminMembers
      .map(m => waNumberOf(userMap[m.Name]))
      .filter(Boolean)
  )];
  if (numbers.length === 0) {
    throw new Error('No Superadmin WhatsApp/Mobile number is registered in USERS.');
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
    throw new Error(`A problem occurred while sending the error report (${queued}/${numbers.length} sent): ${err.message}`);
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
