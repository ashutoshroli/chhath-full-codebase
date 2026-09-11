// ============================================================================
// AI provider management (Superadmin-only).
//
// Lets a Superadmin store MULTIPLE AI providers (each with its own API key, base
// URL and model) and pick a DEFAULT. The AI-fix engine uses the default; if none
// is set / it's unusable, it falls back to the ANTHROPIC_API_KEY Cloudflare
// secret; if that's absent too, it reports "AI not configured".
//
// SECURITY (per the agreed spec):
//   * API keys are NEVER stored in plain text. They are encrypted with AES-GCM
//     using a key derived from the AI_CONFIG_SECRET Cloudflare secret, so a DB
//     dump reveals nothing usable.
//   * Decryption happens ONLY inside the backend at the moment an AI request is
//     actually made (resolveActiveProvider / provider test). It is NEVER returned
//     to the frontend and NEVER logged.
//   * List/read endpoints return a MASKED hint (e.g. "sk-…1234") only.
//
//   ⚠️ If AI_CONFIG_SECRET is lost/rotated, previously-encrypted keys can no
//      longer be decrypted and must be re-entered. Keep it backed up securely.
// ============================================================================

import { requireSuperadmin, ValidationError, InternalError } from './auth.js';
import { randomId } from './random.js';
import { logWarn } from './logger.js';

export const PROVIDER_TYPES = ['anthropic', 'openai-compatible'];
// What a provider is used for. 'fix' = the Error Log "Fix using AI" engine (the
// original + default); 'public_chat' = the public portal chatbot. Each purpose
// has its OWN default provider (is_default is scoped by purpose in the code).
export const PROVIDER_PURPOSES = ['fix', 'public_chat'];
const DEFAULT_PURPOSE = 'fix';
function normPurpose(p) { return PROVIDER_PURPOSES.includes(p) ? p : DEFAULT_PURPOSE; }

// How much portal data a public_chat provider sends to the model. Only meaningful
// for the public_chat purpose (ignored for 'fix'). Default 'summary'.
export const PROVIDER_DATA_MODES = ['summary', 'full'];
const DEFAULT_DATA_MODE = 'summary';
function normDataMode(m) { return PROVIDER_DATA_MODES.includes(m) ? m : DEFAULT_DATA_MODE; }

// ---- AES-GCM helpers -------------------------------------------------------
async function aesKey(env) {
  const secret = env.AI_CONFIG_SECRET;
  if (!secret) {
    throw ValidationError(
      'Cannot store an API key: the AI_CONFIG_SECRET Cloudflare secret is not set. '
      + 'Run `wrangler secret put AI_CONFIG_SECRET` (any strong random string) first.'
    );
  }
  // Derive a 256-bit key from the secret via SHA-256 (stable, no salt needed —
  // the secret itself is the entropy, and this is symmetric at-rest encryption).
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function b64(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}
function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Returns a compact "v1:<iv_b64>:<cipher_b64>" string.
export async function encryptSecret(env, plain) {
  const key = await aesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

// Decrypt a "v1:iv:ct" string. Throws if AI_CONFIG_SECRET changed / data corrupt.
export async function decryptSecret(env, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('v1:')) {
    throw InternalError('Stored API key is not in the expected encrypted format.');
  }
  const [, ivB64, ctB64] = stored.split(':');
  const key = await aesKey(env);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, unb64(ctB64));
    return new TextDecoder().decode(pt);
  } catch (e) {
    throw InternalError(
      'Could not decrypt the stored API key.',
      'AES-GCM decrypt failed — AI_CONFIG_SECRET may have changed since the key was saved. Re-enter the key.'
    );
  }
}

// Show only enough to recognise a key, never the key itself.
function maskKey(plainLen) {
  return plainLen > 0 ? '••••••••' : '';
}

