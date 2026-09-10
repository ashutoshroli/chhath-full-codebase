// ============================================================================
// AI auto-fix — PR-1: generate a fix + preview.
//
// Flow implemented here (Steps A–C of the spec):
//   A. Collect context: the error row + the file(s) named in its stack/context,
//      fetched from GitHub (raw content).
//   B. Call Claude to produce a UNIFIED DIFF (never a whole file — keeps tokens
//      and blast radius small) + a short reasoning summary.
//   C. Persist to ai_fixes (status 'fix_generated') and return the diff for the
//      Preview screen. Applying/committing/PR is PR-2; CI retry is PR-3.
//
// Everything is Superadmin-only (enforced by the router via requireSuperadmin).
//
// SAFETY (spec §5):
//   * A path BLOCKLIST guarantees no secret/PII file is ever sent to Claude
//     (.env*, wrangler.toml, *.secret, DB migrations, and any path whose name
//     contains secret/key/token/password). See isBlockedPath().
//   * Token usage (input/output) is recorded on every attempt for cost tracking.
//   * No infinite loops here — this module only does a single generate call.
// ============================================================================

import { requireSuperadmin, ValidationError, InternalError } from './auth.js';
import { randomId } from './random.js';
import { logErrorAt, logWarn } from './logger.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
// Hard ceilings so one run can never send a huge payload to Claude (cost) or
// pull a giant file from GitHub.
const MAX_FILE_BYTES = 200 * 1024;      // 200 KB per file of context
const MAX_CONTEXT_FILES = 4;            // error file + up to 3 related
const MAX_OUTPUT_TOKENS = 4096;

// --- Secret / PII blocklist (spec §5) --------------------------------------
// A file is NEVER sent to Claude if its path matches any of these. Checked on
// EVERY path before it is fetched or included.
const BLOCKED_EXACT = new Set(['wrangler.toml']);
const BLOCKED_NAME_SUBSTRINGS = ['secret', 'key', 'token', 'password', 'credential', '.pem'];
function isBlockedPath(path) {
  const p = (path || '').toString().trim();
  if (!p) return true;
  const lower = p.toLowerCase();
  const base = lower.split('/').pop() || lower;
  // .env, .env.local, .env.production, etc.
  if (/(^|\/)\.env(\.|$)/.test(lower)) return true;
  // wrangler.toml anywhere in the tree.
  if (base === 'wrangler.toml' || BLOCKED_EXACT.has(base)) return true;
  // *.secret
  if (lower.endsWith('.secret')) return true;
  // DB migrations / schema dumps may carry live PII.
  if (/(^|\/)mgmt\/db\/migration\/.*\.sql$/.test(lower)) return true;
  if (/(^|\/)mgmt\/db\/schema\/.*\.sql$/.test(lower)) return true;
  // Anything whose FILE NAME hints at a credential.
  if (BLOCKED_NAME_SUBSTRINGS.some(s => base.includes(s))) return true;
  return false;
}
// Exported for unit tests.
export { isBlockedPath };

// --- Config guards ----------------------------------------------------------
function requireConfig(env) {
  if (!env.ANTHROPIC_API_KEY) {
    throw ValidationError('AI fix is not configured: ANTHROPIC_API_KEY secret is missing on the Worker.');
  }
  if (!env.GITHUB_TOKEN) {
    throw ValidationError('AI fix is not configured: GITHUB_TOKEN secret is missing on the Worker.');
  }
  if (!env.GITHUB_REPO || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO)) {
    throw ValidationError('AI fix is not configured: GITHUB_REPO var must be "owner/repo".');
  }
}
function model(env) { return (env.AI_FIX_MODEL || DEFAULT_MODEL).toString(); }

