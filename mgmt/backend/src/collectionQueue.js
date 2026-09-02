// ============ COLLECTION QUEUE (server-side background jobs) ============
//
// WHY: previously, saving a COLLECTION made the browser wait through a
// multi-step chain — save -> generate PDF -> queue WhatsApp — before the modal
// closed. This module moves the slow steps (PDF conversion + WhatsApp queueing)
// into a background Cron Trigger so the SAVE returns instantly.
//
// FLOW:
//   1. Browser fills the .docx template client-side (unchanged — docxFill.js)
//      and calls enqueueCollectionJob() with the already-filled base64.
//   2. enqueueCollectionJob() just INSERTs one `pending` row into
//      collection_jobs and returns. Fast.
//   3. A Cron Trigger (see wrangler.toml [triggers] + index.js scheduled())
//      calls processPendingJobs() every minute. For each pending job it runs the
//      EXISTING, already-server-side convertDocxToPdf() + triggerCollectionMessages()
//      — no new heavy library in the Worker — then marks the row done/failed.
//
// SAFETY / NON-BREAKING:
//   * This is additive. If the cron is disabled the queue simply stops draining;
//     nothing else changes.
//   * The DOCX FILLING still happens in the browser exactly as before, so no
//     risky server-side docxtemplater port. Only the orchestration moved.
//   * enqueue enforces the same staff permission the direct save always required.

import { requireStaffRole, requireRole, requireYearUnlocked, requireYearAccess, requireSuperadmin } from './auth.js';
import { convertDocxToPdf } from './docxTemplates.js';
import { triggerCollectionMessages } from './whatsapp.js';
import { logErrorAt, logWarn } from './logger.js';

const MAX_ATTEMPTS = 3;          // a job that keeps failing is parked as 'failed'
const CLAIM_BATCH = 5;           // jobs processed per cron tick (keeps within CPU limits)
const STUCK_MINUTES = 10;        // a 'processing' row older than this is retried

function genJobId() {
  return 'JOB' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function jobsDb(env) {
  if (!env || !env.DB_MISC) throw new Error('DB_MISC binding not configured — collection_jobs unavailable.');
  return env.DB_MISC;
}

// ---- ENQUEUE (called from the save path, staff only) ----
//
// `job` shape from the client:
//   { docType, year, rowIndex, recordId, isNewEntry, payload, filledBase64, fileName }
// docType/filledBase64 may be '' when the collection has no auto-document
// (e.g. a resell entry) — in that case the job still runs to queue WhatsApp.
export async function enqueueCollectionJob(env, job, user) {
  // Same gate the direct save enforced: staff role. (A finer per-sheet 'add'
  // check already happened during saveRecord itself, which runs before this.)
  requireStaffRole(user);
  if (!job || typeof job !== 'object') throw new Error('Invalid job');

  const db = jobsDb(env);
  const jobId = genJobId();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO collection_jobs
      (job_id, status, doc_type, year, row_index, record_id, is_new_entry, payload, filled_base64, file_name, attempts, created_by, created_at)
     VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).bind(
    jobId,
    (job.docType || '').toString(),
    (job.year || '').toString(),
    job.rowIndex != null ? parseInt(job.rowIndex) : null,
    (job.recordId || '') || null,
    job.isNewEntry === false ? 0 : 1,
    safeJson(job.payload || {}),
    (job.filledBase64 || '').toString(),
    (job.fileName || '').toString(),
    user ? user.name : (job.createdBy || ''),
    now
  ).run();

  return { success: true, jobId };
}

// ---- STATUS (any staff role) — powers the small queue panel in every portal ----
export async function getCollectionQueueStatus(env, user) {
  requireStaffRole(user);
  const db = jobsDb(env);

  const { results } = await db.prepare(
    `SELECT status, COUNT(*) AS c FROM collection_jobs GROUP BY status`
  ).all();
  const counts = { pending: 0, processing: 0, done: 0, failed: 0 };
  for (const r of results || []) {
    if (counts[r.status] !== undefined) counts[r.status] = r.c;
  }

  // Most recent few, for a compact activity view. filled_base64 is deliberately
  // NOT selected (it is large and the UI never needs it).
  const { results: recent } = await db.prepare(
    `SELECT job_id, status, doc_type, year, record_id, attempts, last_error, created_at, finished_at
       FROM collection_jobs ORDER BY id DESC LIMIT 20`
  ).all();

  return { success: true, counts, recent: recent || [] };
}

