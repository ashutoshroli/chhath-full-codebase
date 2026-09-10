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

import { logError, logErrorAt, logWarn } from './logger.js';
import { reportErrorToWhatsApp } from './errorLog.js';
import { applyUnifiedDiff, pathsInDiff } from './diffApply.js';
import {
  gh, githubGetFile, callClaude, model, nowIso, updateFixRow, toBase64Utf8,
  requireConfig, isBlockedPath, MAX_CI_ATTEMPTS,
} from './aiFix.js';

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

// Fetch the failing job's log text (spec: GET .../actions/jobs/{job_id}/logs).
// The logs endpoint 302-redirects to a plain-text blob; fetch follows it.
async function fetchFailedJobLog(env, owner, repo, checkSuiteId) {
  // 1) list the check runs of the suite, find a failing one, map to its Actions job.
  const runsResp = await gh(env, 'GET', `/repos/${owner}/${repo}/check-suites/${checkSuiteId}/check-runs`);
  const runs = (runsResp && runsResp.check_runs) || [];
  const failing = runs.find(r => r.conclusion && r.conclusion !== 'success' && r.conclusion !== 'neutral' && r.conclusion !== 'skipped');
  if (!failing) return { jobName: '', log: '' };

  // A check_run's id IS the Actions job id for GitHub Actions checks.
  const jobId = failing.id;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'chhath-ai-fix',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });
  if (!resp.ok) return { jobName: failing.name || '', log: `(could not fetch job log: HTTP ${resp.status})` };
  const full = await resp.text().catch(() => '');
  // Keep the TAIL — failures and their stack are at the end. Cap for token cost.
  const tail = full.length > 8000 ? full.slice(-8000) : full;
  return { jobName: failing.name || '', log: tail };
}

// The core retry: re-ask Claude with the failure, apply, push a new commit to the
// SAME branch. Returns { retried:true } or { retried:false, reason }.
async function retryFix(env, fix, failure) {
  const [owner, repo] = env.GITHUB_REPO.split('/');
  const errorRow = await env.DB_LOGS.prepare('SELECT * FROM error_log WHERE error_id = ?').bind(fix.error_id).first();

  // Gather current content of the files the LAST diff touched (they're on the branch now).
  const paths = pathsInDiff(fix.diff).filter(p => !isBlockedPath(p));
  const files = [];
  const shaByPath = {};
  const contentByPath = {};
  for (const p of paths) {
    const f = await githubGetFileOnBranch(env, owner, repo, p, fix.branch);
    if (f && f.content != null) {
      files.push({ path: p, content: f.content, sha: f.sha });
      shaByPath[p] = f.sha; contentByPath[p] = f.content;
    }
  }

  const extraContext =
    `A PREVIOUS AI fix was committed to this branch but CI FAILED.\n\n`
    + `PREVIOUS DIFF THAT WAS APPLIED:\n${fix.diff}\n\n`
    + `CI FAILURE (${failure.jobName}):\n${failure.log}\n\n`
    + `Fix the CI failure. The RELEVANT FILE(S) below already contain the previous fix (current branch state). `
    + `Return a diff AGAINST THAT CURRENT STATE.`;

  let result;
  try {
    result = await callClaude(env, { errorRow: errorRow || { message: '', stack: '', context: '' }, files, extraContext });
  } catch (e) {
    return { retried: false, reason: `Claude retry call failed: ${e && (e.userMessage || e.message)}` };
  }

  const applied = applyUnifiedDiff(result.diff, contentByPath);
  if (!applied.ok) {
    return { retried: false, reason: `retry diff did not apply: ${applied.reason}` };
  }
  // Re-check blocklist and commit to the SAME branch.
  for (const f of applied.files) {
    if (isBlockedPath(f.path)) return { retried: false, reason: `retry touched a protected path: ${f.path}` };
  }
  for (const f of applied.files) {
    if (f.isDelete) {
      if (shaByPath[f.path]) {
        await gh(env, 'DELETE', `/repos/${owner}/${repo}/contents/${f.path}`, {
          message: `fix(ai): retry — remove ${f.path} (attempt ${(fix.attempts || 0) + 1})`,
          sha: shaByPath[f.path], branch: fix.branch,
        });
      }
      continue;
    }
    await gh(env, 'PUT', `/repos/${owner}/${repo}/contents/${f.path}`, {
      message: `fix(ai): retry ${f.path} after CI failure (attempt ${(fix.attempts || 0) + 1})`,
      content: toBase64Utf8(f.content),
      branch: fix.branch,
      ...(shaByPath[f.path] ? { sha: shaByPath[f.path] } : {}),
    });
  }

  // Persist the new diff + accumulated tokens; the push re-triggers CI.
  await updateFixRow(env, fix.fix_id, {
    status: 'ci_running',
    diff: result.diff,
    reasoning: result.reasoning,
    attempts: (fix.attempts || 0) + 1,
    prompt_tokens: (fix.prompt_tokens || 0) + (result.promptTokens || 0),
    completion_tokens: (fix.completion_tokens || 0) + (result.completionTokens || 0),
    error_message: `Retry ${(fix.attempts || 0) + 1}/${MAX_CI_ATTEMPTS} pushed after CI failure.`,
  });
  return { retried: true };
}

// Read a file's content+sha from a SPECIFIC branch (retry reads branch state).
async function githubGetFileOnBranch(env, owner, repo, path, branch) {
  if (isBlockedPath(path)) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'chhath-ai-fix',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  let content = '';
  try { content = json.content ? atob(json.content.replace(/\n/g, '')) : ''; } catch (e) { content = ''; }
  return { path, sha: json.sha, content };
}

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
  const attempts = fix.attempts || 0;
  if (attempts >= MAX_CI_ATTEMPTS) {
    await updateFixRow(env, fix.fix_id, {
      status: 'needs_manual_review',
      error_message: `AI fix failed after ${MAX_CI_ATTEMPTS} attempts — manual review needed. PR left as-is.`,
    });
    await notifyManualReview(env, fix);
    return { ok: true, action: 'gave_up_manual_review' };
  }

  // Fetch the failure log and retry.
  let failure;
  try {
    failure = await fetchFailedJobLog(env, owner, repo, suite.id);
  } catch (e) {
    failure = { jobName: '', log: `(could not fetch CI log: ${e && (e.userMessage || e.message)})` };
  }

  const res = await retryFix(env, fix, failure);
  if (!res.retried) {
    // Couldn't produce/apply a retry — count it as an attempt and, if that was the
    // last one, escalate; otherwise leave it for the next signal.
    const newAttempts = attempts + 1;
    if (newAttempts >= MAX_CI_ATTEMPTS) {
      await updateFixRow(env, fix.fix_id, {
        status: 'needs_manual_review',
        attempts: newAttempts,
        error_message: `AI fix failed after ${MAX_CI_ATTEMPTS} attempts (${res.reason}) — manual review needed.`,
      });
      await notifyManualReview(env, fix);
      return { ok: true, action: 'gave_up_manual_review' };
    }
    await updateFixRow(env, fix.fix_id, {
      status: 'ci_failed',
      attempts: newAttempts,
      error_message: `Retry ${newAttempts}/${MAX_CI_ATTEMPTS} could not be produced: ${res.reason}`,
    });
    return { ok: true, action: 'retry_failed', reason: res.reason };
  }

  return { ok: true, action: 'retried', attempt: (fix.attempts || 0) + 1 };
}
