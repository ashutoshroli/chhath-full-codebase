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
import { assertProviderUrlAtUse, allowHostsFromEnv, PROVIDER_FETCH_OPTS } from './providerUrl.js';

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
    throw modelError(`Anthropic API call failed (${resp.status}): ${body.slice(0, 300)}`, resp.status);
  }
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const usage = data.usage || {};
  return { text, promptTokens: usage.input_tokens || 0, completionTokens: usage.output_tokens || 0 };
}

// Tag a model error with whether it is worth FALLING THROUGH to the next provider:
// a rate limit (429) or a server/gateway error (5xx) or a timeout means "this
// provider is busy/down, try the next one". A 4xx (bad model id / key) is NOT
// retryable — falling through would just waste the other providers too.
function modelError(message, status) {
  const e = new Error(message);
  e.retryable = status === 429 || status === 408 || (status >= 500 && status <= 599);
  e.status = status;
  return e;
}

async function callOpenAiCompatible(p, userMsg) {
  if (!p.baseUrl) throw new Error('openai-compatible provider is missing a base URL');
  // audit Render/offload #6. The API key below is handed to whatever host this URL names,
  // from inside this service's network position. Checked at USE time — a provider row
  // saved before the check existed can still hold an internal address — and this copy also
  // RESOLVES the name, which the Worker cannot do (workerd has no DNS resolver). That is
  // what catches a public-looking name whose A record is 127.0.0.1.
  const base = await assertProviderUrlAtUse(p.baseUrl, { allowHosts: allowHostsFromEnv() });
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    // `redirect: 'error'`: otherwise an allowed host can answer `302 Location:
    // http://169.254.169.254/...` and undici follows it WITH the Authorization header.
    ...PROVIDER_FETCH_OPTS,
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
    throw modelError(`AI API call failed (${resp.status}): ${body.slice(0, 300)}`, resp.status);
  }
  const data = await resp.json();
  const text = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
  const usage = data.usage || {};
  return { text, promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0 };
}

// Ask the model for a fix, trying the provider CHAIN in order. Falls through to
// the next provider ONLY on a retryable failure (rate-limit / 5xx / timeout); a
// non-retryable error (bad model id / key) or an unparseable reply stops and
// throws. Accepts either `providers` (the chain) or a single `provider`
// (back-compat). Returns { diff, reasoning, promptTokens, completionTokens, model }.
export async function callModel({ providers, provider, errorRow, files, extraContext }) {
  // Build the ordered list of candidates. If a chain is given, use it; else fall
  // back to the single provider; effectiveProvider() fills env-Anthropic if empty.
  let chain = Array.isArray(providers) && providers.length ? providers : (provider ? [provider] : []);
  if (!chain.length) chain = [null]; // effectiveProvider(null) -> env Anthropic
  const userMsg = buildUserMsg({ errorRow, files, extraContext });

  let lastErr = null;
  for (let i = 0; i < chain.length; i++) {
    const p = effectiveProvider(chain[i]);
    try {
      const raw = p.type === 'openai-compatible'
        ? await callOpenAiCompatible(p, userMsg)
        : await callAnthropic(p, userMsg);
      const { diff, reasoning } = parseModelJson(raw.text, p.label);
      return { diff, reasoning, promptTokens: raw.promptTokens, completionTokens: raw.completionTokens, model: p.model };
    } catch (e) {
      lastErr = e;
      const isLast = i === chain.length - 1;
      // Only fall through on a retryable failure with another provider left.
      if (e && e.retryable && !isLast) {
        console.warn(`[callModel] provider ${i + 1}/${chain.length} (${p.label}) failed retryably (${e.status}); trying next.`);
        continue;
      }
      throw e; // non-retryable, or nothing left to try
    }
  }
  throw lastErr || new Error('No AI provider produced a result.');
}

// Back-compat alias. Older call sites passed { errorRow, files, extraContext }
// with no provider — that still works (falls back to env Anthropic).
export const callClaude = callModel;
