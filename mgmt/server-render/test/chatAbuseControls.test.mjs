// ============ THE PUBLIC CHAT'S LIMITS ACTUALLY LIMIT ============
//
// audit Render/offload #8. `/public-chat` is anonymous, and every request costs money and
// provider quota. It had one guard — a per-IP sliding window — and that guard was keyed on a
// value the caller writes:
//
//     const xff = headers['x-forwarded-for'].split(',')[0].trim();   // the FIRST hop
//
// `X-Forwarded-For` is built by each proxy APPENDING the address it received from, so
// left-hand entries are whatever the caller claimed and only the rightmost were added by
// infrastructure we control. Sending a different value each request therefore makes every
// request a new "IP", and the window never fills:
//
//     curl -H 'X-Forwarded-For: 1.2.3.4' ...    then 1.2.3.5, 1.2.3.6, ...
//
// A limiter keyed on a value the caller chooses is not a limiter.
//
// And the per-IP window answers only "is one caller being greedy". It cannot answer "how much
// can this endpoint cost in total" — 200 IPs each politely inside the window still bought 200
// model calls.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';
process.env.DRIVE_OAUTH_CLIENT_ID ||= 'cid';
process.env.DRIVE_OAUTH_CLIENT_SECRET ||= 'csec';
process.env.DRIVE_OAUTH_REFRESH_TOKEN ||= 'rtok';
process.env.CHAT_MAX_CONCURRENT = '3';
process.env.CHAT_DAILY_TOKEN_BUDGET = '1000';

const {
  clientIpFrom, rateLimited, _resetRate,
  acquireSlot, releaseSlot, _inFlight,
  tokenBudgetExceeded, recordTokens, _tokensUsed, _resetBudget,
} = await import('../src/lib/chatGuards.js');
const { config } = await import('../src/config.js');

beforeEach(() => { _resetRate(); _resetBudget(); });

const xff = (v) => ({ 'x-forwarded-for': v });

describe('the client IP is read from the right, not the left', () => {
  test('with one trusted proxy, the address the proxy observed is used', () => {
    // 'claimed, observed' — the proxy appended the real peer on the right.
    assert.equal(clientIpFrom(xff('1.2.3.4, 203.0.113.9'), 'sock'), '203.0.113.9');
  });

  test('a caller cannot choose its own limiter key', () => {
    // THE bypass. Under the old first-hop read these are three different keys, so three
    // requests look like three visitors. Read from the right, they are all one.
    const seen = new Set([
      clientIpFrom(xff('1.2.3.4, 203.0.113.9'), 'sock'),
      clientIpFrom(xff('9.9.9.9, 203.0.113.9'), 'sock'),
      clientIpFrom(xff('evil, 203.0.113.9'), 'sock'),
    ]);
    assert.equal(seen.size, 1, 'the forged left-hand entries must not change the key');
    assert.deepEqual([...seen], ['203.0.113.9']);
  });

  test('a spoofed header cannot escape the per-IP window', () => {
    // config.chatRateMax + 1 requests, each claiming a different origin IP.
    let limited = false;
    for (let i = 0; i <= config.chatRateMax; i++) {
      const ip = clientIpFrom(xff(`10.0.0.${i}, 203.0.113.9`), 'sock');
      if (rateLimited(ip)) limited = true;
    }
    assert.equal(limited, true, 'the window must fill despite a different forged IP each time');
  });

  test('no header falls back to the socket address', () => {
    assert.equal(clientIpFrom({}, '198.51.100.4'), '198.51.100.4');
    assert.equal(clientIpFrom(xff(''), '198.51.100.4'), '198.51.100.4');
  });

  test('more configured hops read further left, and a bad count fails towards the proxy', () => {
    // With two proxies the real client is one further in.
    const before = config.chatTrustedProxyHops;
    assert.equal(clientIpFrom(xff('claimed, 203.0.113.9'), 'sock'), '203.0.113.9');
    // A hop count larger than the chain cannot read past the start; it clamps to the
    // leftmost, which throttles everyone rather than nobody — the safe direction.
    config.chatTrustedProxyHops = 9;
    try {
      assert.equal(clientIpFrom(xff('a, b, c'), 'sock'), 'a');
    } finally { config.chatTrustedProxyHops = before; }
  });

  test('a single-entry header is used as-is', () => {
    assert.equal(clientIpFrom(xff('203.0.113.9'), 'sock'), '203.0.113.9');
  });
});

