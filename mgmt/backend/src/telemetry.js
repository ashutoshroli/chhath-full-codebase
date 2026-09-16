// ============ TELEMETRY: MAKING THE SILENT FAILURES AUDIBLE (audit PR-48) ============
//
// This portal is built out of fail-open fallbacks, and almost all of them are the right
// call. A few examples that all live in this codebase:
//
//   * verifyToken re-reads the live role on every request and, if that read throws,
//     falls through with the cached session — because failing closed would log every
//     admin out during a transient D1 blip (carry-over C9);
//   * the public rate limiters return `false` on a KV error, because a KV hiccup must
//     not take the portal down;
//   * the retention sweep swallows a missing table, because an older deployment must
//     not break the cron.
//
// Every one of those is a considered availability trade. But they share a property that
// is NOT considered: **when they trigger, nothing anywhere says so.** A degraded
// deployment and a healthy one produce identical output. C9 is the sharpest case — if
// the revocation check has been failing for a day, every demoted or deleted account is
// still operating on its cached role, and the only symptom is silence.
//
// So this module does one thing: it counts the moments the system knowingly did less
// than it promised, and puts that count somewhere an operator already looks.
//
// WHY A COUNTER IN KV RATHER THAN A LOG LINE.
//
// A log line per event is the obvious approach and it fails twice over. If the
// degradation is rare, the line is lost in the noise weeks before anyone reads it. If it
// is frequent — a D1 outage means EVERY request logs — it floods the error log, which is
// the one place the committee looks when something is wrong, and buries the real cause.
//
// A counter is bounded (one KV write per kind per request that degrades, and it collapses
// to one key per day), answers the question that actually matters ("is this happening,
// and how much"), and can be READ BACK — which a log line cannot be. Reading it back is
// the point: `?health=1` now reports degradations, so a monitor sees them without anyone
// grepping anything.
//
// A daily key rather than a rolling window, for the same reason the retention sweep uses
// a day key: it expires by itself, needs no cleanup, and "37 revocation checks failed
// today" is the sentence an operator wants.
// ============================================================================

// Kinds are an allowlist, not free text. A typo'd kind would create a counter nobody
// ever reads, which is the failure mode this module exists to remove.
export const DEGRADATIONS = {
  // C9. The live role/existence re-check could not run, so this request ran on the
  // cached session. A demoted or deleted account keeps its old rights while this fires.
  REVOCATION_CHECK: 'revocation-check-unavailable',
  // A rate limiter could not count, so it allowed the request.
  RATE_LIMIT: 'rate-limit-unavailable',
  // The retention sweep skipped a table.
  RETENTION: 'retention-sweep-error',
  // The public data version could not be bumped, so cached data may be stale.
  DATA_VERSION: 'data-version-bump-failed',
};

const ALL_KINDS = Object.values(DEGRADATIONS);

/** KV counters live for two days: today is readable, yesterday is comparable. */
export const DEGRADATION_TTL_SECONDS = 60 * 60 * 48;

export const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const degradationKey = (kind, now = Date.now()) => `tel:degraded:${kind}:${dayKey(now)}`;

/**
 * A short id for one request, so the lines belonging to it can be found together.
 *
 * Not a UUID: this is a correlation handle in a log, not an identifier anything trusts,
 * and eight hex characters are enough to disambiguate the requests in flight at one
 * moment while staying readable in a log line a human is scanning.
 */
export function newRequestId() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Record that the system knowingly did less than it promises.
 *
 * NEVER THROWS, and never blocks the caller's decision. This sits inside catch blocks
 * whose entire purpose is to keep working when something is broken — a telemetry write
 * that could throw, or that the caller had to await before proceeding, would make the
 * fallback it is observing less reliable than it was before.
 */
