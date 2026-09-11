// ============================================================================
// Render offload — job orchestration (Worker side).
//
// Long-running AI work (fix generation + PR creation) would hit the Cloudflare
// Worker's CPU / request-duration / subrequest limits, so it is offloaded to an
// external Render.com service. The Worker stays the SINGLE SOURCE OF TRUTH for
// job state (the render_jobs table in DB_MISC); Render only computes and calls
// back. Lifecycle:  pending -> dispatched -> completed | failed
//
//   1. createAndDispatchJob(): INSERT a 'pending' row, POST the job to Render
//      (X-Render-Api-Key), mark 'dispatched'. If the POST fails, mark 'failed'.
//   2. Render does the heavy work, then POSTs the result back to the Worker's
//      ?render-webhook route (authenticated by RENDER_WEBHOOK_SECRET).
//   3. handleRenderCallback(): save the result, mark 'completed'/'failed'. This is
//      IDEMPOTENT — a duplicate callback for an already-finished job is a no-op.
//   4. reconcileStuckJobs(): a cron backstop — a row stuck in 'dispatched' past
//      STUCK_MINUTES is re-dispatched (attempts < max) or timed out to 'failed'.
//
// SECURITY: two distinct shared secrets, never in git (set via `wrangler secret
// put`): RENDER_API_KEY authenticates Worker->Render (sent as X-Render-Api-Key);
// RENDER_WEBHOOK_SECRET authenticates Render->Worker (checked constant-time in the
// webhook route). No keep-alive lives here — Render is kept warm by an EXTERNAL
// monitor (UptimeRobot) pinging its /health endpoint.
//
// SCOPE: this offloads ai_fix_generate + ai_pr_create only. The CI-retry loop
// (aiFixCi.js) is intentionally NOT offloaded here — that is a later change.
// ============================================================================

import { InternalError, timingSafeEqualHex } from './auth.js';
import { randomId } from './random.js';
import { logErrorAt, logWarn } from './logger.js';

const MAX_ATTEMPTS = 3;       // dispatch attempts before a job is parked 'failed'
const STUCK_MINUTES = 10;     // a 'dispatched' row older than this is reconciled
const KINDS = new Set(['ai_fix_generate', 'ai_pr_create', 'ai_ci_retry', 'pdf_convert', 'pdf_convert_batch']);

const genJobId = () => randomId('RJOB');

function jobsDb(env) {
  if (!env || !env.DB_MISC) throw InternalError('DB_MISC binding not configured — render_jobs unavailable.');
  return env.DB_MISC;
}

// Defence-in-depth for the job-row result: strip any large base64 blobs so we
// never persist multi-hundred-KB payloads (which can exceed D1's ~1 MB row limit)
// when a kind has no side-effect to enrich the result. This is a SAFE fallback —
// the normal path stores the side-effect's already-stripped, translated result.
const HEAVY_FIELDS = new Set(['pdfBase64', 'base64', 'bytes', 'content', 'fileBase64']);
function stripHeavyResult(result) {
  if (!result || typeof result !== 'object') return result || {};
  const clean = (obj) => {
    if (Array.isArray(obj)) return obj.map(clean);
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (HEAVY_FIELDS.has(k)) continue;
      out[k] = clean(v);
    }
    return out;
  };
  return clean(result);
}

// SHA-256 hex (Web Crypto) — used only to compare the webhook shared secret in
// constant time (auth.js keeps its own copy private).
async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((str || '').toString()));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time compare of a presented webhook secret against RENDER_WEBHOOK_SECRET.
// Returns false (never throws) if either side is missing.
export async function verifyRenderWebhookSecret(env, provided) {
  const expected = env && env.RENDER_WEBHOOK_SECRET ? env.RENDER_WEBHOOK_SECRET.toString() : '';
  const supplied = (provided || '').toString();
  if (!expected || !supplied) return false;
  const [a, b] = await Promise.all([sha256Hex(supplied), sha256Hex(expected)]);
  return timingSafeEqualHex(a, b);
}

// ---- POST a job to the Render service. Never throws — returns {ok, status, error?}.
async function postToRender(env, job) {
  const url = (env && env.RENDER_SERVICE_URL ? env.RENDER_SERVICE_URL.toString() : '').replace(/\/+$/, '');
  const apiKey = env && env.RENDER_API_KEY ? env.RENDER_API_KEY.toString() : '';
  if (!url) return { ok: false, status: 0, error: 'RENDER_SERVICE_URL not configured' };
  if (!apiKey) return { ok: false, status: 0, error: 'RENDER_API_KEY not configured' };
  try {
    const resp = await fetch(`${url}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Api-Key': apiKey },
      body: JSON.stringify(job),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, error: `Render returned HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }
    let data = {};
    try { data = await resp.json(); } catch (e) { /* 202 with empty body is fine */ }
    return { ok: true, status: resp.status, renderJobId: data && data.renderJobId };
  } catch (e) {
    return { ok: false, status: 0, error: (e && e.message) || 'network error calling Render' };
  }
}

