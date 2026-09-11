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

test('per-person lookup resolves the ID to a real name and lists their rows', () => {
  // Contribution rows carry the person ID in `Name`; the real name is in `users`.
  const data = {
    users: [
      { ID: 'USER0001', Name: 'Anil Prasad' },
      { ID: 'USER0002', Name: 'Someone Else' },
    ],
    collections: [
      { Year: 2026, Name: 'USER0001', Amount: 500 },
      { Year: 2025, Name: 'USER0001', Amount: 300 },
      { Year: 2026, Name: 'USER0002', Amount: 9000 },
    ],
  };
  // Asking by the REAL name (not the ID) must still match.
  const s = summarizePortalData(data, 'Anil Prasad ne abhi tak kitna diya?');
  assert.match(s, /Contributions by "Anil Prasad"/);
  assert.match(s, /total ₹800/); // 500 + 300
  assert.doesNotMatch(s, /Contributions by "Someone Else"/);
  // The ID must never leak into the human-facing block.
  assert.doesNotMatch(s, /USER0001/);
});

test('top contributors are aggregated PER PERSON (no duplicate rows for the same person)', () => {
  const data = {
    users: [{ ID: 'U1', Name: 'Dhapru Mahto' }, { ID: 'U2', Name: 'Govind Verma' }],
    collections: [
      { Year: 2026, Name: 'U1', Amount: 587 },
      { Year: 2026, Name: 'U1', Amount: 522 }, // same person, 2nd entry
      { Year: 2026, Name: 'U2', Amount: 2100 },
    ],
  };
  const s = summarizePortalData(data, 'top contributors');
  const line = s.split('\n').find(l => l.startsWith('Top contributors 2026:')) || '';
  // Dhapru Mahto appears ONCE with the combined total 587+522 = 1109.
  assert.equal((line.match(/Dhapru Mahto/g) || []).length, 1, 'Dhapru Mahto must appear once');
  assert.match(line, /Dhapru Mahto \(₹1,109\)/);
  assert.match(line, /Govind Verma \(₹2,100\)/);
});

test('per-person block includes a public download link when a generated file exists', () => {
  const data = {
    users: [{ ID: 'U1', Name: 'Amit Kumar' }],
    // __rowIndex ties the collection row to the generated file's record_id.
    collections: [{ Year: 2026, Name: 'U1', Amount: 189, __rowIndex: 42 }],
    generatedFiles: [{ doc_type: 'receipt', year: 2026, record_id: 'receipt-2026-42', public_link: 'https://files.test/amit.pdf' }],
  };
  const s = summarizePortalData(data, 'Amit ke downloadable files ka link');
  assert.match(s, /Contributions by "Amit Kumar"/);
  assert.match(s, /https:\/\/files\.test\/amit\.pdf/);
  assert.match(s, /Download links:/);
});

test('per-person block says no files when none are generated', () => {
  const data = {
    users: [{ ID: 'U1', Name: 'Amit Kumar' }],
    collections: [{ Year: 2026, Name: 'U1', Amount: 189, __rowIndex: 42 }],
    generatedFiles: [],
  };
  const s = summarizePortalData(data, 'Amit ka download link');
  assert.match(s, /No downloadable files are available for this person/);
});

test('committee is listed PER YEAR with real names (IDs resolved), deduped', () => {
  const data = {
    users: [
      { ID: 'USER0001', Name: 'President Ji' },
      { ID: 'USER0136', Name: 'Secretary Ji' },
      { ID: 'USER0137', Name: 'Treasurer Ji' },
    ],
    // committee rows carry the member's ID in `Name`, and a Year.
    committee: [
      { Year: 2026, Name: 'USER0001' },
      { Year: 2026, Name: 'USER0136' },
      { Year: 2026, Name: 'USER0001' }, // duplicate within the year
      { Year: 2025, Name: 'USER0137' },
    ],
  };
  const s = summarizePortalData(data, 'committee members 2026');
  const line2026 = s.split('\n').find(l => l.startsWith('Committee 2026')) || '';
  assert.match(line2026, /President Ji/);
  assert.match(line2026, /Secretary Ji/);
  assert.equal((line2026.match(/President Ji/g) || []).length, 1, 'no duplicate within a year');
  assert.match(line2026, /Committee 2026 \(2 members\)/); // deduped count
  // 2025 is its own line.
  assert.match(s, /Committee 2025 \(1 members\): Treasurer Ji/);
  // IDs must never leak.
  assert.doesNotMatch(s, /USER0001/);
});

test('a single distinctive name word matches (amit -> Amit Kumar)', () => {
  const data = {
    users: [{ ID: 'U9', Name: 'Amit Kumar' }],
    collections: [{ Year: 2026, Name: 'U9', Amount: 189 }],
  };
  const s = summarizePortalData(data, 'amit ka total kitna diya');
  assert.match(s, /Contributions by "Amit Kumar"/);
  assert.match(s, /total ₹189/);
});

test('per-person lookup returns nothing when no name matches the question', () => {
  const data = { users: [{ ID: 'U1', Name: 'Anil Prasad' }], collections: [{ Year: 2026, Name: 'U1', Amount: 500 }] };
  const s = summarizePortalData(data, 'what is the total budget?');
  assert.doesNotMatch(s, /Contributions by "/);
});

test('top contributors also show real names, not IDs', () => {
  const data = {
    users: [{ ID: 'U1', Name: 'Ramesh Verma' }],
    collections: [{ Year: 2026, Name: 'U1', Amount: 5000 }],
  };
  const s = summarizePortalData(data, 'top contributors');
  assert.match(s, /Ramesh Verma/);
  assert.doesNotMatch(s, /Top contributors 2026:.*U1/);
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