// --- GitHub raw file fetch --------------------------------------------------
// Reads a file's content + blob sha from the repo's default branch. Returns null
// (not throwing) for a 404 / blocked path so a missing "related" file never
// aborts the whole run.
async function githubGetFile(env, path) {
  if (isBlockedPath(path)) {
    await logWarn(env, 'backend-aiFix', 'githubGetFile',
      `Refused to fetch a blocklisted path for AI context: ${path}`, { path }).catch(() => {});
    return null;
  }
  const [owner, repo] = env.GITHUB_REPO.split('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'chhath-ai-fix',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw InternalError(`GitHub file fetch failed (${resp.status}) for ${path}`, `GitHub ${resp.status}: ${body.slice(0, 200)}`);
  }
  const json = await resp.json();
  if (json.size != null && json.size > MAX_FILE_BYTES) {
    return { path, sha: json.sha, content: null, truncated: true };
  }
  // The contents API returns base64 for files.
  let content = '';
  try {
    content = json.content ? atob(json.content.replace(/\n/g, '')) : '';
  } catch (e) { content = ''; }
  return { path, sha: json.sha, content, truncated: false };
}

// --- Extract candidate file paths from a stack trace / context -------------
// Pulls repo-relative paths like "mgmt/backend/src/loans.js" out of the stack
// and context. Blocklisted paths are dropped here too (defence in depth).
function extractPaths(stack, context) {
  const text = `${stack || ''}\n${context || ''}`;
  const found = new Set();
  // Match paths ending in a source extension, optionally with :line:col.
  const re = /([\w./-]+\.(?:js|jsx|mjs|ts|tsx|json|css|html|sql))(?::\d+(?::\d+)?)?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let p = m[1];
    // Normalise: strip a leading slash and any "src/.../" absolute prefixes that
    // are not repo-relative (best effort — GitHub fetch simply 404s on a wrong one).
    p = p.replace(/^\/+/, '');
    // Skip node_modules and dist.
    if (/node_modules|\/dist\//.test(p)) continue;
    if (isBlockedPath(p)) continue;
    found.add(p);
  }
  return [...found].slice(0, MAX_CONTEXT_FILES);
}