// ============================================================================
// Create + dispatch a job
// ============================================================================
// `payload` MUST contain only references (ids, branch names) — never big blobs;
// Render fetches any large content itself from GitHub/R2. `refId` is the domain
// row this job drives (e.g. the ai_fixes.fix_id) so callers can correlate.
export async function createAndDispatchJob(env, kind, payload, opts = {}) {
  if (!KINDS.has(kind)) throw InternalError(`Unknown render job kind: ${kind}`);
  const db = jobsDb(env);
  const jobId = genJobId();
  const now = new Date().toISOString();
  // `payload` is what goes to RENDER (may carry large base64 blobs, e.g. a PDF
  // batch). `opts.storePayload`, when given, is a SMALL metadata-only version
  // persisted in the D1 render_jobs row instead — big blobs must never be stored
  // (D1 rows are ~1 MB). When absent, the full payload is stored (the AI jobs are
  // small references, so this stays true for them).
  const payloadStr = JSON.stringify((opts.storePayload !== undefined ? opts.storePayload : payload) || {});
  const refId = opts.refId != null ? opts.refId.toString() : null;
  const createdBy = opts.createdBy != null ? opts.createdBy.toString() : null;

  await db.prepare(
    `INSERT INTO render_jobs (job_id, kind, status, payload, ref_id, attempts, max_attempts, created_by, created_at)
     VALUES (?, ?, 'pending', ?, ?, 0, ?, ?, ?)`
  ).bind(jobId, kind, payloadStr, refId, MAX_ATTEMPTS, createdBy, now).run();

  // Include job_id in the payload so Render echoes it back on the callback.
  const res = await postToRender(env, { jobId, kind, payload: payload || {} });

  if (res.ok) {
    await db.prepare(
      `UPDATE render_jobs SET status='dispatched', attempts=attempts+1, dispatched_at=?, render_job_id=? WHERE job_id=?`
    ).bind(new Date().toISOString(), res.renderJobId || null, jobId).run();
    return { success: true, jobId, status: 'dispatched' };
  }

  // Dispatch failed — park as failed (attempts=1) and record why.
  await db.prepare(
    `UPDATE render_jobs SET status='failed', attempts=attempts+1, error=?, finished_at=? WHERE job_id=?`
  ).bind((res.error || 'dispatch failed').slice(0, 500), new Date().toISOString(), jobId).run();
  await logWarn(env, 'backend-render', 'createAndDispatchJob',
    `Render dispatch failed for ${kind} (job ${jobId}): ${res.error}`, { jobId, kind }).catch(() => {});
  return { success: false, jobId, status: 'failed', message: 'Could not reach the processing service. Please try again shortly.' };
}

