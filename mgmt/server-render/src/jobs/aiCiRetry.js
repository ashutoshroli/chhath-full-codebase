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
import { callModel } from '../lib/model.js';
import { applyUnifiedDiff, pathsInDiff } from '../lib/diffApply.js';
import { checkWritablePath, checkDiffWithinContext } from '../lib/aiWritePolicy.js';

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
  //
  // audit Render/offload #7. This used to be `.filter(p => !isBlockedPath(p))`, which
  // SILENTLY DROPPED a path it did not like — so a previous diff that had touched something
  // protected simply proceeded without it, and nobody was told. A path that is not writable
  // now is a reason to stop, loudly: the previous diff passed the gate when the branch was
  // created, so reaching this state means the gate has changed or the diff was not gated.
  const prevPaths = pathsInDiff(prevDiff);
  const paths = [];
  const refused = [];
  for (const p of prevPaths) {
    const verdict = checkWritablePath(p, isBlockedPath);
    if (verdict.ok) paths.push(verdict.path);
    else refused.push(verdict.error);
  }
  if (refused.length) {
    throw new Error(`ai_ci_retry: the previous diff touches paths that may not be written: ${refused.join('; ')}`);
  }
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

  const result = await callModel({ providers: payload && payload.providers, provider: payload && payload.provider, errorRow, files, extraContext });

  // 4) Apply strictly.
  const applied = applyUnifiedDiff(result.diff, contentByPath);
  if (!applied.ok) {
    throw new Error(`retry diff did not apply: ${applied.reason}`);
  }
  // This is the sharpest prompt-injection surface in the whole system: `failure.log` above
  // is a CI LOG, and a CI log contains whatever the build printed — including text someone
  // else's pull request, test or dependency put there. "Also update
  // .github/workflows/ci.yml" is a plausible sentence to find in build output, and a model
  // cannot tell an instruction from data.
  //
  // So two gates, and the second is the one that holds even if the first has gaps: the
  // corrected diff may only touch the files the PREVIOUS diff touched. Anything the log
  // talked the model into reaching for is, by definition, not in that set.
  const appliedPaths = [];
  for (const f of applied.files) {
    const verdict = checkWritablePath(f.path, isBlockedPath);
    if (!verdict.ok) throw new Error(`retry ${verdict.error}`);
    appliedPaths.push(verdict.path);
  }
  const scoped = checkDiffWithinContext(appliedPaths, paths);
  if (!scoped.ok) throw new Error(`retry ${scoped.error}`);

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
