// ============ DATA RETENTION SWEEP (audit M-38) ============
//
// THE PROBLEM: nothing in this portal ever deleted anything. Only `error_log` had a
// retention policy, and even that was a ONE-SHOT `DELETE` inside migration
// 2026-09-01/04-logs.sql — not a recurring job. Everything else grows forever:
//
//   collection_jobs.filled_base64  THE WORST BY FAR. Every COLLECTION save stores a
//                                  complete filled .docx (hundreds of KB) in a D1
//                                  row, and it is never cleared even after the job
//                                  succeeds and the PDF exists in R2. At festival
//                                  volume this is the fastest route to the 5 GB
//                                  free-tier storage limit, and it is pure dead
//                                  weight — retryQueueJob() already refuses to retry
//                                  a 'done' job, so the bytes can never be needed
//                                  again.
//   activity_log                   one row per add/edit/delete, forever.
//   login_attempts                 one row per login attempt, forever.
//   user_sessions                  kept after expiry "for audit", forever.
//   person_messages/group_messages one row per WhatsApp message, forever.
//   error_log                      grows between manual migrations.
//
// FREE-TIER DESIGN CONSTRAINTS (these shaped the implementation):
//
//   * D1 allows 100,000 rows WRITTEN per day, and a DELETE counts as a write. An
//     unbounded "delete everything old" sweep could therefore consume the entire
//     daily write budget in one tick and starve real saves. Every statement is
//     bounded by SWEEP_LIMIT.
//   * D1/SQLite here is built without SQLITE_ENABLE_UPDATE_DELETE_LIMIT, so
//     `DELETE ... LIMIT n` is a syntax error. The bounded form must be
//     `DELETE FROM t WHERE id IN (SELECT id FROM t WHERE ... LIMIT n)`.
//   * The cron fires every minute (wrangler.toml), but running eight statements 1440
//     times a day is wasteful. The sweep runs on ONE minute of each hour, giving
//     24 ticks/day. Worst case 24 x 8 x SWEEP_LIMIT deletes/day, which stays well
//     inside the write budget while still trimming far faster than data arrives.
//   * Each statement gets its own try/catch and never throws. This is background
//     bookkeeping: it must never break the cron, and it must never affect the user
//     action it is cleaning up after.
//
// A backlog is cleared gradually across many ticks rather than in one burst. That is
// deliberate — steady and predictable beats fast and quota-exhausting.

// Rows touched per statement per tick. 8 statements x 24 ticks x 200 = 38,400
// writes/day worst case, comfortably under the 100,000 free-tier limit and leaving
// most of it for real work.
const SWEEP_LIMIT = 200;

// Which minute of the hour the sweep runs on. Any fixed value works; 7 avoids the
// top-of-hour crowd.
export const SWEEP_MINUTE = 7;

const DAYS_MS = 86400000;
const isoDaysAgo = (n) => new Date(Date.now() - n * DAYS_MS).toISOString();

// ---- Retention windows ----
// Chosen to keep everything an operator could plausibly need while bounding growth.
export const RETENTION = {
  // The generated PDF lives in R2 and its link is in generated_files; the source
  // bytes are dead weight one day after the job finished.
  jobPayloadDays: 1,
  // A finished job row itself is only interesting while someone might ask "did my
  // receipt go out?".
  doneJobDays: 30,
  // Matches the window migration 2026-09-01/04 already chose.
  errorLogDays: 180,
  // A full festival cycle plus margin — this is the WHO-DID-WHAT trail.
  activityLogDays: 365,
  // Long enough to investigate a brute-force attempt.
  loginAttemptDays: 90,
  // Sessions are unusable once expired; keep a month for forensics.
  expiredSessionDays: 30,
  // Delivery history for a whole season plus margin.
  messageDays: 180,
};

// Bounded DELETE. Returns the number of rows removed (0 on any error).
async function boundedDelete(db, table, whereSql, binds, label, report) {
  if (!db) return 0;
  try {
    const res = await db.prepare(
      `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${whereSql} LIMIT ${SWEEP_LIMIT})`
    ).bind(...binds).run();
    const n = (res && res.meta && res.meta.changes) || 0;
    if (n) report[label] = n;
    return n;
  } catch (e) {
    // Best-effort by design — a missing table on an older deployment, or a transient
    // D1 error, must not break the cron.
    report[`${label}:error`] = (e && e.message ? e.message : String(e)).slice(0, 120);
    return 0;
  }
}

// Bounded UPDATE, used to blank filled_base64 without deleting the job row.
async function boundedBlank(db, label, report) {
  if (!db) return 0;
  try {
    const res = await db.prepare(
      `UPDATE collection_jobs SET filled_base64 = ''
        WHERE id IN (
          SELECT id FROM collection_jobs
           WHERE status = 'done' AND filled_base64 != '' AND finished_at IS NOT NULL
             AND finished_at < ? LIMIT ${SWEEP_LIMIT}
        )`
    ).bind(isoDaysAgo(RETENTION.jobPayloadDays)).run();
    const n = (res && res.meta && res.meta.changes) || 0;
    if (n) report[label] = n;
    return n;
  } catch (e) {
    report[`${label}:error`] = (e && e.message ? e.message : String(e)).slice(0, 120);
    return 0;
  }
}

/**
 * Runs one bounded pass. Never throws. Returns a report of what it removed, so the
 * caller can log a summary only when something actually happened.
 */
export async function runRetentionSweep(env) {
  const report = {};
  if (!env) return report;

  // 1) The storage hog first — blank the payload before deleting the row, so even a
  //    job that stays around for its full 30 days stops costing megabytes after one.
  await boundedBlank(env.DB_MISC, 'jobPayloadsBlanked', report);

  // 2) Finished job rows.
  await boundedDelete(
    env.DB_MISC, 'collection_jobs',
    "status = 'done' AND finished_at IS NOT NULL AND finished_at < ?",
    [isoDaysAgo(RETENTION.doneJobDays)], 'doneJobsDeleted', report
  );

  // 3) Logs.
  await boundedDelete(
    env.DB_LOGS, 'error_log', 'created_at < ?',
    [isoDaysAgo(RETENTION.errorLogDays)], 'errorLogDeleted', report
  );
  await boundedDelete(
    env.DB_LOGS, 'activity_log', 'timestamp < ?',
    [isoDaysAgo(RETENTION.activityLogDays)], 'activityLogDeleted', report
  );

  // 4) Audit store. expires_at is epoch MILLISECONDS (schema/audit.sql), not ISO.
  await boundedDelete(
    env.DB_AUDIT, 'login_attempts', 'created_at < ?',
    [isoDaysAgo(RETENTION.loginAttemptDays)], 'loginAttemptsDeleted', report
  );
  await boundedDelete(
    env.DB_AUDIT, 'user_sessions', 'expires_at < ?',
    [Date.now() - RETENTION.expiredSessionDays * DAYS_MS], 'expiredSessionsDeleted', report
  );

  // 5) Delivered/failed WhatsApp history. Anything not yet terminal is left alone —
  //    getStuckMessages() and resendMessage() still need it.
  const messageCutoff = isoDaysAgo(RETENTION.messageDays);
  for (const table of ['person_messages', 'group_messages']) {
    await boundedDelete(
      env.DB_WHATSAPP_INDEX, table,
      "status IN ('sent', 'failed') AND sent_at IS NOT NULL AND sent_at < ?",
      [messageCutoff], `${table}Deleted`, report
    );
  }

  return report;
}

/** True when this cron tick should run the sweep (once per hour). */
export function shouldSweepNow(now = new Date()) {
  return now.getUTCMinutes() === SWEEP_MINUTE;
}
