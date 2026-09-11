// Job: provider_test — exercise a saved AI provider and return its reply. This is
// the SAME connectivity/latency test the Worker's AI Management "Test" button runs,
// but offloaded here because slow reasoning models (e.g. NVIDIA NIM DeepSeek) take
// longer than the Cloudflare Worker's ~30s request cap and were failing with an
// HTTP 524. Render has no such cap, so the model gets the time it needs.
//
// The Worker decrypts the provider's key and sends it in the payload (never stored
// on the job row — same pattern as the AI-fix provider dispatch):
//   payload: { type, apiKey, baseUrl, model, prompt, maxTokens }
// returns (as the callback `result`):
//   { ok, status?, latencyMs, reply?, message }
//
// SECURITY: the apiKey is used only for this outbound call and is never returned
// in the result and never logged.

const MAXTOK_CAP = 1024;
const REPLY_MAX_CHARS = 2000;
const TIMEOUT_MS = 110000; // generous: Render has no 30s cap; cover cold reasoning models

function extractReply(data, type) {
  try {
    if (type === 'anthropic') {
      const parts = Array.isArray(data && data.content) ? data.content : [];
      return parts.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
    }
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const msg = choice && choice.message;
    if (msg && typeof msg.content === 'string') return msg.content.trim();
    if (msg && Array.isArray(msg.content)) {
      return msg.content.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
    }
    return '';
  } catch (e) {
    return '';
  }
}

export async function runProviderTest(payload) {
  const { type, apiKey, baseUrl, model } = payload || {};
  if (!apiKey || !type) throw new Error('provider_test: payload.type and payload.apiKey are required');

  const prompt = (payload && typeof payload.prompt === 'string' && payload.prompt.trim())
    ? payload.prompt.trim() : 'ping';
  const hasCustom = prompt !== 'ping';
  let maxTokens = hasCustom ? 256 : 8;
  if (payload && Number.isFinite(payload.maxTokens)) {
    maxTokens = Math.max(1, Math.min(MAXTOK_CAP, Math.floor(payload.maxTokens)));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    let resp;
    if (type === 'anthropic') {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
        signal: controller.signal,
      });
    } else {
      const base = (baseUrl || '').replace(/\/+$/, '');
      if (!base) throw new Error('openai-compatible provider is missing a base URL');
      resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
        signal: controller.signal,
      });
    }

    if (!resp.ok) {
      const b = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, latencyMs: Date.now() - t0, message: `HTTP ${resp.status}: ${b.slice(0, 160)}` };
    }

    const latencyMs = Date.now() - t0;
    if (hasCustom) {
      const data = await resp.json().catch(() => null);
      const reply = extractReply(data, type);
      return {
        ok: true, latencyMs,
        reply: (reply || '(the provider returned no text)').slice(0, REPLY_MAX_CHARS),
        message: `Provider responded OK in ${latencyMs} ms (via Render).`,
      };
    }
    return { ok: true, latencyMs, message: `Provider responded OK in ${latencyMs} ms (via Render).` };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return { ok: false, latencyMs: Date.now() - t0, message: `Request timed out after ${Math.round(TIMEOUT_MS / 1000)}s — the provider did not respond.` };
    }
    return { ok: false, latencyMs: Date.now() - t0, message: `Request failed: ${(e && e.message) || 'network error'}`.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}
