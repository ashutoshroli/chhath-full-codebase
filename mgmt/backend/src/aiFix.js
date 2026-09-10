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
// diffApply (applyUnifiedDiff/pathsInDiff) is no longer used here — the PR-create
// path that applied diffs is offloaded to Render. The CI-retry loop (aiFixCi.js)
// imports diffApply directly, so the module is still in use repo-wide.
import { resolveActiveProvider } from './aiConfig.js';
import { createAndDispatchJob } from './renderJobs.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
// Hard cap on CI-driven retries (spec §5: never an infinite loop).
export const MAX_CI_ATTEMPTS = 3;
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
// The AI *model* config is validated by resolveActiveProvider() at call time
// (default provider -> ANTHROPIC_API_KEY secret -> none). Here we only require
// what the GITHUB side needs, so a run fails early with a clear message.
export function requireConfig(env) {
  if (!env.GITHUB_TOKEN) {
    throw ValidationError('AI fix is not configured: GITHUB_TOKEN secret is missing on the Worker.');
  }
  if (!env.GITHUB_REPO || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO)) {
    throw ValidationError('AI fix is not configured: GITHUB_REPO var must be "owner/repo".');
  }
}
export function model(env) { return (env.AI_FIX_MODEL || DEFAULT_MODEL).toString(); }