// ============================================================================
// Handle the Render -> Worker result callback (idempotent)
// ============================================================================
// `body` shape: { jobId, status: 'completed'|'failed', result?, error?, renderJobId? }
// The caller (index.js webhook route) has ALREADY verified the shared secret.
// Returns { success, applied } and NEVER throws (webhook handlers must ack).
export async function handleRenderCallback(env, body) {
  try {
    const db = jobsDb(env);
    const jobId = body && body.jobId ? body.jobId.toString() : '';
    if (!jobId) return { success: false, applied: false, message: 'jobId required' };

    const row = await db.prepare('SELECT * FROM render_jobs WHERE job_id = ? LIMIT 1').bind(jobId).first();
    if (!row) return { success: false, applied: false, message: 'unknown job' };

    // IDEMPOTENCY: a duplicate callback for a finished job is a no-op.
    if (row.status === 'completed' || row.status === 'failed') {
      return { success: true, applied: false, message: 'already finalized' };
    }

    const now = new Date().toISOString();
    const succeeded = (body.status || '').toString() === 'completed' && !body.error;

    if (succeeded) {
      // Domain side-effect FIRST — for pdf_convert it stores the PDF in R2 + writes
      // the index, and returns an enriched, base64-STRIPPED result ({publicLink,
      // fileName}) so we don't persist a few-hundred-KB pdfBase64 into the job row.
      //
      // IMPORTANT: the RAW Render result must NEVER be persisted as the completed
      // result. Render uses a per-record `ok` flag (and omits `error` on success),
      // while the frontend reads `success`/`error`. If the raw shape leaked through
      // (e.g. because the side-effect threw and we stored body.result verbatim), the
      // client would read `success:undefined` (falsy) with NO error string — a bulk
      // record failing with a BLANK reason. It also still carries the fat pdfBase64,
      // which can blow D1's ~1 MB row limit. So: if the side-effect throws, mark the
      // job FAILED with the real error instead of storing the raw body.
      let stored = null;
      try {
        const enriched = await applyResultSideEffect(env, row, body.result || {});
        // A kind WITH a side-effect (pdf_convert*, ai_*) must return an enriched,
        // translated result. If it returns nothing meaningful, keep only a minimal
        // safe echo of the raw result WITHOUT any base64 blobs.
        stored = (enriched != null) ? enriched : stripHeavyResult(body.result || {});
      } catch (e) {
        await logErrorAt(env, 'backend-render', 'handleRenderCallback:sideEffect', e, { jobId, kind: row.kind });
        const msg = (e && (e.userMessage || e.message)) || 'Processing the result failed on the server.';
        await db.prepare(
          `UPDATE render_jobs SET status='failed', error=?, finished_at=?, render_job_id=COALESCE(render_job_id, ?) WHERE job_id=?`
        ).bind(msg.toString().slice(0, 500), now, body.renderJobId || null, jobId).run();
        await applyFailureSideEffect(env, row, msg).catch(() => {});
        return { success: true, applied: true };
      }
      await db.prepare(
        `UPDATE render_jobs SET status='completed', result=?, finished_at=?, render_job_id=COALESCE(render_job_id, ?) WHERE job_id=?`
      ).bind(JSON.stringify(stored), now, body.renderJobId || null, jobId).run();
      return { success: true, applied: true };
    }

    // Render reported a failure.
    await db.prepare(
      `UPDATE render_jobs SET status='failed', error=?, finished_at=? WHERE job_id=?`
    ).bind((body.error || 'Render reported failure').toString().slice(0, 500), now, jobId).run();
    await applyFailureSideEffect(env, row, body.error || 'Render reported failure').catch(() => {});
    return { success: true, applied: true };
  } catch (e) {
    // Never throw from a webhook handler; log and let the route ack 200.
    await logErrorAt(env, 'backend-render', 'handleRenderCallback', e, {}).catch(() => {});
    return { success: false, applied: false };
  }
}

// ---- Domain side-effects: reflect a Render result onto the ai_fixes row. ----
// Imported lazily to avoid an import cycle (aiFix.js will import renderJobs.js in
// PR-C to dispatch). Only ai_* kinds touch ai_fixes; unknown kinds are no-ops.
const AI_KINDS = new Set(['ai_fix_generate', 'ai_pr_create', 'ai_ci_retry']);
async function applyResultSideEffect(env, jobRow, result) {
  if (AI_KINDS.has(jobRow.kind)) {
    const { applyRenderFixResult } = await import('./aiFix.js');
    if (typeof applyRenderFixResult === 'function') {
      await applyRenderFixResult(env, jobRow.kind, jobRow.ref_id, result);
    }
    return;
  }
  if (jobRow.kind === 'pdf_convert') {
    // Render converted the docx→PDF and returned the PDF bytes; the Worker writes
    // R2 + the generated_files index (both binding-only). The original job payload
    // carries docType/year/recordId. Returns a base64-STRIPPED { publicLink,
    // fileName } so the caller stores that (not the fat pdfBase64) on the job row.
    const { applyPdfConvertResult } = await import('./docxTemplates.js');
    if (typeof applyPdfConvertResult === 'function') {
      let payload = {};
      try { payload = JSON.parse(jobRow.payload || '{}'); } catch (e) { payload = {}; }
      return await applyPdfConvertResult(env, payload, result);
    }
  }
  if (jobRow.kind === 'pdf_convert_batch') {
    // Render converted a BATCH and returned per-record { recordId, ok, pdfBase64 }.
    // The Worker writes each PDF to R2 + the index, and returns a base64-STRIPPED
    // per-record summary for the job row / status poll. The stored jobRow.payload
    // holds only metadata (docType/year/recordIds) — the base64 was Render-body-only.
    const { applyPdfConvertBatchResult } = await import('./docxTemplates.js');
    if (typeof applyPdfConvertBatchResult === 'function') {
      let payload = {};
      try { payload = JSON.parse(jobRow.payload || '{}'); } catch (e) { payload = {}; }
      return await applyPdfConvertBatchResult(env, payload, result);
    }
  }
  return null;
}
async function applyFailureSideEffect(env, jobRow, errorMsg) {
  if (AI_KINDS.has(jobRow.kind)) {
    const { applyRenderFixFailure } = await import('./aiFix.js');
    if (typeof applyRenderFixFailure === 'function') {
      await applyRenderFixFailure(env, jobRow.kind, jobRow.ref_id, errorMsg);
    }
  }
  // pdf_convert failure needs no D1 side-effect: the render_jobs row already holds
  // status='failed' + error, which getRenderJobStatus surfaces to the poller.
}

