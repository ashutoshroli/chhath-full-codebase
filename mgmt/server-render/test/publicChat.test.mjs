// public chatbot — data summary (public-safe + token-bounded), the versioned
// cache (no refetch when the version is unchanged), and the /public-chat guards
// (origin allow-list + per-IP rate limit). fetch is stubbed; no network, no pg.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://mgmt.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';
process.env.PUBLIC_API_BASE ||= 'https://public.test';
process.env.CHAT_ALLOWED_ORIGINS ||= 'https://chhath.shaharpura.com';
process.env.CHAT_RATE_MAX ||= '3';

const { summarizePortalData, getPortalData, _resetCache } = await import('../src/lib/publicData.js');

const SAMPLE = {
  collections: [
    { Year: 2026, Name: 'Ramesh', Amount: 5000 },
    { Year: 2026, Name: 'Suresh', Amount: 3000 },
    { Year: 2025, Name: 'Ramesh', Amount: 2000 },
  ],
  expenses: [{ Year: 2026, Amount: 1000 }],
  loans: [{ Year: 2025, Amount: 10000 }],
  committee: [{ Name: 'President Ji' }, { Name: 'Secretary Ji' }],
};

test('summary is public-safe, compact, and carries the key totals', () => {
  const s = summarizePortalData(SAMPLE, '');
  assert.match(s, /Year 2026: collections ₹8,000/);
  assert.match(s, /expenses ₹1,000/);
  assert.match(s, /net ₹7,000/);
  assert.match(s, /Top contributors 2026:/);
  assert.match(s, /Ramesh/);
  assert.match(s, /Committee members \(2\)/);
  assert.match(s, /Loans on record: 1/);
  // token bound: comfortably small
  assert.ok(s.length < 4000, 'summary must stay compact');
});

test('summary never throws on missing/empty data', () => {
  assert.doesNotThrow(() => summarizePortalData({}, ''));
  assert.doesNotThrow(() => summarizePortalData(null, null));
});

test('per-person lookup: a named contributor gets their own rows in the context', () => {
  const data = {
    collections: [
      { Year: 2026, Name: 'Anil Prasad', Amount: 500 },
      { Year: 2025, Name: 'Anil Prasad', Amount: 300 },
      { Year: 2026, Name: 'Someone Else', Amount: 9000 },
    ],
  };
  const s = summarizePortalData(data, 'Anil Prasad ne abhi tak kitna diya?');
  assert.match(s, /PERSON DETAILS/);
  assert.match(s, /Anil Prasad/);
  assert.match(s, /total ₹800/); // 500 + 300
  // A person NOT named in the question is not force-added as a person-detail block.
  assert.doesNotMatch(s, /Contributions by "Someone Else"/);
});

test('per-person lookup returns nothing when no name matches the question', () => {
  const data = { collections: [{ Year: 2026, Name: 'Anil Prasad', Amount: 500 }] };
  const s = summarizePortalData(data, 'what is the total budget?');
  assert.doesNotMatch(s, /PERSON DETAILS/);
});

test('summary is hard-capped so a huge dataset cannot blow the prompt', () => {
  const many = [];
  for (let i = 0; i < 5000; i++) many.push({ Year: 2026, Name: 'Person ' + i, Amount: i });
  const s = summarizePortalData({ collections: many, committee: many.map(m => ({ Name: m.Name })) }, '');
  assert.ok(s.length <= 6100, 'summary must be capped (~6000 chars) regardless of data size');
});

test('getPortalData reuses the cache when the version is unchanged (no portalData refetch)', async () => {
  _resetCache();
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('dataVersion')) return { ok: true, json: async () => ({ version: 'v1' }) };
    return { ok: true, json: async () => SAMPLE };
  };
  try {
    const a = await getPortalData();
    const b = await getPortalData();
    assert.equal(a.version, 'v1');
    assert.equal(b.version, 'v1');
    const portalFetches = calls.filter(u => u.includes('portalData')).length;
    assert.equal(portalFetches, 1, 'portalData fetched ONCE; second call served from cache');
  } finally { globalThis.fetch = orig; }
});

test('getPortalData refetches when the version bumps', async () => {
  _resetCache();
  let version = 'v1';
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('dataVersion')) return { ok: true, json: async () => ({ version }) };
    return { ok: true, json: async () => SAMPLE };
  };
  try {
    await getPortalData();
    version = 'v2'; // data changed
    await getPortalData();
    const portalFetches = calls.filter(u => u.includes('portalData')).length;
    assert.equal(portalFetches, 2, 'a version bump triggers a fresh portalData fetch');
  } finally { globalThis.fetch = orig; }
});

// ---- /public-chat guards (origin allow-list + per-IP rate limit) ----
// Tested via the framework-free lib/chatGuards.js so no express is needed.
const { isOriginAllowed, rateLimited, clientIpFrom, _resetRate } = await import('../src/lib/chatGuards.js');

test('origin allow-list: only the configured origin is allowed', () => {
  assert.equal(isOriginAllowed('https://chhath.shaharpura.com'), true);
  assert.equal(isOriginAllowed('https://evil.example.com'), false);
  assert.equal(isOriginAllowed(''), false);
});

test('rate limit: a flood past the cap is limited (CHAT_RATE_MAX=3)', () => {
  _resetRate();
  const ip = '203.0.113.9';
  const results = [];
  for (let i = 0; i < 6; i++) results.push(rateLimited(ip));
  // First 3 allowed (false), the rest limited (true).
  assert.deepEqual(results.slice(0, 3), [false, false, false]);
  assert.ok(results.slice(3).some(Boolean), 'requests past the cap are limited');
});

test('rate limit is PER-IP (one flooder does not block others)', () => {
  _resetRate();
  for (let i = 0; i < 6; i++) rateLimited('1.1.1.1'); // flood A
  assert.equal(rateLimited('2.2.2.2'), false, 'a different IP is unaffected');
});

test('rate limit window expires (old hits drop off)', () => {
  _resetRate();
  const ip = '9.9.9.9';
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) rateLimited(ip, t0);      // exceed at t0
  // Far in the future, the window has slid past all old hits.
  assert.equal(rateLimited(ip, t0 + 10 * 60 * 1000), false, 'after the window, the IP is fresh again');
});

test('clientIpFrom prefers the first X-Forwarded-For hop', () => {
  assert.equal(clientIpFrom({ 'x-forwarded-for': '5.5.5.5, 10.0.0.1' }, '10.0.0.9'), '5.5.5.5');
  assert.equal(clientIpFrom({}, '10.0.0.9'), '10.0.0.9');
});
