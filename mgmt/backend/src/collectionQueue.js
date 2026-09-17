// ============ COLLECTION QUEUE (server-side background jobs) ============
//
// WHY: previously, saving a COLLECTION made the browser wait through a
// multi-step chain — save -> generate PDF -> queue WhatsApp — before the modal
// closed. This module moves the slow steps (PDF conversion + WhatsApp queueing)
// into a background Cron Trigger so the SAVE returns instantly.
//
// FLOW (server-side fill — FEAT-003):
//   1. Browser calls enqueueCollectionJob() with REFERENCES ONLY: docType, rowIndex
//      and year. It no longer fills the .docx or builds the QR — the stored
//      collection row is the single source of truth (audit P0-03).
//   2. enqueueCollectionJob() INSERTs one `pending` row into collection_jobs and
//      returns. Fast. filled_base64 is written as '' — nothing heavy lands in D1
//      any more (closes M-38 storage hog + #364 failed-job retention gap).
//   3. processPendingJobs() (on-demand nudge + Cron backstop) claims each pending
//      job. For a job WITH a document, runOneJob resolves the TEMPLATE bytes
//      (Worker-side Drive + KV cache) and the fill data (server-built from the
//      stored row), then dispatches a `docx_render` Render job (fill + QR + PDF).
//      For a resell / no-document job there is nothing to render, so runOneJob
//      triggers WhatsApp then email directly.
//   4. On the render callback the Worker writes R2 + generated_files (unchanged
//      trust boundary) and, because the PDF now exists and has a publicLink, THEN
//      triggers WhatsApp then email in that exact order — see applyDocxRenderResult.
//
// SAFETY / NON-BREAKING:
//   * The generate -> message -> send ORDER is preserved and, because the fill is
//     now async on Render, WhatsApp+email are sequenced on the render callback so
//     nothing goes out before the document exists.
//   * WhatsApp+email stay NEW-ENTRY-ONLY (edits never message) and email stays
//     isolated in its own try/catch so it can never fail the job or the WhatsApp
//     send.
//   * Only the Worker writes R2; Render returns bytes. Render never touches D1/R2.
//   * enqueue enforces the same staff permission the direct save always required
//     and every P0-03/P0-04 invariant.

import { requireStaffRole, requireRole, requireYearUnlocked, requireYearAccess, requireSuperadmin, ValidationError, InternalError } from './auth.js';
import { fromColumnRow } from './tableRegistry.js';
import { getDocxTemplate, applyPdfConvertResult } from './docxTemplates.js';
import { buildReceiptData, buildCertificateData, buildSamaanData } from './templates.js';
import { triggerCollectionMessages } from './whatsapp.js';
import { triggerCollectionEmail } from './email.js';
import { logErrorAt, logWarn } from './logger.js';
import { randomId } from './random.js';

const MAX_ATTEMPTS = 3;          // a job that keeps failing is parked as 'failed'
const CLAIM_BATCH = 5;           // jobs processed per cron tick (keeps within CPU limits)
const STUCK_MINUTES = 10;        // a 'processing' row older than this is retried

// The ONLY documents a COLLECTION save can auto-generate (see
// whatsapp.js resolveCollectionDocType). '' means "no document, WhatsApp only",
// which is the resell case. Consent/report types are deliberately absent — see
// the security note in enqueueCollectionJob.
const QUEUEABLE_DOC_TYPES = new Set(['', 'receipt', 'receipt_work', 'certificate', 'samaan']);

// The new (server-side) enqueue no longer accepts a filled .docx at all — the fill
// moved to Render — so nothing large lands in a job row. The cap is KEPT only for a
// LEGACY client that is still sending bytes during a rollout (an old bundle cached
// in a browser), so such a request is rejected cleanly instead of blowing D1's
// ~1 MB row limit. Once every client is updated this branch is dead.
const MAX_QUEUE_BASE64_CHARS = 700 * 1024;

const genJobId = () => randomId('JOB');

function jobsDb(env) {
  if (!env || !env.DB_MISC) throw InternalError('DB_MISC binding not configured — collection_jobs unavailable.');
  return env.DB_MISC;
}

