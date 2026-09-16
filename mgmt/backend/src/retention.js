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

// The cron no longer fires every minute (it runs every 3 minutes to save free-tier
// D1/KV — see wrangler.toml), so an EXACT `minute === 7` match would be skipped on any interval
// that doesn't land on 7. Instead the sweep fires on the FIRST tick that falls in a
// short window starting at SWEEP_MINUTE. The window is wide enough to always catch
// one tick for cron intervals up to 5 minutes, and the once-per-window guarantee is
// preserved because the window is shorter than an hour, so it triggers exactly once
// per hour regardless of the exact cron cadence.
export const SWEEP_WINDOW_MINUTES = 5;

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
  // Email delivery history (email_messages). Same window as WhatsApp — a whole
  // season plus margin. Without this the table grows forever, and the Mails view +
  // the cron poll read more rows over time (a rows_read drain on the free tier).
  emailDays: 180,

  // ---- audit PR-48 additions ----
  //
  // A FAILED job's .docx bytes. This is the gap the original sweep left, and it is the
  // worse half of the storage problem it was written to solve: `jobPayloadDays` above
  // only blanks `status = 'done'`, so a job that failed kept its full base64 payload
  // FOR EVER — and failed jobs are precisely the ones that accumulate.
  //
  // It could not simply be blanked with the done ones, because `retryQueueJob` resets
  // `attempts = 0` and re-runs from `filled_base64`, so those bytes are the manual
  // retry. THE TRADE, stated: after this window a manual retry of a failed job can no
  // longer regenerate from the stored bytes and the collection has to be re-saved. A
  // month is far longer than anyone waits to chase a missing receipt, and the
  // alternative is paying storage for every failure the portal has ever had.
  failedJobPayloadDays: 30,
  // Terminal render_jobs rows (the offload dispatch ledger). Same reasoning as
  // doneJobDays: interesting while someone might ask "did that run?".
  renderJobDays: 30,
  // Terminal ai_fixes rows. Longer, because this is the record of what an automated
  // change did to the repository, which is worth being able to look back at.
  aiFixDays: 180,
  // OUTBOUND official mail only — see the sweep, which deliberately does not touch
  // received mail. A year, because this is correspondence.
  officialMailDays: 365,
  // A push subscription with active = 0 is dead: the browser unsubscribed, or delivery
  // failed permanently and push.js switched it off. Nothing ever reads it again.
  inactivePushDays: 90,
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
//
// `statuses` and `days` are parameters rather than hard-coded because the same
// operation is needed for two different situations with two different windows: a
// finished job's bytes are dead the next day, a failed job's are the manual retry and
// have to survive longer. One function, two callers, so the bounded/idempotent shape
// cannot drift between them.
async function boundedBlank(db, { statuses, days }, label, report) {
  if (!db) return 0;
  try {
    const placeholders = statuses.map(() => '?').join(', ');
    const res = await db.prepare(
      `UPDATE collection_jobs SET filled_base64 = ''
        WHERE id IN (
          SELECT id FROM collection_jobs
           WHERE status IN (${placeholders}) AND filled_base64 != '' AND finished_at IS NOT NULL
             AND finished_at < ? LIMIT ${SWEEP_LIMIT}
        )`
    ).bind(...statuses, isoDaysAgo(days)).run();
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
  await boundedBlank(
    env.DB_MISC, { statuses: ['done'], days: RETENTION.jobPayloadDays },
    'jobPayloadsBlanked', report
  );

  // 1b) PR-48 — the same bytes on a FAILED job, which nothing cleared at all. Kept
  //     much longer than a finished job's because `retryQueueJob` regenerates from
  //     them; see failedJobPayloadDays for the trade that window represents.
  await boundedBlank(
    env.DB_MISC, { statuses: ['failed'], days: RETENTION.failedJobPayloadDays },
    'failedJobPayloadsBlanked', report
  );

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

  // 6) Delivered/failed EMAIL history (email_messages, same DB as WhatsApp). Same
  //    rule: only terminal rows are pruned; pending/sending/resending stay so
  //    getStuckEmails / resendEmail still see them. Stops the table (and therefore
  //    the Mails-view reads + cron poll) from growing without bound.
  await boundedDelete(
    env.DB_WHATSAPP_INDEX, 'email_messages',
    "status IN ('sent', 'failed') AND sent_at IS NOT NULL AND sent_at < ?",
    [isoDaysAgo(RETENTION.emailDays)], 'email_messagesDeleted', report
  );

  // ---- audit PR-48: four tables that had no retention at all ----

  // 7) The offload dispatch ledger. Only terminal rows: a 'pending' or 'dispatched'
  //    row is what the reconciliation cron scans for, so pruning either would hide a
  //    stuck job rather than clean up after a finished one.
  await boundedDelete(
    env.DB_MISC, 'render_jobs',
    "status IN ('completed', 'failed') AND finished_at IS NOT NULL AND finished_at < ?",
    [isoDaysAgo(RETENTION.renderJobDays)], 'renderJobsDeleted', report
  );

  // 8) AI fix history. Terminal states only, and `needs_manual_review` is deliberately
  //    NOT among them — that status is a request for a human, and deleting it would
  //    silently drop the request.
  await boundedDelete(
    env.DB_LOGS, 'ai_fixes',
    "status IN ('merged', 'failed', 'ci_failed') AND updated_at IS NOT NULL AND updated_at < ?",
    [isoDaysAgo(RETENTION.aiFixDays)], 'aiFixesDeleted', report
  );

  // 9) Official mailbox — OUTBOUND ONLY, and this is the important part of the rule.
  //    `official_emails` holds both directions: 'sent'/'failed' are things we sent,
  //    'received' is mail somebody sent to the committee. Pruning received mail would
  //    be deleting correspondence nobody agreed to delete, so the status filter is an
  //    allowlist of outbound terminal states rather than "anything old".
  await boundedDelete(
    env.DB_WHATSAPP_INDEX, 'official_emails',
    "status IN ('sent', 'failed') AND created_at IS NOT NULL AND created_at < ?",
    [isoDaysAgo(RETENTION.officialMailDays)], 'officialEmailsDeleted', report
  );

  // 10) Dead push subscriptions. `active = 0` means the browser unsubscribed or
  //     delivery failed permanently — push.js never reads one again, and the row still
  //     holds an endpoint handle. Deliberately keyed on `active`, not on age alone: an
  //     old but ACTIVE subscription is a real subscriber.
  await boundedDelete(
    env.DB_CORE, 'push_subscriptions',
    'active = 0 AND updated_at IS NOT NULL AND updated_at < ?',
    [isoDaysAgo(RETENTION.inactivePushDays)], 'inactivePushDeleted', report
  );

  return report;
}

/**
 * True when this cron tick should run the sweep (once per hour).
 *
 * Fires when the current minute is within [SWEEP_MINUTE, SWEEP_MINUTE +
 * SWEEP_WINDOW_MINUTES). With an every-3-minute (or any <=5-min) cron, at least one
 * tick lands in that window every hour, and because the window is far shorter than
 * an hour it can only match once per hour — so the sweep still runs exactly once per
 * hour, never twice, and is never skipped. (An exact `=== SWEEP_MINUTE` check would
 * be missed whenever the cron interval does not land on minute 7.)
 *
 * NOTE: the sweep body is naturally idempotent (bounded DELETEs of already-old
 * rows), so even if two ticks ever matched the same window the second is a cheap
 * no-op — but the window math above prevents that anyway.
 */
export function shouldSweepNow(now = new Date()) {
  const m = now.getUTCMinutes();
  return m >= SWEEP_MINUTE && m < SWEEP_MINUTE + SWEEP_WINDOW_MINUTES;
}
