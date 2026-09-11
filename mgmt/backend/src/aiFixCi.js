// ============================================================================
// AI auto-fix — PR-3: CI monitoring + auto-retry (webhook-driven).
//
// GitHub POSTs a `check_suite` (completed) event to the Worker's webhook route.
// We match it to an ai_fixes row by branch and:
//   * PASS  -> status 'ci_passed'. Auto-merge only if AUTO_MERGE_ENABLED=true,
//              else leave the PR for manual review ('ready to merge').
//   * FAIL  -> fetch the failed job log, send it back to Claude with the previous
//              diff + original error, apply the new diff, push a NEW commit to the
//              SAME branch (CI re-runs automatically). attempts++, HARD CAP 3.
//              After 3 -> status 'needs_manual_review', WhatsApp-notify Superadmins,
//              leave the PR as-is.
//
// Everything is best-effort and logged; a webhook must never 500 GitHub into
// retry storms, so the route always returns 200 after acknowledging.
// ============================================================================

import { logWarn } from './logger.js';
import { reportErrorToWhatsApp } from './errorLog.js';
import { gh, updateFixRow, MAX_CI_ATTEMPTS, resolveProviderForDispatch } from './aiFix.js';
import { createAndDispatchJob } from './renderJobs.js';

// --- HMAC-SHA256 signature verification (X-Hub-Signature-256) ---------------
// GitHub signs the RAW body with GITHUB_WEBHOOK_SECRET. Verify before trusting.
export async function verifyGithubSignature(env, rawBody, signatureHeader) {
  const secret = env.GITHUB_WEBHOOK_SECRET || '';
  if (!secret) return false;
  const sig = (signatureHeader || '').replace(/^sha256=/, '').trim();
  if (!sig) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const bytes = new Uint8Array(mac);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    // Constant-time-ish compare.
    if (hex.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
  } catch (e) {
    return false;
  }
}

// Notify Superadmins via the existing WhatsApp escalation (reuses the error row).
async function notifyManualReview(env, fix) {
  try {
    if (fix.error_id) await reportErrorToWhatsApp(env, fix.error_id);
  } catch (e) {
    await logWarn(env, 'backend-aiFixCi', 'notifyManualReview',
      `Could not WhatsApp-notify for fix ${fix.fix_id}: ${e && e.message}`, { fixId: fix.fix_id }).catch(() => {});
  }
}

