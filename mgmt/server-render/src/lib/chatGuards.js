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

// First X-Forwarded-For hop, else the socket ip.
export function clientIpFrom(headers, fallback) {
  const xff = ((headers && headers['x-forwarded-for']) || '').toString().split(',')[0].trim();
  return xff || fallback || '';
}
