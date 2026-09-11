// Fetch (and cache) the PUBLIC-CHAT AI provider from the mgmt Worker.
//
// The provider config + AES-encrypted key live in D1; only the mgmt Worker can
// decrypt them. Render asks for the resolved provider over the Worker's Render-only
// ?render-provider route, authenticated by RENDER_WEBHOOK_SECRET in the
// X-Render-Signature header (the same secret used for the result webhook).
//
// Cached in memory for a short TTL so we don't hit the Worker on every chat — a
// Superadmin changing the provider in AI Management is picked up within the TTL.

import { config } from '../config.js';

let _cache = null; // { provider|null, at }
const TTL_MS = 5 * 60 * 1000; // refresh at most every 5 min

// Derive the mgmt Worker base URL: explicit MGMT_API_BASE, else the origin of
// WORKER_WEBHOOK_URL (which already points at the mgmt Worker).
function mgmtBase() {
  if (config.mgmtApiBase) return config.mgmtApiBase.replace(/\/+$/, '');
  try { return new URL(config.workerWebhookUrl).origin; } catch (e) { return ''; }
}

// Returns { type, apiKey, baseUrl, model } or null (not configured / unreachable).
export async function getPublicChatProvider() {
  if (_cache && (Date.now() - _cache.at) < TTL_MS) return _cache.provider;

  const base = mgmtBase();
  if (!base) return _cache ? _cache.provider : null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${base}/?render-provider=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Signature': config.renderWebhookSecret },
      body: JSON.stringify({ action: 'renderGetPublicChatProvider' }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Worker returned HTTP ${res.status}`);
    const body = await res.json();
    const provider = (body && body.configured && body.provider) ? body.provider : null;
    _cache = { provider, at: Date.now() };
    return provider;
  } catch (e) {
    console.warn('[chatProvider] fetch failed:', e && e.message);
    // Fall back to the last known provider if we have one; else null.
    return _cache ? _cache.provider : null;
  } finally {
    clearTimeout(timer);
  }
}

// For tests.
export function _resetProviderCache() { _cache = null; }