export async function recordDegradation(env, kind, detail = '') {
  if (!ALL_KINDS.includes(kind)) return false; // unknown kind: refuse rather than create a key nobody reads
  const kv = env && (env.KV_SESSIONS || env.KV_PUBLIC);
  if (!kv) return false;
  try {
    const key = degradationKey(kind);
    const cur = parseInt((await kv.get(key)) || '0', 10) || 0;
    await kv.put(key, String(cur + 1), { expirationTtl: DEGRADATION_TTL_SECONDS });
    // One console line on the FIRST occurrence of a kind each day. Enough to correlate
    // with a deploy or an incident; not enough to flood during an outage, which is
    // exactly when the flood would do the most harm.
    if (cur === 0) {
      console.warn(`[telemetry] degraded: ${kind}${detail ? ` (${detail})` : ''} — first today`);
    }
    return true;
  } catch (e) {
    return false; // observing a failure must not become a second failure
  }
}

/**
 * Today's degradation counts, for the health report.
 *
 * A kind that has not fired is ABSENT rather than zero, so a clean report is empty and
 * anything present is worth reading. `unavailable: true` distinguishes "no degradations"
 * from "could not check" — a health report that says nothing is wrong because it could
 * not look is the exact failure this module was written about.
 */
export async function degradationReport(env, now = Date.now()) {
  const kv = env && (env.KV_SESSIONS || env.KV_PUBLIC);
  if (!kv) return { unavailable: true, reason: 'no KV binding' };
  const out = {};
  try {
    for (const kind of ALL_KINDS) {
      const n = parseInt((await kv.get(degradationKey(kind, now))) || '0', 10) || 0;
      if (n > 0) out[kind] = n;
    }
  } catch (e) {
    return { unavailable: true, reason: (e && e.message) || 'KV read failed' };
  }
  return out;
}

/**
 * Should a degradation count make the health endpoint report DEGRADED?
 *
 * Only the security-relevant one, and only past a threshold. The reasoning:
 *
 *   * a handful of revocation-check failures is a transient D1 blip, which is the case
 *     the fallback exists for. Turning the deployment red for that would train everyone
 *     to ignore the signal — the same reason the flaky timing test in #355 was harmful.
 *   * a sustained count means the check has effectively stopped running, and demoted or
 *     deleted accounts are still working. That is worth waking someone for.
 *
 * The other kinds are reported but never degrade the status: a rate limiter that could
 * not count is a cost problem, not a correctness one, and retention skipping a table is
 * a storage problem. Both belong in the report; neither should page anybody.
 */
export const REVOCATION_ALERT_THRESHOLD = 25;

export function degradationSeverity(report) {
  if (!report || report.unavailable) return 'unknown';
  const n = report[DEGRADATIONS.REVOCATION_CHECK] || 0;
  return n >= REVOCATION_ALERT_THRESHOLD ? 'degraded' : 'ok';
}

/**
 * One structured line per request.
 *
 * Built as a pure function so its shape is testable and stable — a log format that
 * drifts is a log nothing can parse. Fields are omitted when absent rather than emitted
 * as null, so a line stays short enough to read.
 */
export function requestSummary({
  requestId, action, method, status, ms, cache, rowsRead, bytesIn, bytesOut, user, degraded,
}) {
  const parts = [`rid=${requestId || '-'}`];
  if (action) parts.push(`action=${action}`);
  if (method) parts.push(`method=${method}`);
  if (status !== undefined && status !== null) parts.push(`status=${status}`);
  if (Number.isFinite(ms)) parts.push(`ms=${Math.round(ms)}`);
  if (cache) parts.push(`cache=${cache}`);            // HIT | MISS | BYPASS
  if (Number.isFinite(rowsRead)) parts.push(`rows=${rowsRead}`);
  if (Number.isFinite(bytesIn)) parts.push(`in=${bytesIn}`);
  if (Number.isFinite(bytesOut)) parts.push(`out=${bytesOut}`);
  // The user's NAME, never a token or a session id: this line goes to a log that is read
  // casually and retained, and "who did it" is answered by the name.
  if (user) parts.push(`user=${user}`);
  if (degraded) parts.push(`degraded=${degraded}`);
  return `[req] ${parts.join(' ')}`;
}