// ---- Row <-> API shape -----------------------------------------------------
// NEVER include the encrypted or decrypted key in the outward shape.
function providerOut(r) {
  return {
    provider_id: r.provider_id,
    name: r.name,
    type: r.type,
    base_url: r.base_url || '',
    model: r.model || '',
    purpose: normPurpose(r.purpose),
    data_mode: normDataMode(r.data_mode),
    priority: Number.isFinite(r.priority) ? r.priority : (r.priority != null ? parseInt(r.priority) || 100 : 100),
    is_default: r.is_default === 1 || r.is_default === '1' || r.is_default === true,
    has_key: !!(r.api_key_enc && r.api_key_enc.length),
    key_hint: r.key_hint || '',
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function nowIso() { return new Date().toISOString(); }

// ---- CRUD (all Superadmin-only) --------------------------------------------

export async function getAiProviders(env, user) {
  requireSuperadmin(user);
  // Order by purpose, then by the fallback priority (lower = tried first), so the
  // AI Management list shows each purpose's providers in the order they'll be used.
  const { results } = await env.DB_LOGS.prepare(
    'SELECT * FROM ai_providers ORDER BY purpose ASC, priority ASC, created_at ASC'
  ).all();
  return (results || []).map(providerOut);
}

export async function saveAiProvider(env, req, user) {
  requireSuperadmin(user);
  const name = (req.name || '').toString().trim();
  const type = (req.type || '').toString().trim();
  const baseUrl = (req.baseUrl || '').toString().trim();
  const model = (req.model || '').toString().trim();
  const apiKey = (req.apiKey || '').toString(); // raw key, only present when set/changed
  const purpose = normPurpose((req.purpose || '').toString().trim());
  // How much portal data a public_chat provider sends to the model. Accept either
  // camelCase (dataMode) or snake_case (data_mode) from the client. Only meaningful
  // for the public_chat purpose; harmless for 'fix'. Defaults to 'summary'.
  const dataMode = normDataMode((req.dataMode || req.data_mode || '').toString().trim());

  if (!name) throw ValidationError('A provider name is required.');
  if (!PROVIDER_TYPES.includes(type)) {
    throw ValidationError(`type must be one of: ${PROVIDER_TYPES.join(', ')}.`);
  }
  if (req.purpose && !PROVIDER_PURPOSES.includes((req.purpose || '').toString().trim())) {
    throw ValidationError(`purpose must be one of: ${PROVIDER_PURPOSES.join(', ')}.`);
  }
  if (!model) throw ValidationError('A model is required.');
  if (type === 'openai-compatible' && !/^https?:\/\//.test(baseUrl)) {
    throw ValidationError('openai-compatible providers need a base URL like https://api.openai.com/v1');
  }

  const editing = req.providerId
    ? await env.DB_LOGS.prepare('SELECT * FROM ai_providers WHERE provider_id = ?').bind(req.providerId).first()
    : null;
  if (req.providerId && !editing) throw ValidationError('Provider not found.');

  // Key handling: on create a key is required; on edit, an empty apiKey means
  // "keep the existing key". A provided key is encrypted before storage.
  let apiKeyEnc = editing ? editing.api_key_enc : null;
  let keyHint = editing ? editing.key_hint : '';
  if (apiKey) {
    apiKeyEnc = await encryptSecret(env, apiKey);
    // Hint: last 4 chars only, prefixed with a mask. Never the whole key.
    keyHint = maskKey(apiKey.length) + apiKey.slice(-4);
  } else if (!editing) {
    throw ValidationError('An API key is required for a new provider.');
  }

  const ts = nowIso();
  if (editing) {
    // A provider's purpose can change on edit; its priority stays (reorder is a
    // separate action). If the purpose changed, push it to the end of the new
    // purpose's list so it doesn't accidentally jump to the front.
    const purposeChanged = normPurpose(editing.purpose) !== purpose;
    if (purposeChanged) {
      const pr = await nextPriority(env, purpose);
      await env.DB_LOGS.prepare(
        'UPDATE ai_providers SET name=?, type=?, base_url=?, model=?, api_key_enc=?, key_hint=?, purpose=?, data_mode=?, priority=?, updated_at=? WHERE provider_id=?'
      ).bind(name, type, baseUrl, model, apiKeyEnc, keyHint, purpose, dataMode, pr, ts, req.providerId).run();
    } else {
      await env.DB_LOGS.prepare(
        'UPDATE ai_providers SET name=?, type=?, base_url=?, model=?, api_key_enc=?, key_hint=?, purpose=?, data_mode=?, updated_at=? WHERE provider_id=?'
      ).bind(name, type, baseUrl, model, apiKeyEnc, keyHint, purpose, dataMode, ts, req.providerId).run();
    }
    return { success: true, providerId: req.providerId };
  }
  const providerId = randomId('AIP');
  const priority = await nextPriority(env, purpose); // append to the end of the purpose's fallback list
  await env.DB_LOGS.prepare(
    'INSERT INTO ai_providers (provider_id, name, type, base_url, model, api_key_enc, key_hint, purpose, data_mode, priority, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(providerId, name, type, baseUrl, model, apiKeyEnc, keyHint, purpose, dataMode, priority, 0, ts, ts).run();
  return { success: true, providerId };
}

export async function deleteAiProvider(env, providerId, user) {
  requireSuperadmin(user);
  if (!providerId) throw ValidationError('providerId required');
  // Deleting the default is allowed — the fallback chain (default -> ANTHROPIC
  // secret -> "not configured") keeps AI-fix working, so nothing breaks.
  await env.DB_LOGS.prepare('DELETE FROM ai_providers WHERE provider_id = ?').bind(providerId).run();
  return { success: true };
}

// Set (or clear) the default. providerId '' / null clears it -> falls back to the
// ANTHROPIC_API_KEY secret.
// Set (or clear) the default FOR A PURPOSE. Defaults are scoped by purpose, so
// there is one default 'fix' provider and one default 'public_chat' provider —
// setting one never disturbs the other. When providerId is given, its own purpose
// determines which purpose's default is being set (the optional `purpose` arg is
// only used to clear a purpose's default when providerId is empty).
export async function setDefaultAiProvider(env, providerId, user, purposeArg) {
  requireSuperadmin(user);
  let scope;
  if (providerId) {
    const row = await env.DB_LOGS.prepare('SELECT provider_id, purpose FROM ai_providers WHERE provider_id = ?').bind(providerId).first();
    if (!row) throw ValidationError('Provider not found.');
    scope = normPurpose(row.purpose);
  } else {
    scope = normPurpose((purposeArg || '').toString().trim());
  }
  // Clear the default ONLY within this purpose, then set the chosen one (if any).
  const stmts = [env.DB_LOGS.prepare('UPDATE ai_providers SET is_default = 0, updated_at = ? WHERE purpose = ?').bind(nowIso(), scope)];
  if (providerId) {
    stmts.push(env.DB_LOGS.prepare('UPDATE ai_providers SET is_default = 1, updated_at = ? WHERE provider_id = ?').bind(nowIso(), providerId));
  }
  await env.DB_LOGS.batch(stmts);
  return { success: true, defaultProviderId: providerId || null, purpose: scope };
}

// The next priority value for a purpose = one past the current max, so a new
// provider is appended to the END of that purpose's fallback list.
async function nextPriority(env, purpose) {
  const row = await env.DB_LOGS.prepare(
    'SELECT MAX(priority) AS mx FROM ai_providers WHERE purpose = ?'
  ).bind(normPurpose(purpose)).first().catch(() => null);
  const mx = row && Number.isFinite(parseInt(row.mx)) ? parseInt(row.mx) : -1;
  return mx + 1;
}

// Reorder a purpose's providers into an explicit fallback order. `orderedIds` is
// the provider_ids of that purpose, first = highest priority (tried first). Any
// provider of the purpose not listed keeps a lower rank (pushed to the end).
export async function reorderAiProviders(env, purpose, orderedIds, user) {
  requireSuperadmin(user);
  const scope = normPurpose(purpose);
  const ids = Array.isArray(orderedIds) ? orderedIds.filter(Boolean).map(String) : [];
  if (!ids.length) throw ValidationError('orderedIds (a non-empty array) is required.');
  const ts = nowIso();
  const stmts = ids.map((id, i) =>
    env.DB_LOGS.prepare('UPDATE ai_providers SET priority = ?, updated_at = ? WHERE provider_id = ? AND purpose = ?')
      .bind(i, ts, id, scope)
  );
  await env.DB_LOGS.batch(stmts);
  return { success: true, purpose: scope, order: ids };
}

// Test a saved provider from the BACKEND: decrypt its key here, make a tiny
// request, and return success/failure + latency. The key/model detail is never
// returned to the frontend and never logged.
//
// A Superadmin may pass a CUSTOM `prompt` (and optional `maxTokens`) to actually
// exercise the model and read its reply — useful for debugging a provider that
// times out or misbehaves on real prompts. The model's reply text is returned
// (as `reply`) ONLY when a custom prompt was supplied (a deliberate test the
// caller asked for); the default no-prompt ping never returns any body text.
const TEST_PING = 'ping';
const TEST_MAXTOK_DEFAULT = 256;   // custom-prompt default (the bare ping uses 8)
const TEST_MAXTOK_CAP = 1024;      // hard cap so a test can't burn a big response
const TEST_TIMEOUT_MS = 30000;     // abort a slow provider with a clear message
const TEST_REPLY_MAX_CHARS = 2000; // truncate the returned reply for the UI

export async function testAiProvider(env, providerId, user, opts) {
  requireSuperadmin(user);
  if (!providerId) throw ValidationError('providerId required');
  const row = await env.DB_LOGS.prepare('SELECT * FROM ai_providers WHERE provider_id = ?').bind(providerId).first();
  if (!row) throw ValidationError('Provider not found.');
  if (!row.api_key_enc) throw ValidationError('This provider has no API key set.');

  // Normalize the (optional) custom prompt + token budget.
  const rawPrompt = opts && typeof opts.prompt === 'string' ? opts.prompt.trim() : '';
  const hasCustom = rawPrompt.length > 0;
  if (rawPrompt.length > 8000) throw ValidationError('Test prompt is too long (max 8000 characters).');
  const prompt = hasCustom ? rawPrompt : TEST_PING;
  let maxTokens = hasCustom ? TEST_MAXTOK_DEFAULT : 8;
  if (opts && Number.isFinite(opts.maxTokens)) {
    maxTokens = Math.max(1, Math.min(TEST_MAXTOK_CAP, Math.floor(opts.maxTokens)));
  }

  let apiKey;
  try {
    apiKey = await decryptSecret(env, row.api_key_enc);
  } catch (e) {
    return { success: false, ok: false, message: 'Stored key could not be decrypted (AI_CONFIG_SECRET may have changed). Re-enter the key.' };
  }

  // OFFLOAD to Render when it is configured. The Cloudflare Worker caps a request
  // at ~30s, so a slow reasoning model (e.g. NVIDIA NIM DeepSeek) times out with an
  // HTTP 524. Render has no such cap. The decrypted key travels in the job payload
  // (never stored on the job row) exactly like the AI-fix provider dispatch; the
  // client polls getRenderJobStatus(jobId) for the reply. If Render is not
  // configured we fall back to the in-Worker request below (unchanged behaviour).
  if (env.RENDER_SERVICE_URL && env.RENDER_API_KEY) {
    const { createAndDispatchJob } = await import('./renderJobs.js');
    const dispatch = await createAndDispatchJob(
      env, 'provider_test',
      { type: row.type, apiKey, baseUrl: row.base_url || '', model: row.model, prompt, maxTokens }, // -> Render (has the key)
      {
        refId: providerId,
        createdBy: (user && user.name) || '',
        // storePayload is what lands in D1. It DELIBERATELY omits apiKey so the
        // decrypted key is NEVER persisted on the job row — it only ever travels
        // in the outbound Render request body.
        storePayload: { type: row.type, model: row.model, hasPrompt: prompt !== 'ping' },
      }
    );
    if (dispatch.success) {
      return { success: true, dispatched: true, jobId: dispatch.jobId, status: 'pending', via: 'render' };
    }
    // Could not reach Render — fall through to the in-Worker path.
  }

  // Bound the request so a hanging provider (e.g. the observed HTTP 524) fails
  // fast with a readable message instead of hanging the whole call.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  const t0 = Date.now();
  try {
    let resp;
    if (row.type === 'anthropic') {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: row.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
        signal: controller.signal,
      });
    } else {
      const base = (row.base_url || '').replace(/\/+$/, '');
      resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: row.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
        signal: controller.signal,
      });
    }

    if (!resp.ok) {
      const b = await resp.text().catch(() => '');
      const hint = resp.status === 524 || resp.status === 504
        ? ' — the provider took too long to respond (check the base URL / model, or the provider\'s own status).'
        : '';
      return { success: true, ok: false, status: resp.status, message: `HTTP ${resp.status}: ${b.slice(0, 160)}${hint}` };
    }

    const latencyMs = Date.now() - t0;
    // Only read + return the model's reply for an EXPLICIT custom-prompt test.
    if (hasCustom) {
      const reply = await extractReplyText(resp, row.type);
      return {
        success: true, ok: true, latencyMs,
        reply: (reply || '(the provider returned no text)').slice(0, TEST_REPLY_MAX_CHARS),
        message: `Provider responded OK in ${latencyMs} ms.`,
      };
    }
    return { success: true, ok: true, latencyMs, message: 'Provider responded OK.' };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return { success: true, ok: false, message: `Request timed out after ${Math.round(TEST_TIMEOUT_MS / 1000)}s — the provider did not respond (this is what a Cloudflare HTTP 524 usually means).` };
    }
    return { success: true, ok: false, message: `Request failed: ${(e && e.message || 'network error').slice(0, 160)}` };
  } finally {
    clearTimeout(timer);
  }
}

