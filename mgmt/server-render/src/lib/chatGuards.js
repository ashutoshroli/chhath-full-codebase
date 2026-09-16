// Pure, framework-free guards for the public /public-chat endpoint: an Origin
// allow-list and a per-IP sliding-window rate limit. Kept separate from the
// express route so they can be unit-tested without the web framework.

import { config } from '../config.js';

export function allowedOrigins() {
  return config.chatAllowedOrigins.split(',').map(s => s.trim()).filter(Boolean);
}

export function isOriginAllowed(origin) {
  return !!origin && allowedOrigins().includes(origin);
}

// ---- per-IP sliding-window rate limit ----
const hits = new Map(); // ip -> number[] (timestamps within the window)

export function rateLimited(ip, now = Date.now()) {
  const win = config.chatRateWindowMs;
  const arr = (hits.get(ip || '') || []).filter(t => now - t < win);
  arr.push(now);
  hits.set(ip || '', arr);
  // Bound the map so it can't grow forever under churn.
  if (hits.size > 5000) for (const [k, v] of hits) { if (!v.some(t => now - t < win)) hits.delete(k); }
  return arr.length > config.chatRateMax;
}

export function _resetRate() { hits.clear(); }

// ---- Whose IP is it? (audit Render/offload #8) ----
//
// This used to be `x-forwarded-for.split(',')[0]` — the FIRST hop. That entry is written by
// the client. `X-Forwarded-For` is built by each proxy APPENDING the address it received
// from, so the left-hand entries are whatever the caller claimed, and only the rightmost
// ones were added by infrastructure we control.
//
// So the rate limit could be bypassed completely, with no tooling:
//
//     curl -H 'X-Forwarded-For: 1.2.3.4' ...   # then 1.2.3.5, 1.2.3.6, ...
//
// Every request is a different "IP", so the per-IP window never fills. A limiter keyed on a
// value the caller chooses is not a limiter; it is a formality.
//
// Counting from the RIGHT fixes it. With one trusted proxy in front (Render's), the last
// entry is the address that proxy actually observed. `CHAT_TRUSTED_PROXY_HOPS` says how many
// hops to skip if that ever changes; a wrong value fails towards the proxy's own address,
// which throttles everyone rather than nobody — the safe direction for a limiter.
export function clientIpFrom(headers, fallback) {
  const raw = ((headers && headers['x-forwarded-for']) || '').toString();
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!entries.length) return fallback || '';
  const hops = Math.max(1, config.chatTrustedProxyHops);
  // hops=1 -> the last entry, which our proxy appended.
  const idx = entries.length - hops;
  return entries[idx >= 0 ? idx : 0] || fallback || '';
}

// ---- Ceilings, not just a per-IP window (audit Render/offload #8) ----
//
// The per-IP limit answers "is one caller being greedy". It does not answer "how much can
// this endpoint cost in total", and those are different questions: 200 IPs each politely
// inside the per-IP window still bought 200 model calls. The endpoint is anonymous and every
// request spends money and provider quota, so it needs an absolute ceiling too.
//
// Both counters are IN-PROCESS, and that is a real limitation, stated rather than hidden:
// Render can run more than one instance, so the effective ceiling is (instances x limit).
// Making it exact needs a shared store, and the only one this service has is Neon — which
// PR-32 is already opening for the chat retention work, so the shared counter belongs there
// rather than in a second, throwaway mechanism here.

let inFlight = 0;

/** Reserves a concurrency slot, or returns false when the endpoint is already saturated. */
export function acquireSlot() {
  if (inFlight >= config.chatMaxConcurrent) return false;
  inFlight++;
  return true;
}

export function releaseSlot() {
  if (inFlight > 0) inFlight--;
}

export function _inFlight() { return inFlight; }

// A UTC-day token budget. Reset by comparing the day key rather than by a timer, so a
// process that sleeps through midnight still starts the new day at zero.
let tokenDay = '';
let tokensUsed = 0;

const dayKey = (now) => new Date(now).toISOString().slice(0, 10);

/** True when today's token budget is already spent. */
export function tokenBudgetExceeded(now = Date.now()) {
  if (dayKey(now) !== tokenDay) { tokenDay = dayKey(now); tokensUsed = 0; }
  return tokensUsed >= config.chatDailyTokenBudget;
}

/** Records what a completed answer cost. */
export function recordTokens(promptTokens, completionTokens, now = Date.now()) {
  if (dayKey(now) !== tokenDay) { tokenDay = dayKey(now); tokensUsed = 0; }
  tokensUsed += (parseInt(promptTokens, 10) || 0) + (parseInt(completionTokens, 10) || 0);
  return tokensUsed;
}

export function _tokensUsed() { return tokensUsed; }
export function _resetBudget() { tokenDay = ''; tokensUsed = 0; inFlight = 0; }