// ---- ENQUEUE (called from the save path, staff only) ----
//
// `job` shape from the (updated) client — REFERENCES ONLY:
//   { docType, rowIndex, isNewEntry, year?, recordId? }
// docType may be '' when the collection has no auto-document (e.g. a resell
// entry) — in that case the job still runs to queue WhatsApp + email.
//
// `filledBase64` / `fileName` / `payload` are no longer used to drive the render
// (the fill is server-side now) but are still ACCEPTED and cross-checked for
// backwards compatibility with a legacy client during rollout; filled_base64 is
// never stored (the row is written with '').
//
// `rowIndex` is REQUIRED: it is the id of the collection row that was just saved,
// and everything that identifies the job (year, record id, notification payload)
// is read back from that row. `year` / `recordId` / `payload` are still accepted
// for backwards compatibility, but they are only cross-checked, never trusted
// (audit P0-03).
export async function enqueueCollectionJob(env, job, user) {
  // Same gate the direct save enforced: staff role.
  requireStaffRole(user);
  if (!job || typeof job !== 'object') throw InternalError('Invalid job');

  // ---- audit P0-03: the job must describe a COMMITTED collection row ----
  //
  // Everything below used to be taken from the client: `recordId`, `year` and the
  // whole `payload` that later drives the PDF filename, the WhatsApp message and
  // the email. Nothing loaded the collection row those values claimed to
  // describe. A staff account with 'add' on one year could therefore enqueue an
  // invented `receipt-<year>-<anything>` with a payload naming any contributor
  // and any amount, and the cron would generate that document and announce it —
  // as a system caller, with no committed financial row behind it.
  //
  // The row id is now mandatory, the row is loaded, and the job's identity
  // (year, record id, notification payload) is DERIVED from the stored row.
  const rowIndex = job.rowIndex != null && job.rowIndex !== '' ? parseInt(job.rowIndex) : NaN;
  if (!Number.isFinite(rowIndex) || rowIndex <= 0) {
    throw ValidationError('This job could not be queued: it does not reference a saved collection entry. Please reload the page and save again.');
  }
  if (!env.DB_COLLECTIONS) throw InternalError('DB_COLLECTIONS binding not configured — a collection job cannot be verified.');
  const storedRow = await env.DB_COLLECTIONS.prepare('SELECT * FROM collections WHERE id = ?').bind(rowIndex).first();
  if (!storedRow) {
    throw ValidationError('This job could not be queued: the collection entry it refers to no longer exists.');
  }

  // The year comes from the row, not from the request. The caller's claimed year
  // is still checked when it differs, so a mismatch can only ADD checks, never
  // skip one (same rule as deleteLoanTransaction — audit H-8 (4)).
  const storedYear = (storedRow.year != null && storedRow.year !== '') ? storedRow.year.toString() : '';
  if (storedYear) {
    await requireYearUnlocked(env, storedYear);
    await requireYearAccess(env, user, storedYear);
  }
  const claimedYear = (job.year != null && job.year !== '') ? job.year.toString() : '';
  if (claimedYear && storedYear && claimedYear !== storedYear) {
    await requireYearUnlocked(env, claimedYear);
    await requireYearAccess(env, user, claimedYear);
    throw ValidationError('This job could not be queued: it refers to a different year than the saved entry. Please reload the page and try again.');
  }

  // SECURITY (audit C-2): runOneJob() drives convertDocxToPdf() with a fabricated
  // `{ role: 'Superadmin', system: true }` user, so EVERYTHING a job carries is
  // effectively executed with Superadmin rights. doc_type / record_id /
  // filled_base64 all come from the client, which meant a Subadmin could enqueue
  // docType:'consent_loaner' with someone else's recordId and arbitrary bytes and
  // have the queue overwrite that consent's indexed PDF on their behalf.
  //
  // This queue exists for ONE purpose: the document that a COLLECTION save
  // auto-generates. Restrict it to exactly those types, and require the record id
  // to describe the document being written.
  const docType = (job.docType || '').toString();
  if (!QUEUEABLE_DOC_TYPES.has(docType)) {
    throw ValidationError(`"${docType}" documents cannot be queued from a collection save.`);
  }
  // The record id is DERIVED, not accepted: `<docType>-<storedYear>-<rowId>` is
  // exactly what the client is expected to build, so a request that disagrees is
  // either stale or crafted — refuse it rather than silently writing to the id the
  // server chose (the caller would then get a document it did not ask for).
  const derivedRecordId = docType ? `${docType}-${storedYear}-${rowIndex}` : '';
  const claimedRecordId = (job.recordId || '').toString();
  if (claimedRecordId && !docType) {
    throw ValidationError('This job could not be queued (a document reference was supplied without a document type).');
  }
  if (claimedRecordId && claimedRecordId !== derivedRecordId) {
    throw ValidationError('This job could not be queued: its document reference does not match the saved entry. Please reload the page and try again.');
  }
  const recordId = derivedRecordId;

  // A job row lives in D1, which has a ~1 MB practical row limit, and
  // filled_base64 is by far the largest column. Reject an oversized payload here
  // rather than letting the INSERT fail AFTER the collection was already saved.
  const filled = (job.filledBase64 || '').toString();
  if (filled.length > MAX_QUEUE_BASE64_CHARS) {
    throw ValidationError(
      `The generated document is too large to queue (${(filled.length / 1048576).toFixed(1)} MB of ${(MAX_QUEUE_BASE64_CHARS / 1048576).toFixed(1)} MB). The entry was saved; please ask a Superadmin to generate this document from the Generate PDFs screen.`
    );
  }

  const db = jobsDb(env);
  const jobId = genJobId();
  const now = new Date().toISOString();

  // The notification payload is rebuilt from the STORED row, so the contributor,
  // amount, payment mode, contribution type and resell flag that the WhatsApp
  // message and the email announce are the committed ones. The client's payload is
  // no longer trusted for any of it.
  //
  // filled_base64 is no longer stored: the fill happens on Render at run time from
  // the Worker-resolved template + server-built data, so the job row carries only
  // references. What an attacker can no longer do is point a document at a record
  // that does not exist, at another year, or announce figures that were never saved.
  const payload = fromColumnRow('collections', storedRow);
  delete payload.__rowIndex;
  if (!payload['Created By'] && user && user.name) payload['Created By'] = user.name;

  // Double-submit protection: one live job per (row, document) at a time. Two
  // clicks on Save, or a retry after a slow response, used to create two jobs —
  // and two PDFs plus two WhatsApp messages for one entry.
  const inserted = await db.prepare(
    `INSERT INTO collection_jobs
      (job_id, status, doc_type, year, row_index, record_id, is_new_entry, payload, filled_base64, file_name, attempts, created_by, created_at)
     SELECT ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM collection_jobs
         WHERE row_index = ? AND doc_type = ? AND status IN ('pending', 'processing')
      )`
  ).bind(
    jobId,
    docType,
    storedYear,
    rowIndex,
    recordId || null,
    job.isNewEntry === false ? 0 : 1,
    safeJson(payload),
    '', // filled_base64 is never stored — the fill is server-side (Render) now
    (job.fileName || '').toString(),
    user ? user.name : (job.createdBy || ''),
    now,
    rowIndex,
    docType
  ).run();

  if (!inserted || !inserted.meta || inserted.meta.changes === 0) {
    const existing = await db.prepare(
      `SELECT job_id FROM collection_jobs
        WHERE row_index = ? AND doc_type = ? AND status IN ('pending', 'processing')
        ORDER BY id DESC LIMIT 1`
    ).bind(rowIndex, docType).first('job_id').catch(() => null);
    return { success: true, jobId: existing || null, deduped: true };
  }

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

  // `claimed_at` now carries a verifiable claim token (`<iso>#<uuid>`, see the
  // claim in processPendingJobs). The monitor only wants the timestamp.
  const cleaned = (jobs || []).map(j => (
    j && typeof j.claimed_at === 'string' && j.claimed_at.includes('#')
      ? { ...j, claimed_at: j.claimed_at.split('#')[0] }
      : j
  ));

  return { success: true, counts, jobs: cleaned, maxAttempts: MAX_ATTEMPTS };
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
  if (!id) throw ValidationError('jobId is required.');

  const row = await db.prepare(
    `SELECT id, status FROM collection_jobs WHERE job_id = ?`
  ).bind(id).first();
  if (!row) throw ValidationError('Job not found.');
  if (row.status === 'done') throw ValidationError('This job has already completed successfully and cannot be retried.');

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
// audit M-4: this is an unmetered heavy-work trigger available to ANY staff role —
// each call can drive up to CLAIM_BATCH Google Drive conversions — and QueueStatus.jsx
// nudges it from a 10-second poll. A loop could burn Drive quota and Worker CPU.
//
// WHY THE THROTTLE IS IN-ISOLATE AND NOT IN KV: a KV-backed cooldown would need a KV
// WRITE on every drain attempt, and KV allows only ~1000 writes/day — the tightest
// limit in this system. Spending that budget to rate-limit a call that is already
// bounded elsewhere would be the wrong trade. A module-level timestamp costs nothing,
// and Cloudflare reuses an isolate for bursts from the same colo, so it catches the
// realistic case (one client or script hammering the endpoint) at zero quota cost.
//
// It is deliberately NOT a distributed lock, and it does not need to be: correctness
// against concurrent drains comes from the verifiable claim in processPendingJobs
// (an exact-state `UPDATE ... SET claimed_at = <token>` followed by a re-read that
// confirms the token is ours — audit P0-04). This throttle only trims wasted work.
const DRAIN_COOLDOWN_MS = 5000;
let lastDrainStartedAt = 0;

export async function processCollectionQueueOnDemand(env, user) {
  requireStaffRole(user);
  const now = Date.now();
  if (now - lastDrainStartedAt < DRAIN_COOLDOWN_MS) {
    // Not an error: the queue is already being drained, and the cron is the backstop.
    return { processed: 0, throttled: true };
  }
  lastDrainStartedAt = now;
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
  //
  // rows_read: we DELIBERATELY do NOT `SELECT *` here. filled_base64 is a fat TEXT
  // column (legacy in-flight rows may still hold a base64 .docx; new rows store ''),
  // and this poll runs every 3 min (cron) plus on every retry/nudge — pulling that
  // blob for every candidate row silently burned the D1 free-tier read budget (5M
  // rows/day). We select ONLY the small columns the claim + runOneJob need and NEVER
  // filled_base64 (the fill is server-side now, so nothing needs it). Paired with
  // idx_collection_jobs_status_attempts (migration 2026-09-05/14) the WHERE is
  // index-served, not a full scan.
  const { results: jobs } = await db.prepare(
    `SELECT id, job_id, status, doc_type, year, row_index, record_id, is_new_entry,
            payload, file_name, created_by, attempts
       FROM collection_jobs
      WHERE attempts < ?
        AND (status = 'pending' OR (status = 'processing' AND (claimed_at IS NULL OR claimed_at < ?)))
      ORDER BY id ASC LIMIT ?`
  ).bind(MAX_ATTEMPTS, stuckCutoff, CLAIM_BATCH).all().catch(() => ({ results: [] }));

  let processed = 0;
  for (const job of jobs || []) {
    // ---- audit P0-04: the claim must match the state we actually read ----
    //
    // The old predicate was `WHERE id = ? AND status IN ('pending','processing')`.
    // It did NOT repeat the staleness cutoff, so a row another drain had just
    // claimed (status now 'processing', claimed_at = a second ago) STILL matched:
    // both drains got changes = 1 and both ran the job. That means a duplicate
    // PDF in Drive, a duplicate WhatsApp message and a duplicate email to the
    // contributor, plus double attempts and a racing finalise — while the comment
    // above claimed concurrent drains were safe.
    //
    // Now the claim repeats the exact eligibility it selected on (pending, or
    // processing but stale) and carries a unique claim token in claimed_at — the
    // same verifiable-claim pattern whatsapp.js getPendingMessages() uses. After
    // the write we re-read the row and only proceed if the token is ours.
    const claimToken = `${new Date().toISOString()}#${crypto.randomUUID()}`;
    const claim = await db.prepare(
      `UPDATE collection_jobs
          SET status = 'processing', claimed_at = ?, attempts = attempts + 1
        WHERE id = ?
          AND attempts < ?
          AND (status = 'pending' OR (status = 'processing' AND (claimed_at IS NULL OR claimed_at < ?)))`
    ).bind(claimToken, job.id, MAX_ATTEMPTS, stuckCutoff).run().catch(() => null);
    if (!claim || !claim.meta || claim.meta.changes === 0) continue; // someone else took it

    // Belt-and-braces: confirm the row carries OUR token. A concurrent drain that
    // wrote in the same instant would have replaced it, and that drain — not this
    // one — owns the job.
    const owner = await db.prepare('SELECT claimed_at FROM collection_jobs WHERE id = ?')
      .bind(job.id).first('claimed_at').catch(() => null);
    if (owner !== claimToken) continue;

    try {
      // No heavy blob to load any more: runOneJob resolves the template + builds
      // the fill data server-side and dispatches a Render job (or, for a resell /
      // no-document job, triggers WhatsApp + email directly). The poll above stays
      // cheap and there is nothing large to re-read for the claimed row.
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

// Which server-side data builder produces the placeholder set for a doc type, and
// the placeholder that holds its document number (used for the file name). A
// `receipt_work` reuses the `receipt` template + placeholder set (only the template
// document differs), exactly as the browser path did.
// The UNGATED data builders: the queue is a trusted internal caller and the staff
// role + year access were already enforced at enqueue time (audit P0-03), so it
// must not re-run the staff-facing gate as a fabricated committee member. These
// share the SAME placeholder builders the receipt modal uses, so the auto path and
// the modal cannot drift.
const DOC_DATA_FETCH = {
  receipt: buildReceiptData,
  receipt_work: buildReceiptData,
  certificate: buildCertificateData,
  samaan: buildSamaanData,
};
const DOC_NO_KEY = { receipt: 'RECEIPT_NO', receipt_work: 'RECEIPT_NO', certificate: 'CERT_NO', samaan: 'SAMAAN_NO' };

// Runs one claimed job server-side, preserving the exact order the user requires:
// generate the document -> WhatsApp -> email.
//
// For a job WITH a document, the fill is async on Render, so runOneJob only gets as
// far as DISPATCHING the docx_render job here (template resolved Worker-side, fill
// data built server-side, QR generated on Render). The WhatsApp + email steps run
// AFTER the PDF exists — on the render callback (applyDocxRenderResult) — so nothing
// goes out before the document exists and the order is guaranteed.
//
// For a resell / no-document job there is nothing to render, so WhatsApp + email are
// triggered directly here (no publicLink, same as before).
async function runOneJob(env, job) {
  const payload = parseJson(job.payload) || {};
  const docType = (job.doc_type || '').toString();
  const year = (job.year || '').toString();
  const recordId = job.record_id || null;

  // Ensure the acting login is on the payload so the WhatsApp "from" (sender) and
  // the audit trail resolve to whoever saved the entry, wherever the message is
  // sent from (here for no-doc jobs, or on the render callback for documents).
  if (!payload['Created By'] && job.created_by) payload['Created By'] = job.created_by;

  // ---- Job WITH a document: dispatch fill+QR+PDF to Render ----
  if (docType && recordId) {
    // 1) Resolve the TEMPLATE bytes on the Worker (Drive + 7-day KV cache). Render
    //    has no D1 and cannot read docx_templates, so the bytes travel in the
    //    dispatch payload. A missing template is not a hard failure: nothing to
    //    render, but the entry was saved — log a warning and still send WhatsApp +
    //    email for a new entry (the browser path degraded the same way).
    let templateRow = null;
    try {
      templateRow = await getDocxTemplate(env, docType, year);
    } catch (e) {
      await logWarn(env, 'collection-queue', 'runOneJob',
        `Template load failed for ${docType} ${year} (job ${job.job_id}): ${e && e.message}`,
        { jobId: job.job_id, docType, year, recordId });
    }
    if (!templateRow || !templateRow.base64) {
      // No template => no document can be generated. The OLD browser path degraded
      // by still queuing WhatsApp/email with a blank link, but that violates the
      // order/no-message-without-document invariant the user made critical ("kuchh
      // tute na"): a new entry would be announced with a receipt that does not
      // exist. So DO NOT send here — FAIL the job (same as the dispatch-failure path
      // below) so it surfaces for retry once the template is uploaded, and no
      // blank-link message ever goes out.
      await logWarn(env, 'collection-queue', 'runOneJob',
        `No ${docType} template for ${year} — no document generated for ${recordId}; failing the job (no message sent).`,
        { jobId: job.job_id, docType, year, recordId });
      throw InternalError(
        `No ${docType} template for ${year}, so no document could be generated for ${recordId}. `
        + `No WhatsApp/email was sent (a message must never go out without a document). `
        + `Upload the template and the job will retry.`
      );
    }

    // 2) Build the fill data SERVER-SIDE from the stored row (audit P0-03: derived,
    //    never client-supplied). QR_CODE is generated on Render inside the fill.
    const fetcher = DOC_DATA_FETCH[docType];
    let placeholders = {};
    if (fetcher) {
      const data = await fetcher(env, job.row_index, year);
      placeholders = { ...(data && data.placeholders ? data.placeholders : {}), GENERATED_AT: new Date().toLocaleString('en-IN') };
    }
    const docNoKey = DOC_NO_KEY[docType];
    const fileName = `${docType}-${(docNoKey && placeholders[docNoKey]) || recordId}.docx`;

    // 3) If Render is not configured, we cannot fill (docxtemplater lives on Render
    //    only, deliberately not in the Worker). The OLD browser path degraded by
    //    still messaging with a blank link, but that breaks the order/no-message-
    //    without-document invariant the user made critical: no document exists, so
    //    nothing may go out. FAIL the job (same as the dispatch-failure path below)
    //    so it surfaces for retry once Render is configured — never send a blank
    //    link. This keeps the invariant intact instead of the old degrade behaviour.
    if (!env.RENDER_SERVICE_URL || !env.RENDER_API_KEY) {
      await logWarn(env, 'collection-queue', 'runOneJob',
        `Render not configured — ${recordId} could not be generated; failing the job (no message sent).`,
        { jobId: job.job_id, recordId });
      throw InternalError(
        `The processing service (Render) is not configured, so no document could be generated for ${recordId}. `
        + `No WhatsApp/email was sent (a message must never go out without a document). `
        + `Configure Render and the job will retry.`
      );
    }

    // 4) Dispatch the docx_render job. The dispatch payload carries the TEMPLATE
    //    bytes + fill data (Render-body-only, NOT stored in D1). The STORED payload
    //    is metadata only: everything the callback needs to write the index and to
    //    send WhatsApp + email in order (see applyDocxRenderResult).
    const { createAndDispatchJob } = await import('./renderJobs.js');
    const dispatch = await createAndDispatchJob(env, 'docx_render', {
      templateBase64: templateRow.base64,
      data: placeholders,
      docType, year, recordId,
      fileName,
    }, {
      refId: recordId,
      createdBy: job.created_by || '',
      storePayload: {
        docType, year, recordId,
        isNewEntry: job.is_new_entry ? 1 : 0,
        collectionJobId: job.job_id,
        notify: payload, // the committed notification snapshot (P0-03), for messaging
      },
    });
    if (!dispatch || !dispatch.success) {
      // Could not reach Render. The document was not generated; surface it so the
      // job is retried by the queue. Do NOT send a message here — a message must
      // never go out before/without the document on the render path.
      throw InternalError(`Could not dispatch the document render for ${recordId}: ${(dispatch && dispatch.message) || 'render dispatch failed'}`);
    }
    // Record the render job id on the collection job for the monitor / retries.
    try {
      await env.DB_MISC.prepare('UPDATE collection_jobs SET public_link = ? WHERE id = ?')
        .bind('', job.id).run();
    } catch (e) { /* non-fatal */ }
    return;
  }

  // ---- Resell / no-document job: nothing to render, message directly ----
  await sendCollectionMessages(env, job, payload, docType, recordId, '');
}

// Triggers WhatsApp then email for a NEW entry, in that exact order, reusing the
// SAME generated PDF link (never regenerated). Email is isolated in its own
// try/catch so an email problem can never fail the job or affect the WhatsApp send.
// Edits never message (the new-entry gate). Shared by the no-document path in
// runOneJob and the render-callback path in applyDocxRenderResult, so the order +
// gate cannot drift between them.
async function sendCollectionMessages(env, job, payload, docType, recordId, publicLink) {
  const isNewEntry = job && (job.is_new_entry === 1 || job.is_new_entry === true || job.is_new_entry === '1');
  if (!isNewEntry) return;

  if (!payload['Created By'] && job && job.created_by) payload['Created By'] = job.created_by;

  // 1) WhatsApp.
  const summary = await triggerCollectionMessages(env, payload, docType || null, recordId, publicLink || '');
  if (summary && summary.groupMessagesSent === 0 && summary.personMessageSent === false) {
    await logWarn(env, 'collection-queue', 'sendCollectionMessages',
      `No WhatsApp message queued for job ${job && job.job_id}.`,
      { jobId: job && job.job_id, recordId, warnings: (summary.warnings || []) });
  }

  // 2) Email (Resend) — same new-entry gate as WhatsApp, reusing the SAME PDF link.
  //    Isolated so an email problem can never fail the job or affect WhatsApp.
  try {
    const emailSummary = await triggerCollectionEmail(env, payload, docType || null, recordId, publicLink || '');
    if (emailSummary && emailSummary.emailSent === false) {
      await logWarn(env, 'collection-queue', 'sendCollectionMessages',
        `No email queued for job ${job && job.job_id}.`,
        { jobId: job && job.job_id, recordId, warnings: (emailSummary.warnings || []) });
    }
  } catch (e) {
    await logWarn(env, 'collection-queue', 'sendCollectionMessages',
      `Email trigger threw for job ${job && job.job_id} (ignored): ${e && e.message}`,
      { jobId: job && job.job_id, recordId });
  }
}

// ---- RENDER CALLBACK side-effect for a completed docx_render job ----
//
// Render filled the template (+QR) and converted it to a PDF, returning the bytes.
// This runs on the Worker's render-webhook callback (via renderJobs.applyResultSideEffect),
// inside the ATOMIC callback claim (audit MGMT-BE-02), so it runs EXACTLY ONCE per job.
//
// It performs the user's required order end-to-end, now that the PDF exists:
//   1. write the PDF to R2 + the generated_files index (applyPdfConvertResult —
//      the SAME binding-only path pdf_convert uses; base64-STRIPPED result), then
//   2. WhatsApp, then 3. email — new-entry-only, email isolated.
//
// `payload` is the STORED (metadata-only) dispatch payload: { docType, year,
// recordId, isNewEntry, notify, collectionJobId }. `result` is Render's
// { pdfBase64, fileName, report }.
export async function applyDocxRenderResult(env, payload, result) {
  const { docType, year, recordId, isNewEntry, notify, collectionJobId } = payload || {};

  // 1) Write R2 + the generated_files index (only the Worker writes R2). Reuses the
  //    pdf_convert side-effect so the trust boundary + base64-stripping are identical.
  const indexed = await applyPdfConvertResult(env, { docType, year, recordId }, result);
  const publicLink = (indexed && indexed.publicLink) || '';

  // THE ORDER/NO-MESSAGE-WITHOUT-DOCUMENT INVARIANT (invariant 1/9). A callback can
  // report status:'completed' yet carry NO usable document: applyPdfConvertResult
  // returns undefined when the Render result is missing pdfBase64/recordId, and
  // { error } when R2 is unconfigured — in BOTH cases nothing was written and there
  // is no publicLink. Sending WhatsApp/email now would announce a receipt that does
  // NOT exist, with a blank link. So a falsy publicLink is a HARD FAILURE: throw with
  // an actionable message. handleRenderCallback catches this, marks the render_jobs
  // row 'failed' with the error (surfacing it for retry), and sends NOTHING —
  // consistent with the failed-dispatch path in runOneJob, which also throws rather
  // than sending a blank-link message. We must NEVER fall through to messaging here.
  if (!publicLink) {
    throw InternalError(
      `docx_render callback for ${recordId || 'unknown record'} produced no stored document `
      + `(no public link from R2/index write), so no WhatsApp/email was sent. `
      + `The job is failed for retry — check the Render result (missing PDF bytes?) and R2 configuration.`
    );
  }

  // Persist the link on the originating collection job for the monitor / retries.
  if (collectionJobId) {
    try {
      await env.DB_MISC.prepare('UPDATE collection_jobs SET public_link = ? WHERE job_id = ?')
        .bind(publicLink, collectionJobId.toString()).run();
    } catch (e) { /* non-fatal */ }
  }

  // 2 + 3) WhatsApp then email — only now that the PDF exists and has a publicLink,
  //        so nothing goes out before the document. New-entry-only, email isolated.
  const jobShim = {
    is_new_entry: isNewEntry ? 1 : 0,
    job_id: collectionJobId || (recordId ? `docx_render:${recordId}` : 'docx_render'),
    created_by: (notify && notify['Created By']) || '',
  };
  await sendCollectionMessages(env, jobShim, notify || {}, docType, recordId, publicLink);

  // Return the base64-STRIPPED result for the render_jobs row / status poll.
  return indexed || { publicLink, fileName: (result && result.fileName) || 'document.pdf' };
}

function safeJson(obj) {
  try { return JSON.stringify(obj); } catch (e) { return '{}'; }
}
function parseJson(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}
