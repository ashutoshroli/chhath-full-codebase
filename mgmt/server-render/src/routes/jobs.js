import express from 'express';
import { requireRenderApiKey } from '../middleware/auth.js';
import { runAiFixGenerate } from '../jobs/aiFixGenerate.js';
import { runAiPrCreate } from '../jobs/aiPrCreate.js';
import { runAiCiRetry } from '../jobs/aiCiRetry.js';
import { runPdfConvert } from '../jobs/pdfConvert.js';
import { runPdfConvertBatch } from '../jobs/pdfConvertBatch.js';
import { runProviderTest } from '../jobs/providerTest.js';
import { postResult } from '../lib/callback.js';
import { claim, release, withDeadline } from '../lib/jobClaims.js';
import { config } from '../config.js';

export const jobsRouter = express.Router();

const HANDLERS = {
  ai_fix_generate: runAiFixGenerate,
  ai_pr_create: runAiPrCreate,
  // CI-retry: re-fix a CI failure and push a new commit to the same branch. The
  // Worker still receives the GitHub check_suite webhook and does the light D1
  // orchestration (branch match, attempt cap, escalation); only this heavy retry
  // (log fetch + Claude + commits) runs here.
  ai_ci_retry: runAiCiRetry,
  // Bulk PDF: render a filled .docx to PDF via Google Drive and return the bytes.
  // The Worker does the dedup read + R2 store + generated_files index write.
  pdf_convert: runPdfConvert,
  // Batched bulk PDF: convert up to ~20 docs in one job (sequentially) and return
  // per-record results in one callback. The Worker writes R2 + index per record.
  pdf_convert_batch: runPdfConvertBatch,
  // AI Management "Test": exercise a provider (slow reasoning models exceed the
  // Worker's ~30s cap -> HTTP 524; Render has no such cap).
  provider_test: runProviderTest,
};

// POST /jobs — accept a job, ack 202 IMMEDIATELY, then run it in the background
// and POST the result back to the Worker. Auth: X-Render-Api-Key (401 on mismatch).
jobsRouter.post('/jobs', requireRenderApiKey, (req, res) => {
  const { jobId, kind, payload } = req.body || {};
  if (!jobId || !kind) {
    return res.status(400).json({ success: false, message: 'jobId and kind are required' });
  }
  const handler = HANDLERS[kind];
  if (!handler) {
    return res.status(400).json({ success: false, message: `Unknown job kind: ${kind}` });
  }

  // ---- CLAIM BEFORE RUNNING (audit Render/offload #3, #5) ----
  //
  // This route used to answer 202 and start the work unconditionally. The Worker's reconciler
  // re-dispatches a row stuck in `dispatched` after ten minutes — and "stuck" means "we have
  // not heard back", not "it stopped". A slow Claude call or a large Drive batch is still
  // running, so the redispatch ran the whole job AGAIN alongside the original: for
  // `ai_pr_create`, two GitHub pull requests.
  //
  // #344 fixed the Worker side (the callback claims before applying, and non-reconstructable
  // kinds are not retried at all). The missing half is here: the second dispatch has to
  // recognise the first is in flight and do nothing.
  const verdict = claim(jobId, kind);
  if (!verdict.ok) {
    if (verdict.reason === 'duplicate') {
      // 202, not an error: the Worker asked for this job to run and it IS running (or has just
      // finished). Reporting the existing state is the truthful answer, and a 4xx/5xx here
      // would make the Worker park a job that is perfectly healthy.
      return res.status(202).json({ accepted: true, jobId, duplicate: true, state: verdict.state });
    }
    if (verdict.reason === 'at-capacity') {
      // 503 so the Worker's dispatch fails CLEANLY and it can fall back or retry — which it
      // already knows how to do — rather than this instance accepting more than it can run.
      return res.status(503).json({
        success: false,
        message: 'The processing service is at capacity. Please retry shortly.',
      });
    }
    // No other refusal exists today; answering 503 for an unrecognised one is the safe
    // default, because it makes the Worker retry rather than silently drop the job.
    return res.status(503).json({ success: false, message: 'The processing service cannot take this job right now.' });
  }

  // Ack fast so the Worker's dispatch fetch returns quickly (no long hold, no
  // Worker timeout). The heavy work continues after the response.
  res.status(202).json({ accepted: true, jobId });

  // Fire-and-forget: run the job, then call back with success or failure. Bounded in time, so
  // a provider that never answers cannot hold a slot — or this jobId — forever.
  (async () => {
    try {
      const result = await withDeadline(() => handler(payload || {}), config.jobDeadlineMs, `${kind} (${jobId})`);
      release(jobId, 'completed');
      await postResult({ jobId, status: 'completed', result });
    } catch (err) {
      const message = (err && err.message) || 'job failed';
      console.error(`[jobs] ${kind} (${jobId}) failed:`, (err && err.stack) || err);
      release(jobId, 'failed', message);
      await postResult({ jobId, status: 'failed', error: message });
    }
  })();
});