// ============================================================================
// Reconciliation cron backstop
// ============================================================================
// A row stuck in 'dispatched' past STUCK_MINUTES means Render likely crashed, was
// spun down, or the callback was lost. Re-dispatch while attempts remain; else
// time it out to 'failed'. Bounded batch, never throws (cron-safe).
export async function reconcileStuckJobs(env) {
  let db;
  try { db = jobsDb(env); } catch (e) { return { reconciled: 0 }; }

  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60 * 1000).toISOString();
  const { results } = await db.prepare(
    `SELECT * FROM render_jobs WHERE status='dispatched' AND (dispatched_at IS NULL OR dispatched_at < ?)
      ORDER BY id ASC LIMIT 10`
  ).bind(cutoff).all().catch(() => ({ results: [] }));

  let reconciled = 0;
  for (const row of (results || [])) {
    try {
      if ((row.attempts || 0) >= (row.max_attempts || MAX_ATTEMPTS)) {
        await db.prepare(
          `UPDATE render_jobs SET status='failed', error=?, finished_at=? WHERE job_id=? AND status='dispatched'`
        ).bind('Timed out waiting for the processing service to respond.', new Date().toISOString(), row.job_id).run();
        await applyFailureSideEffect(env, row, 'Timed out waiting for the processing service.').catch(() => {});
        reconciled++;
        continue;
      }
      // Re-dispatch: reset to pending first (optimistic — only if still dispatched),
      // then POST again.
      const claim = await db.prepare(
        `UPDATE render_jobs SET status='pending' WHERE job_id=? AND status='dispatched'`
      ).bind(row.job_id).run();
      if (!claim || !claim.meta || claim.meta.changes === 0) continue; // someone else moved it

      let payload = {};
      try { payload = JSON.parse(row.payload || '{}'); } catch (e) { payload = {}; }
      const res = await postToRender(env, { jobId: row.job_id, kind: row.kind, payload });
      if (res.ok) {
        await db.prepare(
          `UPDATE render_jobs SET status='dispatched', attempts=attempts+1, dispatched_at=?, render_job_id=COALESCE(render_job_id, ?) WHERE job_id=?`
        ).bind(new Date().toISOString(), res.renderJobId || null, row.job_id).run();
      } else {
        // still couldn't reach Render — count the attempt; a later tick retries or times out
        await db.prepare(
          `UPDATE render_jobs SET status='dispatched', attempts=attempts+1, dispatched_at=?, error=? WHERE job_id=?`
        ).bind(new Date().toISOString(), (res.error || 'redispatch failed').slice(0, 500), row.job_id).run();
      }
      reconciled++;
    } catch (e) {
      await logErrorAt(env, 'backend-render', 'reconcileStuckJobs', e, { jobId: row.job_id }).catch(() => {});
    }
  }
  return { reconciled };
}

// ============================================================================
// Status read (for polling from the frontend)
// ============================================================================
export async function getRenderJobStatus(env, jobId, user) {
  // Superadmin-only, matching the AI-fix feature.
  const { requireSuperadmin } = await import('./auth.js');
  requireSuperadmin(user);
  const db = jobsDb(env);
  const id = (jobId || '').toString().trim();
  if (!id) return { success: false, message: 'jobId required' };
  const row = await db.prepare(
    'SELECT job_id, kind, status, result, error, ref_id, attempts, created_at, dispatched_at, finished_at FROM render_jobs WHERE job_id = ? LIMIT 1'
  ).bind(id).first();
  if (!row) return { success: false, message: 'Job not found' };
  let result = null;
  try { result = row.result ? JSON.parse(row.result) : null; } catch (e) { result = null; }
  return {
    success: true,
    job: {
      jobId: row.job_id, kind: row.kind, status: row.status,
      refId: row.ref_id, attempts: row.attempts,
      result, error: row.error || null,
      createdAt: row.created_at, dispatchedAt: row.dispatched_at, finishedAt: row.finished_at,
    },
  };
}
