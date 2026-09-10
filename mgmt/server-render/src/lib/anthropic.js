// Claude (Anthropic) call — ported from the Worker's aiFix.js. Produces a strict
// JSON { reasoning, diff } from an error + the relevant file(s).

import { config } from '../config.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 4096;

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
  const fileBlocks = (files || [])
    .filter(f => f && f.content != null)
    .map(f => `FILE: ${f.path}\n----- BEGIN ${f.path} -----\n${f.content}\n----- END ${f.path} -----`)
    .join('\n\n');
  return `ERROR MESSAGE:\n${errorRow.message || ''}\n\n`
    + `SOURCE: ${errorRow.source || ''}   PAGE: ${errorRow.page || ''}\n\n`
    + `STACK TRACE:\n${(errorRow.stack || '(none)').slice(0, 6000)}\n\n`
    + `CONTEXT:\n${(errorRow.context || '(none)').slice(0, 2000)}\n\n`
    + (extraContext ? `ADDITIONAL CONTEXT:\n${extraContext}\n\n` : '')
    + `RELEVANT FILE(S):\n${fileBlocks || '(no file content could be fetched — infer the fix from the stack trace)'}\n\n`
    + 'Return the STRICT JSON described in the system prompt.';
}

function parseModelJson(text) {
  let parsed;
  try {
    const cleaned = (text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`The AI model did not return valid JSON: ${(text || '').slice(0, 300)}`);
  }
  if (!parsed || typeof parsed.diff !== 'string' || !parsed.diff.trim()) {
    throw new Error(`The AI model returned no usable diff: ${(text || '').slice(0, 300)}`);
  }
  return { diff: parsed.diff, reasoning: (parsed.reasoning || '').toString().slice(0, 1000) };
}

// Ask Claude for a fix. Returns { diff, reasoning, promptTokens, completionTokens, model }.
export async function callClaude({ errorRow, files, extraContext }) {
  const resp = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.aiFixModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: AI_SYS_PROMPT,
      messages: [{ role: 'user', content: buildUserMsg({ errorRow, files, extraContext }) }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Anthropic API call failed (${resp.status}): ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const usage = data.usage || {};
  const { diff, reasoning } = parseModelJson(text);
  return {
    diff,
    reasoning,
    promptTokens: usage.input_tokens || 0,
    completionTokens: usage.output_tokens || 0,
    model: config.aiFixModel,
  };
}
