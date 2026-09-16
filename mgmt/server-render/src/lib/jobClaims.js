// ============ A JOB RUNS ONCE, AND NOT FOREVER ============
//
// audit Render/offload #3 and #5.
//
// `/jobs` accepted a job, answered `202`, and fire-and-forgot it:
//
//     res.status(202).json({ accepted: true, jobId });
//     (async () => { const result = await handler(payload); await postResult(...); })();
//
// Nothing recorded that the job was running. Three consequences, and the second is the
// dangerous one:
//
//   1. A DUPLICATE jobId started a SECOND run. The Worker's reconciler re-dispatches a row
//      stuck in `dispatched` after ten minutes — and "stuck" here means "we have not heard
//      back", not "it stopped". A slow Claude call or a large Drive batch is still running.
//      So the redispatch ran the whole job again ALONGSIDE the original.
//
//   2. For `ai_pr_create` that means **two GitHub pull requests**, and for the PDF paths two
//      Drive conversions and two R2 objects. #344 fixed the Worker side of this — the
//      callback now claims before applying, and non-reconstructable kinds are not retried at
//      all — but the AI kinds ARE still re-dispatched, by design, because they usually
//      SHOULD be. The missing piece is here: the second dispatch must recognise that the
//      first is still in flight and do nothing.
//
//   3. Nothing bounded a job in time or in number. A provider that never answers held a job
//      forever, and there was no ceiling on how many ran at once — on a free-tier instance
//      with one CPU and 512 MB.
//
// The claim below is IN-PROCESS, and that is stated rather than hidden: Render can run more
// than one instance, so two dispatches landing on different instances would still both run.
// What makes that acceptable *here* rather than a fig leaf is that the Worker only ever
// re-dispatches after a ten-minute silence, and the practical case — a redispatch reaching
// the same warm instance that is still working — is exactly what this catches. The exact
// version needs the shared store PR-32 is already opening Neon for.

import { config } from '../config.js';

// jobId -> { kind, startedAt, status, finishedAt, error }
const claims = new Map();

// A finished claim is remembered for this long, so a duplicate arriving just after completion
// is answered with the outcome instead of starting again.
const REMEMBER_FINISHED_MS = 10 * 60 * 1000;

function sweep(now) {
  for (const [jobId, c] of claims) {
    if (c.status !== 'running' && now - c.finishedAt > REMEMBER_FINISHED_MS) claims.delete(jobId);
  }
}

/** How many jobs are running right now. */
export function runningCount() {
  let n = 0;
  for (const c of claims.values()) if (c.status === 'running') n++;
  return n;
}

/** The recorded state of a job, or null if this instance has never seen it. */
export function stateOf(jobId) {
  const c = claims.get(jobId);
  if (!c) return null;
  return { kind: c.kind, status: c.status, startedAt: c.startedAt, error: c.error || null };
}

/**
 * Tries to claim `jobId`.
 *
 * Returns `{ ok: true }` when this caller owns the run, or `{ ok: false, reason, state }` when
 * it must not start one — `duplicate` (already running or recently finished) or `at-capacity`.
 */
export function claim(jobId, kind, now = Date.now()) {
  sweep(now);

  const existing = claims.get(jobId);
  if (existing) {
    // The whole point: a redispatch of a job that is still running must NOT run it again.
    return { ok: false, reason: 'duplicate', state: stateOf(jobId) };
  }
  if (runningCount() >= config.jobsMaxConcurrent) {
    return { ok: false, reason: 'at-capacity', state: null };
  }
  claims.set(jobId, { kind, startedAt: now, status: 'running', finishedAt: 0, error: null });
  return { ok: true };
}

/** Records how a claimed job ended. Safe to call for an unknown id. */
export function release(jobId, status, error = null, now = Date.now()) {
  const c = claims.get(jobId);
  if (!c) return;
  c.status = status;
  c.finishedAt = now;
  c.error = error ? error.toString().slice(0, 300) : null;
}

/**
 * Runs `work()` with a hard deadline.
 *
 * A job that has not finished by then is reported as failed and its claim is freed — because
 * the alternative is a claim that never clears, which turns "this job is stuck" into "this
 * jobId can never run again on this instance".
 *
 * What this does NOT do is cancel the work. Stopping an in-flight Drive upload or GitHub
 * commit would mean threading an AbortSignal through every provider call in every job, and a
 * half-cancelled irreversible operation is worse than a slow one. So the deadline bounds how
 * long we WAIT and how long a slot is held — it does not claim to stop what is running, and
 * the failure message says as much.
 */
export function withDeadline(work, ms, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const e = new Error(
        `${label} exceeded its ${Math.round(ms / 1000)}s deadline. It may still be running on the `
        + 'processing service, so re-running it could duplicate work — check the outcome first.'
      );
      e.deadline = true;
      reject(e);
    }, ms);

    Promise.resolve()
      .then(work)
      .then((v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } })
      .catch((e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
  });
}

export function _reset() { claims.clear(); }