// Pull the assistant's text out of either provider's response shape. Never throws
// (a parse failure just yields ''), so a successful HTTP call is never reported as
// a failure just because the body was shaped unexpectedly.
async function extractReplyText(resp, type) {
  try {
    const data = await resp.json();
    if (type === 'anthropic') {
      const parts = Array.isArray(data && data.content) ? data.content : [];
      return parts.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
    }
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const msg = choice && choice.message;
    if (msg && typeof msg.content === 'string') return msg.content.trim();
    // Some openai-compatible servers return content as an array of parts.
    if (msg && Array.isArray(msg.content)) {
      return msg.content.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
    }
    return '';
  } catch (e) {
    return '';
  }
}

// ---- The fallback CHAIN (used by aiFix.js + the public chatbot) ------------
// Resolves the ORDERED list of providers to try FOR A PURPOSE, decrypting each
// key ONLY here, at call time. `purpose` is 'fix' (default) or 'public_chat'.
// Order: the purpose's providers by `priority` ASC (lower = tried first). The
// caller tries them in order, falling through to the next on a rate-limit / 5xx /
// timeout (that logic lives in the model callers). For the 'fix' purpose the
// ANTHROPIC_API_KEY Cloudflare secret is appended as a LAST-RESORT entry; the
// public chatbot gets NO secret fallback (it must be configured explicitly, or it
// stays off — a Superadmin decision, not a silent spend of the fix budget).
// Returns an array of { type, apiKey, baseUrl, model, sourceLabel } (may be empty).
export async function resolveProviderChain(env, purpose) {
  const scope = normPurpose(purpose);
  const chain = [];
  try {
    const { results } = await env.DB_LOGS.prepare(
      'SELECT * FROM ai_providers WHERE purpose = ? ORDER BY priority ASC, created_at ASC'
    ).bind(scope).all();
    for (const row of (results || [])) {
      if (!row.api_key_enc) continue;
      try {
        const apiKey = await decryptSecret(env, row.api_key_enc);
        if (apiKey) {
          chain.push({
            type: row.type,
            apiKey,
            baseUrl: row.base_url || '',
            model: row.model || '',
            dataMode: normDataMode(row.data_mode),
            sourceLabel: `provider:${row.name}`,
          });
        }
      } catch (e) {
        // Decrypt failed (secret rotated?) — skip this provider, keep the chain.
        await logWarn(env, 'backend-aiConfig', 'resolveProviderChain',
          `${scope} provider key could not be decrypted; skipping it in the chain. ${e && (e.userMessage || e.message)}`,
          { providerId: row.provider_id }).catch(() => {});
      }
    }
  } catch (e) {
    // DB read failed — fall through to the secret (fix only).
  }

  // LAST-RESORT for the 'fix' purpose only: the Cloudflare Anthropic secret.
  if (scope === 'fix' && env.ANTHROPIC_API_KEY) {
    chain.push({
      type: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: '',
      model: (env.AI_FIX_MODEL || 'claude-sonnet-4-5-20250929').toString(),
      dataMode: 'summary',
      sourceLabel: 'secret:ANTHROPIC_API_KEY',
    });
  }
  return chain;
}

// Back-compat: the single "primary" provider for a purpose = the first of the
// chain. Existing callers that want just one provider keep working unchanged.
// Returns { type, apiKey, baseUrl, model, sourceLabel } or null.
export async function resolveActiveProvider(env, purpose) {
  const chain = await resolveProviderChain(env, purpose);
  return chain.length ? chain[0] : null;
}
