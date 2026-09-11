import express from 'express';
import { requireRenderApiKey } from '../middleware/auth.js';
import { runAiFixGenerate } from '../jobs/aiFixGenerate.js';
import { runAiPrCreate } from '../jobs/aiPrCreate.js';
import { runAiCiRetry } from '../jobs/aiCiRetry.js';
import { runPdfConvert } from '../jobs/pdfConvert.js';
import { runPdfConvertBatch } from '../jobs/pdfConvertBatch.js';
import { postResult } from '../lib/callback.js';

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

  // Ack fast so the Worker's dispatch fetch returns quickly (no long hold, no
  // Worker timeout). The heavy work continues after the response.
  res.status(202).json({ accepted: true, jobId });

  // Fire-and-forget: run the job, then call back with success or failure.
  (async () => {
    try {
      const result = await handler(payload || {});
      await postResult({ jobId, status: 'completed', result });
    } catch (err) {
      console.error(`[jobs] ${kind} (${jobId}) failed:`, err && err.message);
      await postResult({ jobId, status: 'failed', error: (err && err.message) || 'job failed' });
    }
  })();
});