// Merge a PR (only called when AUTO_MERGE_ENABLED=true and CI passed).
async function autoMerge(env, owner, repo, prNumber) {
  return gh(env, 'PUT', `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, { merge_method: 'squash' });
}

// NOTE: the heavy CI-retry work — fetchFailedJobLog(), retryFix() (Claude call +
// apply diff), and githubGetFileOnBranch() — used to live here and run in the
// Worker. It is now OFFLOADED to the Render service (mgmt/server-render/src/jobs/
// aiCiRetry.js), dispatched as an `ai_ci_retry` job below. The Worker keeps only
// the light, D1-bound orchestration: match the branch, cap attempts, handle the
// CI-pass / auto-merge case, and escalate to manual review. Render fetches the CI
// log itself, so there is no extra GitHub subrequest on the Worker.

// ============================================================================
// Webhook entry point — called from index.js for a verified check_suite event.
// `payload` is the parsed JSON body. Returns a small ack object.
// ============================================================================
export async function handleCheckSuiteEvent(env, payload) {
  const suite = payload && payload.check_suite;
  if (!suite || suite.status !== 'completed') return { ok: true, ignored: 'not a completed check_suite' };

  const [owner, repo] = (env.GITHUB_REPO || '/').split('/');
  // Which branch did this suite run on?
  const branch = suite.head_branch || (payload.check_suite && payload.check_suite.head_branch) || '';
  if (!branch || !branch.startsWith('fix/error-')) {
    return { ok: true, ignored: 'not an AI-fix branch' };
  }

  const fix = await env.DB_LOGS.prepare(
    "SELECT * FROM ai_fixes WHERE branch = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(branch).first();
  if (!fix) return { ok: true, ignored: 'no ai_fixes row for branch' };

  const conclusion = suite.conclusion; // success | failure | timed_out | cancelled | ...

  // ---- CI PASSED ----
  if (conclusion === 'success') {
    const autoMergeOn = (env.AUTO_MERGE_ENABLED || '').toString().toLowerCase() === 'true';
    if (autoMergeOn && fix.pr_number) {
      try {
        await autoMerge(env, owner, repo, fix.pr_number);
        await updateFixRow(env, fix.fix_id, { status: 'merged', error_message: '' });
        return { ok: true, action: 'merged' };
      } catch (e) {
        await logWarn(env, 'backend-aiFixCi', 'autoMerge',
          `CI passed but auto-merge failed for PR #${fix.pr_number}: ${e && (e.userMessage || e.message)}`, { fixId: fix.fix_id }).catch(() => {});
        await updateFixRow(env, fix.fix_id, { status: 'ci_passed', error_message: 'CI passed; auto-merge failed — merge manually.' });
        return { ok: true, action: 'ci_passed_merge_failed' };
      }
    }
    await updateFixRow(env, fix.fix_id, { status: 'ci_passed', error_message: 'CI passed — ready to merge (review).' });
    return { ok: true, action: 'ci_passed' };
  }

  // ---- CI still running / neutral — nothing to do ----
  if (conclusion !== 'failure' && conclusion !== 'timed_out' && conclusion !== 'startup_failure') {
    return { ok: true, ignored: `conclusion ${conclusion}` };
  }

  // ---- CI FAILED ----
  // Attempt cap is checked HERE (light, D1) before spending a Render job. Once the
  // cap is hit, escalate to manual review + WhatsApp — no retry is dispatched.
  const attempts = fix.attempts || 0;
  if (attempts >= MAX_CI_ATTEMPTS) {
    await updateFixRow(env, fix.fix_id, {
      status: 'needs_manual_review',
      error_message: `AI fix failed after ${MAX_CI_ATTEMPTS} attempts — manual review needed. PR left as-is.`,
    });
    await notifyManualReview(env, fix);
    return { ok: true, action: 'gave_up_manual_review' };
  }

  // OFFLOAD the retry to Render: it fetches the failed CI log itself, re-asks
  // Claude against the current branch state, applies, and commits to the same
  // branch (re-triggering CI). On the callback, applyRenderFixResult bumps the
  // attempt/tokens (status 'ci_running'); a retry FAILURE callback increments the
  // attempt and escalates to manual review at the cap (see aiFix.applyRenderFixFailure).
  const errorRow = fix.error_id
    ? await env.DB_LOGS.prepare('SELECT * FROM error_log WHERE error_id = ?').bind(fix.error_id).first().catch(() => null)
    : null;
  // Resolve the active AI provider so the CI-retry uses the SAME provider the
  // Superadmin configured (custom / OpenAI-compatible / default Anthropic).
  const provider = await resolveProviderForDispatch(env);
  const dispatch = provider ? await createAndDispatchJob(env, 'ai_ci_retry', {
    fixId: fix.fix_id,
    branch: fix.branch,
    prevDiff: fix.diff,
    checkSuiteId: suite.id,
    attempts,
    provider,
    errorRow: {
      message: (errorRow && errorRow.message) || '',
      stack: (errorRow && errorRow.stack) || '',
      context: (errorRow && errorRow.context) || '',
      source: (errorRow && errorRow.source) || '',
      page: (errorRow && errorRow.page) || '',
    },
  }, { refId: fix.fix_id }) : { success: false };

  if (!dispatch.success) {
    // Could not even reach Render. Count the attempt; escalate at the cap.
    const newAttempts = attempts + 1;
    if (newAttempts >= MAX_CI_ATTEMPTS) {
      await updateFixRow(env, fix.fix_id, {
        status: 'needs_manual_review',
        attempts: newAttempts,
        error_message: `AI fix failed after ${MAX_CI_ATTEMPTS} attempts (could not dispatch retry) — manual review needed.`,
      });
      await notifyManualReview(env, fix);
      return { ok: true, action: 'gave_up_manual_review' };
    }
    await updateFixRow(env, fix.fix_id, {
      status: 'ci_failed',
      attempts: newAttempts,
      error_message: `Retry ${newAttempts}/${MAX_CI_ATTEMPTS} could not be dispatched to the processing service.`,
    });
    return { ok: true, action: 'retry_dispatch_failed' };
  }

  // Mark it in-flight; the Render callback finalizes the row.
  await updateFixRow(env, fix.fix_id, {
    status: 'ci_running',
    error_message: `Retry ${attempts + 1}/${MAX_CI_ATTEMPTS} dispatched to the processing service.`,
  });
  return { ok: true, action: 'retry_dispatched', jobId: dispatch.jobId, attempt: attempts + 1 };
}
