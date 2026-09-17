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

// The claim marker written by handleRenderCallback, with its own timestamp, so a claim that
// dies mid-side-effect can be recovered (audit MGMT-BE-02). Stored in the existing TEXT
// `status` column — no CHECK constraint, so no migration.
const APPLYING_PREFIX = 'applying@';
const APPLYING_STUCK_MINUTES = 5;   // a side effect that has not finished by now is not going to

const isApplying = (status) => (status || '').toString().startsWith(APPLYING_PREFIX);
const applyingSince = (status) => (status || '').toString().slice(APPLYING_PREFIX.length);

// Kinds whose D1 `payload` is METADATA ONLY, because the real dispatch payload could not be
// stored: `pdf_convert_batch` carries the base64 .docx items (far past D1's ~1 MB row limit)
// and `provider_test` carries the provider's API key, which must never be at rest in a job
// row. Re-dispatching one of these sends a payload with the essential part MISSING, so the
// job cannot succeed — it can only fail slowly, or half-run (audit MGMT-BE-03).
// `docx_render` joins this set: its dispatch payload carries the TEMPLATE bytes +
// the fill data (a filled .docx is far past D1's ~1 MB row limit, so it is never
// stored in the job row — the stored payload is metadata only). A re-dispatch would
// send a payload with the essential bytes MISSING, so it could only fail slowly or
// half-run, and the original attempt may already have written R2 + generated_files
// and sent WhatsApp/email. So a stuck docx_render is failed with an actionable
// message, never retried — exactly like pdf_convert_batch (audit MGMT-BE-03).
// `pdf_convert` joins this set once the bulk fill moves server-side: its dispatch payload
// now carries the TEMPLATE bytes + the record's fill DATA (Render-body-only; the stored
// payload is metadata only — docType/year/recordId/force), exactly like pdf_convert_batch.
// A re-dispatch would send the essential bytes MISSING, and the original attempt may
// already have written R2 + generated_files, so a stuck pdf_convert is failed with an
// actionable message, never retried (audit MGMT-BE-03).
const NON_RECONSTRUCTABLE_KINDS = new Set(['pdf_convert', 'pdf_convert_batch', 'provider_test', 'docx_render']);

// Kinds whose side effect writes the generated_files index, which the PUBLIC portal reads.
// The router bumps the data version at DISPATCH, but the file index is only written when the
// callback arrives — so without this the portal keeps serving a cached payload that predates
// the document (audit MGMT-BE-04).
// `docx_render` also writes the generated_files index on its callback (the auto
// receipt/certificate/samaan the collection save produced), which the PUBLIC portal
// reads — so it must bump the data version too, or a visitor following the QR sees
// "not generated yet" for a receipt that exists (audit MGMT-BE-04).
const VERSION_BUMPING_KINDS = new Set(['pdf_convert', 'pdf_convert_batch', 'docx_render']);
const KINDS = new Set(['ai_fix_generate', 'ai_pr_create', 'ai_ci_retry', 'pdf_convert', 'pdf_convert_batch', 'provider_test', 'docx_render']);

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