describe('there is an absolute ceiling, not just a per-caller one', () => {
  test('concurrency is capped and the cap is released', () => {
    assert.equal(acquireSlot(), true);
    assert.equal(acquireSlot(), true);
    assert.equal(acquireSlot(), true);
    // 200 different IPs each inside the per-IP window would still all get here.
    assert.equal(acquireSlot(), false, `saturated at ${config.chatMaxConcurrent}`);
    releaseSlot();
    assert.equal(acquireSlot(), true, 'a finished request frees its slot');
  });

  test('releasing more than was taken cannot go negative', () => {
    releaseSlot(); releaseSlot();
    assert.equal(_inFlight(), 0);
    assert.equal(acquireSlot(), true);
  });

  test('the daily token budget stops spending', () => {
    assert.equal(tokenBudgetExceeded(), false);
    recordTokens(600, 300);              // 900 of 1000
    assert.equal(tokenBudgetExceeded(), false);
    recordTokens(50, 100);               // 1050
    assert.equal(tokenBudgetExceeded(), true);
  });

  test('the budget resets on the UTC day, by key rather than by timer', () => {
    const day1 = Date.parse('2026-09-15T23:59:00Z');
    const day2 = Date.parse('2026-09-16T00:01:00Z');
    recordTokens(2000, 0, day1);
    assert.equal(tokenBudgetExceeded(day1), true);
    // A process that slept through midnight must still start the new day at zero.
    assert.equal(tokenBudgetExceeded(day2), false);
    assert.equal(_tokensUsed(), 0);
  });

  test('missing or junk token counts do not corrupt the budget', () => {
    recordTokens(undefined, null);
    recordTokens('abc', {});
    assert.equal(_tokensUsed(), 0, 'an unparseable count contributes nothing, not NaN');
    recordTokens('120', '30');
    assert.equal(_tokensUsed(), 150, 'numeric strings still count');
  });
});

describe('the route refuses fast and never leaks a slot', () => {
  const routeSrc = readFileSync(new URL('../src/routes/publicChat.js', import.meta.url), 'utf8');
  // The handler body only — `getPublicChatProviders` also appears in the import list at the
  // top of the file, so slicing from position 0 would find that instead of the call.
  const handler = routeSrc.slice(routeSrc.indexOf("publicChatRouter.post('/public-chat'"));

  test('both ceilings are checked BEFORE any provider work', () => {
    const src = handler;
    const beforeProviders = src.slice(0, src.indexOf('await getPublicChatProviders'));
    assert.match(beforeProviders, /tokenBudgetExceeded\(\)/, 'the budget is checked before a model is called');
    assert.match(beforeProviders, /acquireSlot\(\)/, 'and so is the concurrency slot');
    // Refused, not queued: holding the request open ties up memory and a connection while the
    // caller waits for something already saturated.
    assert.match(src, /503/);
  });

  test('the slot is released in a finally, so an error path cannot saturate the endpoint', () => {
    assert.match(handler, /\}\s*finally\s*\{[\s\S]*releaseSlot\(\)/,
      'a slot leaked on the error path would saturate the endpoint permanently after a few provider failures');
  });

  test('tokens are recorded from the actual answer', () => {
    assert.match(handler, /recordTokens\(promptTokens, completionTokens\)/);
  });

  test('the first-hop read is gone from the guards', () => {
    const src = readFileSync(new URL('../src/lib/chatGuards.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/split\(','\)\[0\]/.test(code), "reading the FIRST X-Forwarded-For hop must be gone");
  });
});