// ---- SUPERADMIN QUEUE MONITOR: full job list across ALL users ----
//
// Powers the dedicated "Queue Monitor" tab (Superadmin only). Unlike the compact
// getCollectionQueueStatus (last 20, any staff role), this returns a fuller,
// filterable list with the acting user (created_by) so a Superadmin can audit
// every user's background jobs and retry the failed ones.
//
// filled_base64 is intentionally NOT selected — it is large and the monitor UI
// never needs it (retry re-reads it server-side from the row).
export async function getQueueJobsForSuperadmin(env, user, opts = {}) {
  requireSuperadmin(user);
  const db = jobsDb(env);

  const status = (opts.status || '').toString().trim().toLowerCase();
  const validStatuses = ['pending', 'processing', 'done', 'failed'];
  let limit = parseInt(opts.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  if (limit > 500) limit = 500;

  // Summary counts (unaffected by the status filter, so the tab always shows the
  // full picture).
  const { results: countRows } = await db.prepare(
    `SELECT status, COUNT(*) AS c FROM collection_jobs GROUP BY status`
  ).all();
  const counts = { pending: 0, processing: 0, done: 0, failed: 0 };
  for (const r of countRows || []) {
    if (counts[r.status] !== undefined) counts[r.status] = r.c;
  }

  const cols = `job_id, status, doc_type, year, record_id, attempts, last_error,
                public_link, created_by, created_at, claimed_at, finished_at`;
  let query, binds;
  if (validStatuses.includes(status)) {
    query = `SELECT ${cols} FROM collection_jobs WHERE status = ? ORDER BY id DESC LIMIT ?`;
    binds = [status, limit];
  } else {
    query = `SELECT ${cols} FROM collection_jobs ORDER BY id DESC LIMIT ?`;
    binds = [limit];
  }
  const { results: jobs } = await db.prepare(query).bind(...binds).all();

  return { success: true, counts, jobs: jobs || [], maxAttempts: MAX_ATTEMPTS };
}

// ---- SUPERADMIN QUEUE MONITOR: retry a job ----
//
// Resets a job back to 'pending' with attempts = 0 so the on-demand processor
// (or cron) picks it up again. Intended for 'failed' jobs, but any non-'done'
// job may be retried (a stuck 'processing' row can be re-queued this way too).
// A 'done' job is refused — its filled_base64 has already been consumed and the
// side effects (PDF + WhatsApp) already ran, so retrying would duplicate them.
//
// After resetting, it fire-and-forget nudges the processor so the retry starts
// draining immediately instead of waiting for the next cron tick.
export async function retryQueueJob(env, user, jobId) {
  requireSuperadmin(user);
  const db = jobsDb(env);

  const id = (jobId || '').toString().trim();
  if (!id) throw new Error('jobId is required.');

  const row = await db.prepare(
    `SELECT id, status FROM collection_jobs WHERE job_id = ?`
  ).bind(id).first();
  if (!row) throw new Error('Job not found.');
  if (row.status === 'done') throw new Error('This job has already completed successfully and cannot be retried.');

  await db.prepare(
    `UPDATE collection_jobs
        SET status = 'pending', attempts = 0, last_error = '', claimed_at = NULL, finished_at = NULL
      WHERE job_id = ?`
  ).bind(id).run();

  // Kick the processor so the retry runs now (best-effort; the cron is a backup).
  try { await processPendingJobs(env); } catch (e) { /* non-fatal — cron will pick it up */ }

  return { success: true, jobId: id };
}

// ---- ON-DEMAND PROCESSOR (called by the frontend right after a save) ----
//
// Cloudflare Cron Triggers on the free plan fire unreliably, so we don't wait
// for them: the UI calls this fire-and-forget after enqueuing, and it drains the
// queue within seconds. Staff-gated (any logged-in staff role). Reuses the exact
// same claim-and-process path as the cron, so concurrent runs are safe.
export async function processCollectionQueueOnDemand(env, user) {
  requireStaffRole(user);
  return processPendingJobs(env);
}

// ---- CRON PROCESSOR (called from scheduled()) ----
//
// Claims up to CLAIM_BATCH pending (or stuck 'processing') jobs and processes
// each. Never throws to the caller — the cron must always return cleanly.
export async function processPendingJobs(env) {
  let db;
  try { db = jobsDb(env); } catch (e) { return { processed: 0, note: 'DB_MISC missing' }; }

  const stuckCutoff = new Date(Date.now() - STUCK_MINUTES * 60000).toISOString();

  // Eligible = still pending, OR marked processing but stale (a previous tick
  // died mid-flight). Cap attempts so a permanently-bad job doesn't loop.
  const { results: jobs } = await db.prepare(
    `SELECT * FROM collection_jobs
      WHERE attempts < ?
        AND (status = 'pending' OR (status = 'processing' AND (claimed_at IS NULL OR claimed_at < ?)))
      ORDER BY id ASC LIMIT ?`
  ).bind(MAX_ATTEMPTS, stuckCutoff, CLAIM_BATCH).all().catch(() => ({ results: [] }));

  let processed = 0;
  for (const job of jobs || []) {
    // Claim it (optimistic — only if it's still in the state we read). This
    // guards against two overlapping cron ticks grabbing the same row.
    const claim = await db.prepare(
      `UPDATE collection_jobs
          SET status = 'processing', claimed_at = ?, attempts = attempts + 1
        WHERE id = ? AND status IN ('pending', 'processing')`
    ).bind(new Date().toISOString(), job.id).run().catch(() => null);
    if (!claim || !claim.meta || claim.meta.changes === 0) continue; // someone else took it

    try {
      await runOneJob(env, job);
      await db.prepare(
        `UPDATE collection_jobs SET status = 'done', finished_at = ?, last_error = '' WHERE id = ?`
      ).bind(new Date().toISOString(), job.id).run();
      processed++;
    } catch (err) {
      const attempts = (parseInt(job.attempts) || 0) + 1;
      const parked = attempts >= MAX_ATTEMPTS;
      await db.prepare(
        `UPDATE collection_jobs SET status = ?, last_error = ?, finished_at = ? WHERE id = ?`
      ).bind(parked ? 'failed' : 'pending', (err && err.message || String(err)).slice(0, 500),
             parked ? new Date().toISOString() : null, job.id).run().catch(() => {});
      await logErrorAt(env, 'collection-queue', 'processPendingJobs', err, {
        jobId: job.job_id, docType: job.doc_type, recordId: job.record_id, attempts, parked,
      });
    }
  }

  return { processed };
}

// Runs the PDF + WhatsApp steps for one claimed job. Mirrors exactly what
// Home.jsx used to do inline, but server-side.
async function runOneJob(env, job) {
  const payload = parseJson(job.payload) || {};
  const docType = (job.doc_type || '').toString();
  const year = (job.year || '').toString();
  const recordId = job.record_id || null;
  let publicLink = '';

  // 1) PDF generation (only when the client actually filled a document).
  if (docType && job.filled_base64 && recordId) {
    // The job was already authorized at enqueue time (staff-only). The cron is a
    // trusted internal caller, so we pass a system user with a staff role that
    // satisfies convertDocxToPdf's requireStaffRole for mode 'auto'. Attribution
    // (created_by) is preserved for the audit trail.
    const systemUser = { name: job.created_by || 'system', role: 'Superadmin', system: true };
    const res = await convertDocxToPdf(
      env, docType, year, recordId, job.filled_base64, job.file_name || `${docType}.docx`,
      systemUser, 'auto', {}
    );
    publicLink = (res && res.publicLink) || '';
    if (res && res.indexFailed) {
      await logWarn(env, 'collection-queue', 'runOneJob',
        `PDF generated but NOT indexed for ${recordId}.`, { jobId: job.job_id, recordId, publicLink });
    }
    // Persist the link so the queue panel / retries can see it.
    try {
      await env.DB_MISC.prepare('UPDATE collection_jobs SET public_link = ? WHERE id = ?')
        .bind(publicLink, job.id).run();
    } catch (e) { /* non-fatal */ }
  }

  // 2) WhatsApp — only for NEW entries (edits never queued messages, same as before).
  if (job.is_new_entry) {
    const summary = await triggerCollectionMessages(env, payload, docType || null, recordId, publicLink || '');
    if (summary && summary.groupMessagesSent === 0 && summary.personMessageSent === false) {
      await logWarn(env, 'collection-queue', 'runOneJob',
        `No WhatsApp message queued for job ${job.job_id}.`,
        { jobId: job.job_id, recordId, warnings: (summary.warnings || []) });
    }
  }
}

function safeJson(obj) {
  try { return JSON.stringify(obj); } catch (e) { return '{}'; }
}
function parseJson(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}