// --- GitHub raw file fetch --------------------------------------------------
// Reads a file's content + blob sha from the repo's default branch. Returns null
// (not throwing) for a 404 / blocked path so a missing "related" file never
// aborts the whole run.
export async function githubGetFile(env, path) {
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

// NOTE: extractPaths() used to live here (pull candidate file paths out of a stack
// trace). The generate path that used it is now offloaded to Render, which owns
// that logic (mgmt/server-render/src/jobs/aiFixGenerate.js). Removed here to avoid
// dead code + drift.

// --- Claude call ------------------------------------------------------------
const AI_SYS_PROMPT =
  'You are a senior engineer fixing a production bug in a Cloudflare Workers + React repo. '
  + 'You are given an error and the current content of the relevant file(s). '
  + 'Produce the SMALLEST change that fixes the root cause. '
  + 'Respond with STRICT JSON only, no prose, no markdown fences, exactly: '
  + '{"reasoning": "<=80 words on the root cause and the fix", "diff": "<a valid unified git diff>"}. '
  + 'The diff MUST use repo-relative paths (a/<path> and b/<path>), include correct @@ hunk headers, '
  + 'and touch only what is necessary. Never invent files you were not shown. '
  + 'Never include secrets, credentials, or .env content.';

function buildUserMsg({ errorRow, files, extraContext }) {
  const fileBlocks = files
    .filter(f => f && f.content != null)
    .map(f => `FILE: ${f.path}\n----- BEGIN ${f.path} -----\n${f.content}\n----- END ${f.path} -----`)
    .join('\n\n');
  return `ERROR MESSAGE:\n${errorRow.message || ''}\n\n`
    + `SOURCE: ${errorRow.source || ''}   PAGE: ${errorRow.page || ''}\n\n`
    + `STACK TRACE:\n${(errorRow.stack || '(none)').slice(0, 6000)}\n\n`
    + `CONTEXT:\n${(errorRow.context || '(none)').slice(0, 2000)}\n\n`
    + (extraContext ? `ADDITIONAL CONTEXT (e.g. previous attempt / CI failure):\n${extraContext}\n\n` : '')
    + `RELEVANT FILE(S):\n${fileBlocks || '(no file content could be fetched — infer the fix from the stack trace)'}\n\n`
    + 'Return the STRICT JSON described in the system prompt.';
}

// Parse the strict JSON a model returns, tolerating an accidental markdown fence.
function parseModelJson(text, providerLabel) {
  let parsed;
  try {
    const cleaned = (text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw InternalError('The AI model did not return valid JSON.', `Unparseable output from ${providerLabel}: ${(text || '').slice(0, 300)}`);
  }
  if (!parsed || typeof parsed.diff !== 'string' || !parsed.diff.trim()) {
    throw InternalError('The AI model returned no usable diff.', `No diff from ${providerLabel}: ${(text || '').slice(0, 300)}`);
  }
  return { diff: parsed.diff, reasoning: (parsed.reasoning || '').toString().slice(0, 1000) };
}

// --- Native Anthropic protocol ---------------------------------------------
async function callAnthropic(provider, sys, userMsg) {
  const resp = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: sys,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw InternalError(`Anthropic API call failed (${resp.status})`, `Anthropic ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const usage = data.usage || {};
  return { text, promptTokens: usage.input_tokens || 0, completionTokens: usage.output_tokens || 0 };
}

// --- OpenAI-compatible protocol (OpenAI, OpenRouter, Groq, DeepSeek, Together,
//     Gemini's OpenAI endpoint, local vLLM, ...) --------------------------------
async function callOpenAiCompatible(provider, sys, userMsg) {
  const base = (provider.baseUrl || '').replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw InternalError(`AI API call failed (${resp.status})`, `OpenAI-compatible ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
  const usage = data.usage || {};
  return { text, promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0 };
}

// Ask the ACTIVE provider (default -> ANTHROPIC secret -> none) for a fix.
// Returns { diff, reasoning, promptTokens, completionTokens, model, providerLabel }.
export async function callAiModel(env, { errorRow, files, extraContext }) {
  const provider = await resolveActiveProvider(env);
  if (!provider) {
    throw ValidationError(
      'AI is not configured: add a provider in the AI Management tab, or set the ANTHROPIC_API_KEY secret on the Worker.'
    );
  }
  const userMsg = buildUserMsg({ errorRow, files, extraContext });
  const raw = provider.type === 'openai-compatible'
    ? await callOpenAiCompatible(provider, AI_SYS_PROMPT, userMsg)
    : await callAnthropic(provider, AI_SYS_PROMPT, userMsg);
  const { diff, reasoning } = parseModelJson(raw.text, provider.sourceLabel);
  return {
    diff,
    reasoning,
    promptTokens: raw.promptTokens,
    completionTokens: raw.completionTokens,
    model: provider.model,
    providerLabel: provider.sourceLabel,
  };
}

// Back-compat alias: aiFixCi.js and generateAiFix() call callClaude(); it now
// routes through the active provider (Anthropic remains the fallback).
export const callClaude = callAiModel;

// --- State table helpers ----------------------------------------------------
export function nowIso() { return new Date().toISOString(); }

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

// Generate a fix for an error — now OFFLOADED to the Render service.
//
// Previously this ran the whole context-fetch + Claude call INLINE in the Worker
// (steps A + B), which is exactly the CPU/subrequest-heavy work that can exceed
// the Worker's limits. It now:
//   1. creates the ai_fixes row as 'pending',
//   2. dispatches an `ai_fix_generate` job to Render (passing the error row fields
//      in the payload — Render can't read D1 — and fetching the repo files itself),
//   3. returns the render job id for the frontend to poll (getRenderJobStatus).
// Render calls back on completion and applyRenderFixResult() fills the diff and
// flips the row to 'fix_generated'.
//
// NOTE: the callClaude / gh / githubGetFile / applyUnifiedDiff helpers below are
// NOT removed — the CI-retry loop (aiFixCi.js), which stays in the Worker for now,
// still uses them. Only THIS generate path (and createAiFixPr) stops running the
// heavy work in-Worker; the duplicated compute lives in mgmt/server-render.
export async function generateAiFix(env, errorId, user) {
  requireSuperadmin(user);
  if (!errorId) throw ValidationError('errorId required');
  requireConfig(env);

  const errorRow = await env.DB_LOGS.prepare('SELECT * FROM error_log WHERE error_id = ?').bind(errorId).first();
  if (!errorRow) throw ValidationError('Error record not found.');

  // Create the preview row up front as 'pending' so the UI has something to poll
  // and history is complete even while Render is still working.
  const fixId = randomId('AIF');
  const ts = nowIso();
  await insertFixRow(env, {
    fix_id: fixId,
    error_id: errorId,
    status: 'pending',
    model: model(env),
    diff: '',
    reasoning: '',
    files_json: '[]',
    attempts: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    created_by: (user && user.name) || '',
    created_at: ts,
    updated_at: ts,
  });

  // Dispatch to Render. Only references + the (small) error text travel in the
  // payload — Render fetches the repo files itself.
  const dispatch = await createAndDispatchJob(env, 'ai_fix_generate', {
    errorId,
    fixId,
    errorRow: {
      message: errorRow.message || '',
      stack: errorRow.stack || '',
      context: errorRow.context || '',
      source: errorRow.source || '',
      page: errorRow.page || '',
    },
  }, { refId: fixId, createdBy: (user && user.name) || '' });

  if (!dispatch.success) {
    await updateFixRow(env, fixId, { status: 'failed', error_message: 'Could not dispatch to the processing service.' }).catch(() => {});
    throw ValidationError(dispatch.message || 'Could not start the AI fix. Please try again shortly.');
  }

  return {
    success: true,
    fixId,
    jobId: dispatch.jobId,
    status: 'pending',
    message: 'AI fix generation started. This runs in the background — the preview will appear when it completes.',
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

export async function updateFixRow(env, fixId, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  const set = cols.map(c => `${c} = ?`).join(', ');
  const vals = cols.map(c => fields[c]);
  await env.DB_LOGS.prepare(`UPDATE ai_fixes SET ${set}, updated_at = ? WHERE fix_id = ?`)
    .bind(...vals, nowIso(), fixId).run();
}

// ============================================================================
// GitHub write helpers (PR-2). All go through one small fetch wrapper.
// ============================================================================

export async function gh(env, method, path, body) {
  const url = `https://api.github.com${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'chhath-ai-fix',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await resp.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON */ }
  if (!resp.ok) {
    throw InternalError(
      `GitHub ${method} ${path} failed (${resp.status})`,
      `GitHub ${resp.status}: ${(json && json.message) || text.slice(0, 200)}`
    );
  }
  return json;
}

// btoa for UTF-8 content (Workers' btoa is latin1-only). Encode to bytes first.
export function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ============================================================================
// createAiFixPr — Step D: branch + commit + PR from a stored fix.
// ============================================================================
// Create a branch + commit + PR from a stored fix — now OFFLOADED to Render.
//
// Previously this ran the whole apply-diff + many-GitHub-calls loop INLINE
// (subrequest-count risk in a Worker). It now dispatches an `ai_pr_create` job to
// Render, passing the stored diff + error info in the payload (Render fetches the
// current file content itself and does the branch/commit/PR). Render calls back on
// completion and applyRenderFixResult() records the PR number/url on the row.
export async function createAiFixPr(env, fixId, user) {
  requireSuperadmin(user);
  if (!fixId) throw ValidationError('fixId required');
  requireConfig(env);

  const fix = await env.DB_LOGS.prepare('SELECT * FROM ai_fixes WHERE fix_id = ?').bind(fixId).first();
  if (!fix) throw ValidationError('AI fix not found.');
  if (fix.pr_number) {
    return { success: true, alreadyCreated: true, prNumber: fix.pr_number, prUrl: fix.pr_url, branch: fix.branch };
  }
  if (!fix.diff || !fix.diff.trim()) throw ValidationError('This fix has no diff to apply.');

  const errorRow = await env.DB_LOGS.prepare('SELECT * FROM error_log WHERE error_id = ?').bind(fix.error_id).first();

  const dispatch = await createAndDispatchJob(env, 'ai_pr_create', {
    fixId,
    errorId: fix.error_id,
    diff: fix.diff,
    reasoning: fix.reasoning || '',
    model: fix.model || model(env),
    errorRow: {
      message: (errorRow && errorRow.message) || '',
      source: (errorRow && errorRow.source) || '',
      page: (errorRow && errorRow.page) || '',
      stack: (errorRow && errorRow.stack) || '',
    },
  }, { refId: fixId, createdBy: (user && user.name) || '' });

  if (!dispatch.success) {
    await updateFixRow(env, fixId, { error_message: 'Could not dispatch PR creation to the processing service.' }).catch(() => {});
    throw ValidationError(dispatch.message || 'Could not start PR creation. Please try again shortly.');
  }

  return {
    success: true,
    fixId,
    jobId: dispatch.jobId,
    status: 'pr_pending',
    message: 'PR creation started. This runs in the background — the PR link will appear when it completes.',
  };
}

// ============================================================================
// Render callback side-effects (called by renderJobs.handleRenderCallback)
// ============================================================================
// These reflect a completed/failed Render job onto the ai_fixes row. renderJobs.js
// imports them lazily; keeping them here (next to the schema helpers) means all
// ai_fixes writes stay in one module.
export async function applyRenderFixResult(env, kind, fixId, result) {
  if (!fixId || !result) return;
  if (kind === 'ai_fix_generate') {
    await updateFixRow(env, fixId, {
      status: 'fix_generated',
      diff: (result.diff || '').toString(),
      reasoning: (result.reasoning || '').toString().slice(0, 1000),
      files_json: JSON.stringify(result.files || []),
      model: (result.model || '').toString(),
      prompt_tokens: (result.tokens && result.tokens.prompt) || 0,
      completion_tokens: (result.tokens && result.tokens.completion) || 0,
      error_message: '',
    }).catch(() => {});
  } else if (kind === 'ai_pr_create') {
    await updateFixRow(env, fixId, {
      status: 'pr_created',
      branch: (result.branch || '').toString(),
      pr_number: result.prNumber || null,
      pr_url: (result.prUrl || '').toString(),
      error_message: '',
    }).catch(() => {});
  }
}

export async function applyRenderFixFailure(env, kind, fixId, errorMsg) {
  if (!fixId) return;
  const msg = (errorMsg || 'processing failed').toString().slice(0, 500);
  // A generate failure has no usable preview; a PR-create failure leaves the fix
  // re-tryable (its diff is still valid), so only the error_message changes.
  const fields = kind === 'ai_fix_generate'
    ? { status: 'failed', error_message: msg }
    : { error_message: msg };
  await updateFixRow(env, fixId, fields).catch(() => {});
}
