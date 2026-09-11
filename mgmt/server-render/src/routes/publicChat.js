// POST /public-chat — the public portal AI chatbot.
//
// This is the ONE endpoint the browser calls directly (no shared secret possible
// in a browser), so it carries its OWN guards — a CORS/Origin allow-list and a
// per-IP rate limit — that the internal /jobs routes (secret-gated) do not need.
//
// Flow: origin check -> rate limit -> get public-safe data summary (cached
// versioned portalData) -> resolve public_chat provider (from mgmt Worker, cached)
// -> call the model -> answer. Chat is logged to Neon best-effort (never blocks).

import express from 'express';
import { config } from '../config.js';
import { getPortalData, summarizePortalData } from '../lib/publicData.js';
import { getPublicChatProviders } from '../lib/chatProvider.js';
import { ensureChatSession, logChatMessage, hashIp } from '../lib/neon.js';
import { isOriginAllowed, rateLimited, clientIpFrom } from '../lib/chatGuards.js';

export const publicChatRouter = express.Router();

const MAX_QUESTION_CHARS = 1000;
const MAX_ANSWER_TOKENS = 512;
// 90s: Render has no 30s cap, and a cold/slower model needs headroom. A fast
// instruct model (e.g. meta/llama-3.1-8b-instruct) answers well within this;
// this only prevents a genuinely stuck request from hanging forever.
const MODEL_TIMEOUT_MS = 90000;

function clientIp(req) {
  return clientIpFrom(req.headers, req.ip);
}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (isOriginAllowed(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    return true;
  }
  return false;
}

// Preflight.
publicChatRouter.options('/public-chat', (req, res) => {
  applyCors(req, res);
  res.status(204).end();
});

// ---- model call (anthropic + openai-compatible; mirrors lib/model.js shape) ----
async function callChatModel(provider, systemPrompt, question) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    if (provider.type === 'anthropic') {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: provider.model, max_tokens: MAX_ANSWER_TOKENS, system: systemPrompt,
          messages: [{ role: 'user', content: question }],
        }),
        signal: controller.signal,
      });
      if (!resp.ok) throw chatModelError(`Anthropic HTTP ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`, resp.status);
      const data = await resp.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      const u = data.usage || {};
      return { text, promptTokens: u.input_tokens || 0, completionTokens: u.output_tokens || 0 };
    }
    const base = (provider.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('public_chat provider is missing a base URL');
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.model, max_tokens: MAX_ANSWER_TOKENS,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw chatModelError(`Model HTTP ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`, resp.status);
    const data = await resp.json();
    const text = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
    const u = data.usage || {};
    return { text, promptTokens: u.prompt_tokens || 0, completionTokens: u.completion_tokens || 0 };
  } catch (e) {
    // An AbortError (timeout) is retryable — try the next provider.
    if (e && e.name === 'AbortError') throw chatModelError('model request timed out', 408);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Tag with retryable = rate-limit / gateway / timeout (fall through to next
// provider); a 4xx (bad model/key) is NOT retryable (stops the chain).
function chatModelError(message, status) {
  const e = new Error(message);
  e.retryable = status === 429 || status === 408 || (status >= 500 && status <= 599);
  e.status = status;
  return e;
}

// Try each provider in the chain in order; fall through only on a retryable
// failure. Returns { text, promptTokens, completionTokens, model } or throws.
async function callChatModelChain(providers, systemPrompt, question) {
  let lastErr = null;
  for (let i = 0; i < providers.length; i++) {
    try {
      const out = await callChatModel(providers[i], systemPrompt, question);
      return { ...out, model: providers[i].model };
    } catch (e) {
      lastErr = e;
      if (e && e.retryable && i < providers.length - 1) {
        console.warn(`[public-chat] provider ${i + 1}/${providers.length} failed retryably (${e.status}); trying next.`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('No chat provider produced a result.');
}

publicChatRouter.post('/public-chat', async (req, res) => {
  // 1) Origin allow-list (also sets CORS headers when allowed).
  if (!applyCors(req, res)) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed.' });
  }
  // 2) Rate limit.
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many requests — please wait a moment and try again.' });
  }

  const question = ((req.body && req.body.question) || '').toString().trim();
  const sessionId = ((req.body && req.body.sessionId) || '').toString().slice(0, 80);
  const lang = ((req.body && req.body.lang) || '').toString() === 'hi' ? 'hi' : 'en';
  if (!question) return res.status(400).json({ ok: false, error: 'Please type a question.' });
  if (question.length > MAX_QUESTION_CHARS) return res.status(400).json({ ok: false, error: 'Your question is too long.' });

  try {
    const providers = await getPublicChatProviders();
    if (!providers.length) {
      return res.status(503).json({ ok: false, error: 'The chatbot is not configured yet. Please try again later.' });
    }

    const { version, data } = await getPortalData();
    // Pass the question so a per-person query gets that person's rows in context.
    let summary = summarizePortalData(data, question);
    if (lang === 'hi') summary += '\nReply in simple Hindi (Devanagari) unless the user writes in English.';

    // Try the provider chain in priority order (falls through on 429/5xx/timeout).
    const { text, promptTokens, completionTokens, model } = await callChatModelChain(providers, summary, question);
    const answer = (text || 'Sorry, I could not find an answer.').slice(0, 4000);

    // Best-effort logging to Neon (never blocks / fails the response).
    const ipHash = hashIp(ip);
    ensureChatSession(sessionId, { lang, ipHash, userAgent: req.headers['user-agent'] }).catch(() => {});
    logChatMessage({ sessionId, role: 'user', content: question, dataVersion: version }).catch(() => {});
    logChatMessage({ sessionId, role: 'assistant', content: answer, model, promptTokens, completionTokens, dataVersion: version }).catch(() => {});

    return res.json({ ok: true, answer });
  } catch (err) {
    // Log the full error (message already includes the model's HTTP status + body
    // slice from callChatModel) so a recurring failure is diagnosable in the logs.
    console.error('[public-chat] failed:', (err && err.stack) || err);
    return res.status(502).json({ ok: false, error: 'The chatbot had trouble answering. Please try again.' });
  }
});
