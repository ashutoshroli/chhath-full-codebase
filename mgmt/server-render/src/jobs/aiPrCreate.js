// Job: ai_pr_create — apply a stored diff and open a PR on GitHub. Ported from the
// Worker's createAiFixPr() (step D). The Worker passes the stored diff + error info
// in the payload; we do the (subrequest-heavy) GitHub work here and return the PR
// details for the Worker to persist via the callback.
//
// payload: { fixId, errorId, diff, reasoning, model, errorRow: { message, source, page, stack } }
// returns (as the callback `result`):
//   { prNumber, prUrl, branch, filesChanged: [path...] }

import { config } from '../config.js';
import { gh, githubGetFile, isBlockedPath, toBase64Utf8 } from '../lib/github.js';
import { checkWritablePath, checkDiffWithinContext, checkBranchName } from '../lib/aiWritePolicy.js';
import { applyUnifiedDiff, pathsInDiff } from '../lib/diffApply.js';

export async function runAiPrCreate(payload) {
  const { fixId, errorId, diff, reasoning, model } = payload || {};
  const errorRow = (payload && payload.errorRow) || {};
  if (!diff || !diff.trim()) throw new Error('ai_pr_create: payload.diff is required');
  if (!errorId) throw new Error('ai_pr_create: payload.errorId is required');

  const [owner, repo] = config.githubRepo.split('/');

  // 1) Which files does the diff touch? Gate every one of them (audit Render/offload #7).
  //
  // This used to be the denylist alone, which fails open: `.github/workflows/*.yml` — code
  // that runs in CI with the repository's secrets — and `package.json` were both writable.
  // `checkWritablePath` is an ALLOWLIST of source roots and extensions, with the old
  // denylist still applied inside them as a second line.
  const paths = pathsInDiff(diff);
  if (!paths.length) throw new Error('The diff does not name any file to change.');
  const writePaths = [];
  for (const p of paths) {
    const verdict = checkWritablePath(p, isBlockedPath);
    if (!verdict.ok) throw new Error(verdict.error);
    writePaths.push(verdict.path);
  }

  // And the containment that does not depend on having listed the dangerous paths
  // correctly: the diff may only touch files the model was SHOWN. Its input includes error
  // text and CI logs, which a third party can influence, so a diff that reaches for a file
  // outside its context set is refused as a whole.
  const contextPaths = (payload && Array.isArray(payload.files)) ? payload.files : null;
  if (contextPaths) {
    const scoped = checkDiffWithinContext(writePaths, contextPaths);
    if (!scoped.ok) throw new Error(scoped.error);
  }

  // 2) Fetch current content + sha for each touched file.
  const contentByPath = {};
  const shaByPath = {};
  for (const p of paths) {
    const f = await githubGetFile(p);
    if (f && f.content != null) { contentByPath[p] = f.content; shaByPath[p] = f.sha; }
    else if (f && f.truncated) throw new Error(`File too large to patch safely: ${p}`);
    // A new-file diff has no current content — applyUnifiedDiff handles isNew.
  }

  // 3) Apply the diff. STRICT — a context mismatch aborts (no bad commit).
  const applied = applyUnifiedDiff(diff, contentByPath);
  if (!applied.ok) {
    throw new Error(
      `The AI diff could not be applied cleanly (${applied.reason}). `
      + 'The file may have changed since the fix was generated — re-generate the fix.'
    );
  }

  // 4) Resolve the default branch + its head commit sha.
  const repoInfo = await gh('GET', `/repos/${owner}/${repo}`);
  const baseBranch = repoInfo.default_branch || 'main';
  const baseRef = await gh('GET', `/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`);
  const baseSha = baseRef.object.sha;

  // 5) Create the fix branch off the base head. If it exists (retry), reuse it.
  const branch = `fix/error-${errorId}`;
  // `branch` is interpolated into `refs/heads/<branch>`, so an unvalidated id could climb
  // out of that namespace. Validated rather than trusted (audit Render/offload #7).
  const branchVerdict = checkBranchName(branch);
  if (!branchVerdict.ok) throw new Error(branchVerdict.error);
  try {
    await gh('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: baseSha });
  } catch (e) {
    if (!/already exists|Reference already exists|422/.test(e.message || '')) throw e;
  }

  // 6) Commit each changed file to the branch via the Contents API.
  let committed = 0;
  for (const f of applied.files) {
    if (f.isDelete) {
      if (shaByPath[f.path]) {
        await gh('DELETE', `/repos/${owner}/${repo}/contents/${f.path}`, {
          message: `fix(ai): remove ${f.path} for error ${errorId}`,
          sha: shaByPath[f.path], branch,
        });
        committed++;
      }
      continue;
    }
    await gh('PUT', `/repos/${owner}/${repo}/contents/${f.path}`, {
      message: `fix(ai): ${f.path} for error ${errorId}`,
      content: toBase64Utf8(f.content),
      branch,
      ...(shaByPath[f.path] ? { sha: shaByPath[f.path] } : {}),
    });
    committed++;
  }
  if (!committed) throw new Error('No files were committed (nothing to change).');

  // 7) Open the PR into the default branch.
  const title = `fix(ai): ${((errorRow.message) || 'error ' + errorId).slice(0, 60)}`;
  const bodyMd =
    `## 🤖 AI-generated fix\n\n`
    + `**Error Ref:** \`${errorId}\`\n`
    + `**Source:** ${errorRow.source || '?'} · **Page:** ${errorRow.page || '-'}\n\n`
    + `### Original error\n\`\`\`\n${(errorRow.message || '').slice(0, 500)}\n\`\`\`\n\n`
    + (errorRow.stack ? `<details><summary>Stack trace</summary>\n\n\`\`\`\n${errorRow.stack.slice(0, 2000)}\n\`\`\`\n</details>\n\n` : '')
    + `### AI reasoning\n${reasoning || '(none)'}\n\n`
    + `### Files changed\n${applied.files.map(f => `- \`${f.path}\`${f.isNew ? ' (new)' : ''}${f.isDelete ? ' (deleted)' : ''}`).join('\n')}\n\n`
    + `---\n_Generated by the Error Log "Fix using AI" tool (model: ${model || config.aiFixModel}). Review before merging._`;

  const pr = await gh('POST', `/repos/${owner}/${repo}/pulls`, {
    title, head: branch, base: baseBranch, body: bodyMd,
  });

  return {
    prNumber: pr.number,
    prUrl: pr.html_url,
    branch,
    filesChanged: applied.files.map(f => f.path),
  };
}
