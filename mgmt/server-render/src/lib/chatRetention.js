// ============================================================================
// PR-32 — chat log retention.
//
// schema.sql ended with this:
//
//   -- OPTIONAL retention helper (run manually or via a scheduled job if you want to
//   -- keep the free tier small): delete chat logs older than 90 days.
//   --   DELETE FROM chat_messages WHERE created_at < now() - INTERVAL '90 days';
//   --   DELETE FROM chat_sessions WHERE last_seen_at < now() - INTERVAL '90 days';
//
// Two things wrong with that. It framed a privacy commitment as optional housekeeping
// ("if you want to keep the free tier small"), and it was a comment, so nobody ran it —
// the same failure the D1 side had, where migration 10 was 101 comment lines and zero
// executable ones. Every public question anyone had ever typed was still there.
//
// What is stored is not incidental. `chat_messages.content` is the visitor's own words,
// and `chat_sessions.ip_hash` links a conversation to a (pseudonymised) person. A
// retention window is the difference between "we keep chat logs for three months" being
// true and being a hope.
//
// DESIGN
//
// The sweep is one function with the database handed to it. Everything that decides
// anything — whether to run, what the cutoff is, what to delete in what order — is a
// pure function over its arguments, and is tested. There is no Postgres in the
// environment this was written in, so the alternative would have been untested
// branching around an untestable call.
//
// ORDER MATTERS, and it is not the order the old comment used. Sessions are deleted
// last, because deleting a session CASCADES to its messages (see
// db/neon/02-constraints-and-retention.sql). Messages are deleted first so that a
// long-running session — one still active, but holding messages older than the window —
// is trimmed too. Doing only the session delete would keep old messages alive inside
// young sessions; doing only the message delete would leave empty session rows, each
// still carrying its ip_hash, for ever.
//
// Both statements are bounded. An unbounded DELETE on a table nobody has ever pruned is
// how a retention sweep becomes an outage the first time it runs.
// ============================================================================

import { config } from '../config.js';

/** Rows removed per statement, per pass. Small enough to never hold a long lock. */
export const SWEEP_BATCH = 5000;

/** Passes per run. SWEEP_BATCH * MAX_PASSES is the ceiling for one invocation. */
export const MAX_PASSES = 20;

/**
 * Should the opportunistic sweep run now?
 *
 * At most once per UTC day per instance, decided by comparing the day key rather than
 * by a timer — a process that sleeps through midnight (which a Render free instance
 * does) still runs on its next request rather than waiting a further 24 hours.
 */
let lastSweptDay = '';
export const dayKey = (now) => new Date(now).toISOString().slice(0, 10);

export function shouldSweep(now = Date.now(), days = config.chatRetentionDays) {
  if (!days || days <= 0) return false;         // 0 disables retention entirely
  return dayKey(now) !== lastSweptDay;
}

export function markSwept(now = Date.now()) { lastSweptDay = dayKey(now); }
export function _resetSweepState() { lastSweptDay = ''; }

/**
 * The statements a sweep issues, in order, as [sql, params] pairs.
 *
 * Kept separate from the execution so the SQL and the ordering can be asserted without
 * a database. `ctid` is Postgres's physical row identifier — using it to pick a bounded
 * batch avoids needing a sortable key, and avoids the `DELETE ... LIMIT` syntax
 * Postgres does not have.
 */
export function sweepStatements(days, batch = SWEEP_BATCH) {
  const interval = `${Math.floor(days)} days`;
  return [
    // 1. Old messages, including those inside sessions that are still active.
    [
      `DELETE FROM chat_messages WHERE ctid IN (
         SELECT ctid FROM chat_messages
          WHERE created_at < now() - $1::interval
          LIMIT ${batch})`,
      [interval],
    ],
    // 2. Then sessions nobody has touched since the cutoff. CASCADE takes any messages
    //    they still hold, so this cannot leave orphans behind.
    [
      `DELETE FROM chat_sessions WHERE ctid IN (
         SELECT ctid FROM chat_sessions
          WHERE last_seen_at < now() - $1::interval
          LIMIT ${batch})`,
      [interval],
    ],
  ];
}

/**
 * Delete chat logs older than the retention window.
 *
 * @param query  async (sql, params) => { rowCount } — injected; defaults to Neon's pool.
 * @returns { ran, days, messages, sessions, passes, truncated }
 *          `truncated` means the ceiling was hit and more remains — the next run
 *          continues. Reported rather than looped for ever, so one invocation has a
 *          bounded cost.
 */
export async function sweepChatRetention({ query, days = config.chatRetentionDays, now = Date.now() } = {}) {
  const result = { ran: false, days, messages: 0, sessions: 0, passes: 0, truncated: false };
  if (!days || days <= 0) return result;   // disabled: keep everything, deliberately
  if (!query) return result;               // no database configured — nothing to do

  result.ran = true;
  const [msgStmt, sessStmt] = sweepStatements(days);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    result.passes = pass + 1;
    let moved = 0;
    for (const [stmt, key] of [[msgStmt, 'messages'], [sessStmt, 'sessions']]) {
      const res = await query(stmt[0], stmt[1]);
      const n = (res && Number(res.rowCount)) || 0;
      result[key] += n;
      moved += n;
    }
    if (moved === 0) break;                // drained
    if (pass === MAX_PASSES - 1) result.truncated = true;
  }

  markSwept(now);
  return result;
}