// Normalize a stored pdf_convert_batch result to the shape the frontend expects
// ({ recordId, success, error?, publicLink?, fileName? }). Live rows are already
// translated by applyPdfConvertBatchResult; this only rescues a stale/legacy row
// that still holds the RAW Render shape (per-record `ok`, base64, no `success`,
// and possibly no `error`), so it can never show a blank-reason failure.
function normalizeBatchResult(result) {
  if (!result || !Array.isArray(result.results)) return result;
  const results = result.results.map((r) => {
    if (!r || typeof r !== 'object') return r;
    // Already in the translated shape — leave it (but drop any stray base64).
    if ('success' in r) {
      const { pdfBase64, base64, ...rest } = r; // eslint-disable-line no-unused-vars
      return rest;
    }
    // Raw Render shape: derive success from `ok` and guarantee a non-empty error.
    const success = !!r.ok;
    const { pdfBase64, base64, ok, ...rest } = r; // eslint-disable-line no-unused-vars
    return success
      ? { ...rest, success: true }
      : { ...rest, success: false, error: r.error || 'conversion failed (no detail recorded — please retry)' };
  });
  return { ...result, results };
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

    // ---- ATOMIC CLAIM (audit MGMT-BE-02) ----
    //
    // The read above and the `status='completed'` write at the end used to be the whole of
    // the idempotency story, and everything expensive happened BETWEEN them. Two callbacks
    // arriving together — Render retrying, a webhook delivered twice, a reconcile racing a
    // late reply — both SELECT, both see `dispatched`, both pass the check above, and both
    // run `applyResultSideEffect`. That is not a double row: for `pdf_convert` it writes the
    // PDF to R2 and inserts into `generated_files` TWICE, and for `ai_pr_create` it opens a
    // second GitHub pull request. Sequential idempotency is not idempotency.
    //
    // So the claim is the UPDATE, not the SELECT: exactly one caller can move a row out of
    // pending/dispatched, and `meta.changes` says whether it was us. The loser returns
    // without touching anything.
    //
    // The claim marker carries its own timestamp (`applying@<iso>`) so a claim that dies
    // mid-side-effect is recoverable — see reconcileStuckJobs. It lives in the existing TEXT
    // `status` column, which has no CHECK constraint, so this needs NO migration. (A column
    // would also have meant reckoning with `render_jobs` existing only in migration 23 and
    // not in the canonical schema — a real problem, but W4's, and coupling them would make
    // both harder to review.)
    const now = new Date().toISOString();
    const claim = await db.prepare(
      `UPDATE render_jobs SET status=? WHERE job_id=? AND status IN ('pending','dispatched')`
    ).bind(`${APPLYING_PREFIX}${now}`, jobId).run();
    if (!claim || !claim.meta || claim.meta.changes !== 1) {
      // Either another callback is applying this result right now, or it already finished.
      // Both mean: do not run the side effect again.
      return { success: true, applied: false, message: 'already being applied' };
    }
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

      // audit MGMT-BE-04. The router bumps the data version when the job is DISPATCHED, but
      // the generated_files index — which the public portal reads — is written just above,
      // when the callback arrives. Those are minutes apart, so the public payload cached
      // against the dispatch-time version does not contain the document that was just
      // generated, and stays that way until some unrelated edit bumps the counter again. A
      // visitor following a QR code sees "not generated yet" for a receipt that exists.
      //
      // Bumped AFTER the row is finalised, and failures are swallowed: a version that did
      // not move is a stale portal, while a throw here would turn a completed job into a
      // failed one and re-run the side effect on retry.
      if (VERSION_BUMPING_KINDS.has(row.kind)) {
        try {
          const { bumpDataVersion } = await import('./dataVersion.js');
          await bumpDataVersion(env);
        } catch (e) {
          await logWarn(env, 'backend-render', 'handleRenderCallback:bumpDataVersion',
            `Generated file indexed but the public data version could not be bumped (job ${jobId}): ${(e && e.message) || e}`,
            { jobId, kind: row.kind }).catch(() => {});
        }
      }
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
  if (jobRow.kind === 'docx_render') {
    // The auto-generate-on-save path. Render FILLED the template (+QR) and
    // converted it to a PDF, returning the bytes. The Worker writes R2 + the
    // generated_files index (binding-only, unchanged trust boundary) and — because
    // the PDF now exists and has a publicLink — THEN triggers WhatsApp then email
    // in that exact order, gated to NEW entries only. The stored jobRow.payload is
    // METADATA ONLY (docType/year/recordId/isNewEntry + the notification snapshot);
    // the template bytes + fill data were Render-body-only (NON_RECONSTRUCTABLE).
    const { applyDocxRenderResult } = await import('./collectionQueue.js');
    if (typeof applyDocxRenderResult === 'function') {
      let payload = {};
      try { payload = JSON.parse(jobRow.payload || '{}'); } catch (e) { payload = {}; }
      return await applyDocxRenderResult(env, payload, result);
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

  // A claim that died mid-side-effect (audit MGMT-BE-02). It is deliberately FAILED and never
  // re-dispatched: we cannot know how far the side effect got, and re-running it is exactly
  // the duplicate R2 write / duplicate pull request the claim exists to prevent. A human
  // reading a clear error is the right outcome; a silent retry is not.
  const applyCutoff = new Date(Date.now() - APPLYING_STUCK_MINUTES * 60 * 1000).toISOString();
  const { results: stuckApplying } = await db.prepare(
    `SELECT * FROM render_jobs WHERE status LIKE ? AND status < ? ORDER BY id ASC LIMIT 10`
  ).bind(`${APPLYING_PREFIX}%`, `${APPLYING_PREFIX}${applyCutoff}`).all().catch(() => ({ results: [] }));

  let reconciled = 0;
  for (const row of (stuckApplying || [])) {
    try {
      const msg = 'The server stopped while applying this result. It was NOT retried automatically, '
        + 'because part of the work may already have been done — check the outcome and re-run if needed.';
      const done = await db.prepare(
        `UPDATE render_jobs SET status='failed', error=?, finished_at=? WHERE job_id=? AND status=?`
      ).bind(msg, new Date().toISOString(), row.job_id, row.status).run();
      if (done && done.meta && done.meta.changes === 1) {
        await logWarn(env, 'backend-render', 'reconcileStuckJobs:stuckApplying',
          `Job ${row.job_id} (${row.kind}) was claimed at ${applyingSince(row.status)} and never finished.`,
          { jobId: row.job_id, kind: row.kind }).catch(() => {});
        await applyFailureSideEffect(env, row, msg).catch(() => {});
        reconciled++;
      }
    } catch (e) {
      await logErrorAt(env, 'backend-render', 'reconcileStuckJobs:stuckApplying', e, { jobId: row.job_id }).catch(() => {});
    }
  }

  // Rows still waiting on Render, past the stuck window.
  const { results } = await db.prepare(
    `SELECT * FROM render_jobs WHERE status='dispatched' AND (dispatched_at IS NULL OR dispatched_at < ?)
      ORDER BY id ASC LIMIT 10`
  ).bind(cutoff).all().catch(() => ({ results: [] }));

  for (const row of (results || [])) {
    try {
      // audit MGMT-BE-03. Re-dispatching one of these sends the stored METADATA-ONLY payload:
      // pdf_convert_batch without its base64 documents, provider_test without the API key.
      // The job cannot succeed — it can only fail slowly, or half-run — and meanwhile the
      // ORIGINAL attempt may still be running on Render, doing irreversible Drive work. So
      // they time out with a reason the operator can act on instead of being retried.
      if (NON_RECONSTRUCTABLE_KINDS.has(row.kind)) {
        const msg = 'Timed out waiting for the processing service. This job cannot be retried '
          + 'automatically (its request data is not stored on the server) — please run it again.';
        const done = await db.prepare(
          `UPDATE render_jobs SET status='failed', error=?, finished_at=? WHERE job_id=? AND status='dispatched'`
        ).bind(msg, new Date().toISOString(), row.job_id).run();
        if (done && done.meta && done.meta.changes === 1) {
          await applyFailureSideEffect(env, row, msg).catch(() => {});
          reconciled++;
        }
        continue;
      }
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
  // READ-BOUNDARY GUARD: a completed pdf_convert_batch row written by an OLDER
  // build could still hold the RAW Render shape (per-record `ok`, no `success`,
  // and no `error` on success). Normalize it here so a stale row can NEVER surface
  // a blank-reason failure to the client. Live rows are already translated, so
  // this is a no-op for them.
  if (row.kind === 'pdf_convert_batch') result = normalizeBatchResult(result);
  return {
    success: true,
    job: {
      jobId: row.job_id, kind: row.kind,
      // The claim marker carries a timestamp, which is server bookkeeping. A client polls
      // until it sees completed/failed, so it is reported as a plain in-progress state.
      status: isApplying(row.status) ? 'applying' : row.status,
      refId: row.ref_id, attempts: row.attempts,
      result, error: row.error || null,
      createdAt: row.created_at, dispatchedAt: row.dispatched_at, finishedAt: row.finished_at,
    },
  };
}