// --- Claude call ------------------------------------------------------------
// Asks for STRICT JSON: { reasoning, diff }. `diff` is a unified diff the PR-2
// step will apply. We instruct Claude to change as little as possible.
async function callClaude(env, { errorRow, files, extraContext }) {
  const sys =
    'You are a senior engineer fixing a production bug in a Cloudflare Workers + React repo. '
    + 'You are given an error and the current content of the relevant file(s). '
    + 'Produce the SMALLEST change that fixes the root cause. '
    + 'Respond with STRICT JSON only, no prose, no markdown fences, exactly: '
    + '{"reasoning": "<=80 words on the root cause and the fix", "diff": "<a valid unified git diff>"}. '
    + 'The diff MUST use repo-relative paths (a/<path> and b/<path>), include correct @@ hunk headers, '
    + 'and touch only what is necessary. Never invent files you were not shown. '
    + 'Never include secrets, credentials, or .env content.';

  const fileBlocks = files
    .filter(f => f && f.content != null)
    .map(f => `FILE: ${f.path}\n----- BEGIN ${f.path} -----\n${f.content}\n----- END ${f.path} -----`)
    .join('\n\n');

  const userMsg =
    `ERROR MESSAGE:\n${errorRow.message || ''}\n\n`
    + `SOURCE: ${errorRow.source || ''}   PAGE: ${errorRow.page || ''}\n\n`
    + `STACK TRACE:\n${(errorRow.stack || '(none)').slice(0, 6000)}\n\n`
    + `CONTEXT:\n${(errorRow.context || '(none)').slice(0, 2000)}\n\n`
    + (extraContext ? `ADDITIONAL CONTEXT (e.g. previous attempt / CI failure):\n${extraContext}\n\n` : '')
    + `RELEVANT FILE(S):\n${fileBlocks || '(no file content could be fetched — infer the fix from the stack trace)'}\n\n`
    + 'Return the STRICT JSON described in the system prompt.';

  const resp = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model(env),
      max_tokens: MAX_OUTPUT_TOKENS,
      system: sys,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw InternalError(`Claude API call failed (${resp.status})`, `Anthropic ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const usage = data.usage || {};
  const promptTokens = usage.input_tokens || 0;
  const completionTokens = usage.output_tokens || 0;

  // Parse the strict JSON. Be tolerant of an accidental markdown fence.
  let parsed;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw InternalError('Claude did not return valid JSON.', `Unparseable Claude output: ${text.slice(0, 300)}`);
  }
  if (!parsed || typeof parsed.diff !== 'string' || !parsed.diff.trim()) {
    throw InternalError('Claude returned no usable diff.', `No diff in Claude output: ${text.slice(0, 300)}`);
  }
  return { diff: parsed.diff, reasoning: (parsed.reasoning || '').toString().slice(0, 1000), promptTokens, completionTokens };
}

// --- State table helpers ----------------------------------------------------
function nowIso() { return new Date().toISOString(); }

async function insertFixRow(env, row) {
  await env.DB_LOGS.prepare(
    `INSERT INTO ai_fixes
      (fix_id, error_id, status, model, diff, reasoning, files_json, branch, pr_number, pr_url,
       attempts, prompt_tokens, completion_tokens, error_message, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.fix_id, row.error_id, row.status, row.model, row.diff || '', row.reasoning || '',
    row.files_json || '[]', row.branch || '', row.pr_number || null, row.pr_url || '',
    row.attempts || 0, row.prompt_tokens || 0, row.completion_tokens || 0,
    row.error_message || '', row.created_by || '', row.created_at, row.updated_at
  ).run();
}

// ============================================================================
// Public actions (wired into index.js)
// ============================================================================

// Generate a fix for an error and store it as a preview (status 'fix_generated').
// Does NOT create a branch/PR — that is a separate confirmed step (PR-2).
export async function generateAiFix(env, errorId, user) {
  requireSuperadmin(user);
  if (!errorId) throw ValidationError('errorId required');
  requireConfig(env);

  const errorRow = await env.DB_LOGS.prepare('SELECT * FROM error_log WHERE error_id = ?').bind(errorId).first();
  if (!errorRow) throw ValidationError('Error record not found.');

  // A — collect context.
  const paths = extractPaths(errorRow.stack, errorRow.context);
  const files = [];
  for (const p of paths) {
    try {
      const f = await githubGetFile(env, p);
      if (f) files.push(f);
    } catch (e) {
      await logWarn(env, 'backend-aiFix', 'generateAiFix',
        `Could not fetch ${p} for context: ${e && e.message}`, { errorId, path: p }).catch(() => {});
    }
  }

  // B — call Claude for a diff.
  let result;
  try {
    result = await callClaude(env, { errorRow, files });
  } catch (err) {
    await logErrorAt(env, 'backend-aiFix', 'generateAiFix', err, { errorId });
    throw err;
  }

  // C — persist the preview.
  const fixId = randomId('AIF');
  const ts = nowIso();
  const filesMeta = files.map(f => ({ path: f.path, sha: f.sha }));
  await insertFixRow(env, {
    fix_id: fixId,
    error_id: errorId,
    status: 'fix_generated',
    model: model(env),
    diff: result.diff,
    reasoning: result.reasoning,
    files_json: JSON.stringify(filesMeta),
    attempts: 0,
    prompt_tokens: result.promptTokens,
    completion_tokens: result.completionTokens,
    created_by: (user && user.name) || '',
    created_at: ts,
    updated_at: ts,
  });

  return {
    success: true,
    fixId,
    status: 'fix_generated',
    diff: result.diff,
    reasoning: result.reasoning,
    files: filesMeta,
    model: model(env),
    tokens: { prompt: result.promptTokens, completion: result.completionTokens },
  };
}

// List AI fix attempts (for a status column / history in the UI). Most-recent first.
export async function getAiFixes(env, user, errorId) {
  requireSuperadmin(user);
  let stmt;
  if (errorId) {
    stmt = env.DB_LOGS.prepare('SELECT * FROM ai_fixes WHERE error_id = ? ORDER BY created_at DESC LIMIT 50').bind(errorId);
  } else {
    stmt = env.DB_LOGS.prepare('SELECT * FROM ai_fixes ORDER BY created_at DESC LIMIT 100');
  }
  const { results } = await stmt.all();
  return results || [];
}

// Fetch one fix row (for the Preview screen refresh / PR-2 confirm step).
export async function getAiFix(env, user, fixId) {
  requireSuperadmin(user);
  if (!fixId) throw ValidationError('fixId required');
  const row = await env.DB_LOGS.prepare('SELECT * FROM ai_fixes WHERE fix_id = ?').bind(fixId).first();
  if (!row) throw ValidationError('AI fix not found.');
  return row;
}
