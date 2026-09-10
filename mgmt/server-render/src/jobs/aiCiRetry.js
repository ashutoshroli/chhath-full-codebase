// Job: ai_ci_retry — re-fix a CI failure and push a new commit to the SAME branch.
// Ported from the Worker's aiFixCi.js retryFix() + fetchFailedJobLog(). Render does
// the whole heavy path: fetch the failed CI log itself (no extra Worker
// subrequest), read the current branch state, ask Claude for a corrected diff,
// apply it, and commit each file to the branch (which re-triggers CI). The Worker
// keeps the light D1 orchestration (branch-match, attempt cap, escalation).
//
// payload: {
//   fixId, branch, prevDiff, checkSuiteId, attempts,
//   errorRow: { message, stack, context, source, page }
// }
// returns (as the callback `result`):
//   { committed, newDiff, reasoning, tokens: {prompt, completion}, attempt }

import { config } from '../config.js';
import { gh, githubGetFileOnBranch, fetchFailedJobLog, isBlockedPath, toBase64Utf8 } from '../lib/github.js';
import { callClaude } from '../lib/anthropic.js';
import { applyUnifiedDiff, pathsInDiff } from '../lib/diffApply.js';

export async function runAiCiRetry(payload) {
  const { fixId, branch, prevDiff, checkSuiteId, attempts } = payload || {};
  const errorRow = (payload && payload.errorRow) || { message: '', stack: '', context: '' };
  if (!branch || !prevDiff) throw new Error('ai_ci_retry: payload.branch and payload.prevDiff are required');

  const [owner, repo] = config.githubRepo.split('/');
  const attemptNo = (attempts || 0) + 1;

  // 1) Fetch the failing CI log (Render does this itself).
  let failure = { jobName: '', log: '' };
  if (checkSuiteId) {
    try {
      failure = await fetchFailedJobLog(checkSuiteId);
    } catch (e) {
      failure = { jobName: '', log: `(could not fetch CI log: ${e && e.message})` };
    }
  }

  // 2) Read the CURRENT branch state of the files the previous diff touched.
  const paths = pathsInDiff(prevDiff).filter(p => !isBlockedPath(p));
  const files = [];
  const shaByPath = {};
  const contentByPath = {};
  for (const p of paths) {
    const f = await githubGetFileOnBranch(p, branch);
    if (f && f.content != null) {
      files.push({ path: p, content: f.content });
      shaByPath[p] = f.sha;
      contentByPath[p] = f.content;
    }
  }

  // 3) Ask Claude for a corrected diff against the current branch state.
  const extraContext =
    `A PREVIOUS AI fix was committed to this branch but CI FAILED.\n\n`
    + `PREVIOUS DIFF THAT WAS APPLIED:\n${prevDiff}\n\n`
    + `CI FAILURE (${failure.jobName}):\n${failure.log}\n\n`
    + `Fix the CI failure. The RELEVANT FILE(S) below already contain the previous fix `
    + `(current branch state). Return a diff AGAINST THAT CURRENT STATE.`;

  const result = await callClaude({ errorRow, files, extraContext });

  // 4) Apply strictly.
  const applied = applyUnifiedDiff(result.diff, contentByPath);
  if (!applied.ok) {
    throw new Error(`retry diff did not apply: ${applied.reason}`);
  }
  for (const f of applied.files) {
    if (isBlockedPath(f.path)) throw new Error(`retry touched a protected path: ${f.path}`);
  }

  // 5) Commit each file to the SAME branch (re-triggers CI).
  for (const f of applied.files) {
    if (f.isDelete) {
      if (shaByPath[f.path]) {
        await gh('DELETE', `/repos/${owner}/${repo}/contents/${f.path}`, {
          message: `fix(ai): retry — remove ${f.path} (attempt ${attemptNo})`,
          sha: shaByPath[f.path], branch,
        });
      }
      continue;
    }
    await gh('PUT', `/repos/${owner}/${repo}/contents/${f.path}`, {
      message: `fix(ai): retry ${f.path} after CI failure (attempt ${attemptNo})`,
      content: toBase64Utf8(f.content),
      branch,
      ...(shaByPath[f.path] ? { sha: shaByPath[f.path] } : {}),
    });
  }

  return {
    committed: applied.files.length,
    newDiff: result.diff,
    reasoning: result.reasoning,
    tokens: { prompt: result.promptTokens, completion: result.completionTokens },
    attempt: attemptNo,
  };
}
