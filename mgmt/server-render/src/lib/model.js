// AI model call — supports the SAME multi-provider config the Worker's AI
// Management tab holds. The Worker resolves the active provider (default DB
// provider -> ANTHROPIC_API_KEY secret) and sends it in the job payload as
// `provider = { type, apiKey, baseUrl, model }`. This module uses that provider;
// if none is supplied (older payloads / safety), it falls back to the service's
// own ANTHROPIC_API_KEY env (config).
//
// Two protocols, mirroring the Worker's aiFix.js callAnthropic / callOpenAiCompatible:
//   - 'anthropic'          -> POST https://api.anthropic.com/v1/messages
//   - 'openai-compatible'  -> POST <baseUrl>/chat/completions (Bearer)

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

function parseModelJson(text, label) {
  let parsed;
  try {
    const cleaned = (text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`The AI model (${label}) did not return valid JSON: ${(text || '').slice(0, 300)}`);
  }
  if (!parsed || typeof parsed.diff !== 'string' || !parsed.diff.trim()) {
    throw new Error(`The AI model (${label}) returned no usable diff: ${(text || '').slice(0, 300)}`);
  }
  return { diff: parsed.diff, reasoning: (parsed.reasoning || '').toString().slice(0, 1000) };
}

// Resolve which provider to use: the one the Worker sent, else this service's env.
function effectiveProvider(provider) {
  if (provider && provider.apiKey && provider.type) {
    return {
      type: provider.type,
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl || '',
      model: provider.model || config.aiFixModel,
      label: provider.type === 'openai-compatible' ? `openai-compatible:${provider.model}` : `anthropic:${provider.model}`,
    };
  }
  // Fallback: the service's own Anthropic env.
  return {
    type: 'anthropic',
    apiKey: config.anthropicApiKey,
    baseUrl: '',
    model: config.aiFixModel,
    label: `env-anthropic:${config.aiFixModel}`,
  };
}

async function callAnthropic(p, userMsg) {
  const resp = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: { 'x-api-key': p.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: p.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: AI_SYS_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Anthropic API call failed (${resp.status}): ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const usage = data.usage || {};
  return { text, promptTokens: usage.input_tokens || 0, completionTokens: usage.output_tokens || 0 };
}

async function callOpenAiCompatible(p, userMsg) {
  const base = (p.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('openai-compatible provider is missing a base URL');
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: p.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: AI_SYS_PROMPT },
        { role: 'user', content: userMsg },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`AI API call failed (${resp.status}): ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
  const usage = data.usage || {};
  return { text, promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0 };
}

// Ask the model for a fix. Returns { diff, reasoning, promptTokens, completionTokens, model }.
export async function callModel({ provider, errorRow, files, extraContext }) {
  const p = effectiveProvider(provider);
  const userMsg = buildUserMsg({ errorRow, files, extraContext });
  const raw = p.type === 'openai-compatible'
    ? await callOpenAiCompatible(p, userMsg)
    : await callAnthropic(p, userMsg);
  const { diff, reasoning } = parseModelJson(raw.text, p.label);
  return {
    diff,
    reasoning,
    promptTokens: raw.promptTokens,
    completionTokens: raw.completionTokens,
    model: p.model,
  };
}

// Back-compat alias. Older call sites passed { errorRow, files, extraContext }
// with no provider — that still works (falls back to env Anthropic).
export const callClaude = callModel;
