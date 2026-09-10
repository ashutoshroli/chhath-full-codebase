// GitHub API helpers — ported from the Worker's aiFix.js + diffApply.js so Render
// can read repo files and open a PR itself. Node 18+ has global fetch.

import { config } from '../config.js';
import { isBlockedPath } from './blocklist.js';

const MAX_FILE_BYTES = 200 * 1024; // 200 KB per file of context

// Re-export so existing importers (jobs) can keep importing from github.js.
export { isBlockedPath };

function ghHeaders(withBody) {
  return {
    Authorization: `Bearer ${config.githubToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'chhath-ai-fix-render',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(withBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

// Generic GitHub API call. Throws Error on !ok (message carries status + body).
export async function gh(method, path, body) {
  const resp = await fetch(`https://api.github.com${path}`, {
    method,
    headers: ghHeaders(!!body),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await resp.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON */ }
  if (!resp.ok) {
    throw new Error(`GitHub ${method} ${path} failed (${resp.status}): ${(json && json.message) || text.slice(0, 200)}`);
  }
  return json;
}

// Read a file's content + blob sha from the repo's default branch. Returns null
// for 404 / blocked path so a missing "related" file never aborts the run.
export async function githubGetFile(path) {
  if (isBlockedPath(path)) return null;
  const [owner, repo] = config.githubRepo.split('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  const resp = await fetch(url, { headers: ghHeaders(false) });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`GitHub file fetch failed (${resp.status}) for ${path}: ${body.slice(0, 200)}`);
  }
  const json = await resp.json();
  if (json.size != null && json.size > MAX_FILE_BYTES) {
    return { path, sha: json.sha, content: null, truncated: true };
  }
  let content = '';
  try {
    content = json.content ? Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf8') : '';
  } catch (e) { content = ''; }
  return { path, sha: json.sha, content, truncated: false };
}

// Read a file's content + sha from a SPECIFIC branch (the CI-retry reads the
// current branch state, which already contains the previous fix). Returns null on
// 404 / blocked path. Ported from the Worker's githubGetFileOnBranch.
export async function githubGetFileOnBranch(path, branch) {
  if (isBlockedPath(path)) return null;
  const [owner, repo] = config.githubRepo.split('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`;
  const resp = await fetch(url, { headers: ghHeaders(false) });
  if (!resp.ok) return null;
  const json = await resp.json();
  let content = '';
  try {
    content = json.content ? Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf8') : '';
  } catch (e) { content = ''; }
  return { path, sha: json.sha, content };
}

// Fetch the failing job's log text for a check_suite. Finds a failing check run,
// maps it to its Actions job, and fetches the (302-redirecting) plain-text log,
// keeping the TAIL (failures are at the end) capped for token cost. Ported from
// the Worker's fetchFailedJobLog. Returns { jobName, log }.
export async function fetchFailedJobLog(checkSuiteId) {
  const [owner, repo] = config.githubRepo.split('/');
  const runsResp = await gh('GET', `/repos/${owner}/${repo}/check-suites/${checkSuiteId}/check-runs`);
  const runs = (runsResp && runsResp.check_runs) || [];
  const failing = runs.find(r => r.conclusion && r.conclusion !== 'success' && r.conclusion !== 'neutral' && r.conclusion !== 'skipped');
  if (!failing) return { jobName: '', log: '' };

  // A check_run's id IS the Actions job id for GitHub Actions checks.
  const jobId = failing.id;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`;
  const resp = await fetch(url, { headers: ghHeaders(false), redirect: 'follow' });
  if (!resp.ok) return { jobName: failing.name || '', log: `(could not fetch job log: HTTP ${resp.status})` };
  const full = await resp.text().catch(() => '');
  const tail = full.length > 8000 ? full.slice(-8000) : full;
  return { jobName: failing.name || '', log: tail };
}

// UTF-8 safe base64 (for the Contents API PUT).
export function toBase64Utf8(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}
