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
  const { results } = await env.DB_LOGS.prepare('SELECT * FROM ai_providers ORDER BY created_at ASC').all();
  return (results || []).map(providerOut);
}

export async function saveAiProvider(env, req, user) {
  requireSuperadmin(user);
  const name = (req.name || '').toString().trim();
  const type = (req.type || '').toString().trim();
  const baseUrl = (req.baseUrl || '').toString().trim();
  const model = (req.model || '').toString().trim();
  const apiKey = (req.apiKey || '').toString(); // raw key, only present when set/changed

  if (!name) throw ValidationError('A provider name is required.');
  if (!PROVIDER_TYPES.includes(type)) {
    throw ValidationError(`type must be one of: ${PROVIDER_TYPES.join(', ')}.`);
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
    await env.DB_LOGS.prepare(
      'UPDATE ai_providers SET name=?, type=?, base_url=?, model=?, api_key_enc=?, key_hint=?, updated_at=? WHERE provider_id=?'
    ).bind(name, type, baseUrl, model, apiKeyEnc, keyHint, ts, req.providerId).run();
    return { success: true, providerId: req.providerId };
  }
  const providerId = randomId('AIP');
  await env.DB_LOGS.prepare(
    'INSERT INTO ai_providers (provider_id, name, type, base_url, model, api_key_enc, key_hint, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(providerId, name, type, baseUrl, model, apiKeyEnc, keyHint, 0, ts, ts).run();
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
export async function setDefaultAiProvider(env, providerId, user) {
  requireSuperadmin(user);
  const stmts = [env.DB_LOGS.prepare('UPDATE ai_providers SET is_default = 0, updated_at = ?').bind(nowIso())];
  if (providerId) {
    const exists = await env.DB_LOGS.prepare('SELECT provider_id FROM ai_providers WHERE provider_id = ?').bind(providerId).first();
    if (!exists) throw ValidationError('Provider not found.');
    stmts.push(env.DB_LOGS.prepare('UPDATE ai_providers SET is_default = 1, updated_at = ? WHERE provider_id = ?').bind(nowIso(), providerId));
  }
  await env.DB_LOGS.batch(stmts);
  return { success: true, defaultProviderId: providerId || null };
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

// ---- The fallback chain (used by aiFix.js) ---------------------------------
// Resolves the provider to actually call, decrypting the key ONLY here, at call
// time. Order (per spec):
//   1. the configured default provider, if it has a usable key
//   2. else the ANTHROPIC_API_KEY Cloudflare secret (native Anthropic)
//   3. else null  -> caller reports "AI not configured"
// Returns { type, apiKey, baseUrl, model, sourceLabel } or null.
export async function resolveActiveProvider(env) {
  // 1) default provider from the DB
  try {
    const row = await env.DB_LOGS.prepare('SELECT * FROM ai_providers WHERE is_default = 1 LIMIT 1').first();
    if (row && row.api_key_enc) {
      try {
        const apiKey = await decryptSecret(env, row.api_key_enc);
        if (apiKey) {
          return {
            type: row.type,
            apiKey,
            baseUrl: row.base_url || '',
            model: row.model || '',
            sourceLabel: `provider:${row.name}`,
          };
        }
      } catch (e) {
        // Decrypt failed (secret rotated?) — log and fall through to the secret.
        await logWarn(env, 'backend-aiConfig', 'resolveActiveProvider',
          `Default AI provider key could not be decrypted; falling back to ANTHROPIC_API_KEY. ${e && (e.userMessage || e.message)}`,
          { providerId: row.provider_id }).catch(() => {});
      }
    }
  } catch (e) {
    // DB read failed — fall through to the secret.
  }

  // 2) the Cloudflare Anthropic secret (the always-there safety net)
  if (env.ANTHROPIC_API_KEY) {
    return {
      type: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: '',
      model: (env.AI_FIX_MODEL || 'claude-sonnet-4-5-20250929').toString(),
      sourceLabel: 'secret:ANTHROPIC_API_KEY',
    };
  }

  // 3) nothing configured
  return null;
}
