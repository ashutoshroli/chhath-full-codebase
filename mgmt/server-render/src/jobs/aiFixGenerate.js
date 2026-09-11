// Job: ai_fix_generate — collect context files from GitHub, ask Claude for a diff.
// Ported from the Worker's generateAiFix() (steps A + B). The Worker owns the DB;
// it passes the error row fields in the payload and persists our result via the
// callback. We only touch GitHub (read) + Anthropic here.
//
// payload: { errorId, errorRow: { message, stack, context, source, page } }
// returns (as the callback `result`):
//   { diff, reasoning, files: [{path, sha}], model, tokens: {prompt, completion} }

import { githubGetFile, isBlockedPath } from '../lib/github.js';
import { callModel } from '../lib/model.js';

const MAX_CONTEXT_FILES = 4;

// Pull repo-relative source paths out of a stack trace / context (ported).
function extractPaths(stack, context) {
  const text = `${stack || ''}\n${context || ''}`;
  const found = new Set();
  const re = /([\w./-]+\.(?:js|jsx|mjs|ts|tsx|json|css|html|sql))(?::\d+(?::\d+)?)?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let p = m[1].replace(/^\/+/, '');
    if (/node_modules|\/dist\//.test(p)) continue;
    if (isBlockedPath(p)) continue;
    found.add(p);
  }
  return [...found].slice(0, MAX_CONTEXT_FILES);
}

export async function runAiFixGenerate(payload) {
  const errorRow = (payload && payload.errorRow) || {};
  if (!errorRow.message && !errorRow.stack) {
    throw new Error('ai_fix_generate: payload.errorRow (message/stack) is required');
  }

  // A — collect context files from GitHub.
  const paths = extractPaths(errorRow.stack, errorRow.context);
  const files = [];
  for (const p of paths) {
    try {
      const f = await githubGetFile(p);
      if (f) files.push(f);
    } catch (e) {
      // A missing/failed "related" file never aborts the whole run.
      console.warn(`[ai_fix_generate] could not fetch ${p}: ${e && e.message}`);
    }
  }

  // B — ask the configured model for a diff (provider comes from the Worker's
  // AI Management config; falls back to this service's env if absent).
  // extraContext carries optional developer guidance the Worker attached for a
  // Re-generate; model.js drops it into the prompt as ADDITIONAL CONTEXT.
  const result = await callModel({
    provider: payload && payload.provider,
    errorRow,
    files,
    extraContext: payload && payload.extraContext,
  });

  return {
    diff: result.diff,
    reasoning: result.reasoning,
    files: files.map(f => ({ path: f.path, sha: f.sha })),
    model: result.model,
    tokens: { prompt: result.promptTokens, completion: result.completionTokens },
  };
}
