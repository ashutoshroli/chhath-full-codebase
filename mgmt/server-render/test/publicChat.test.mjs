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

const { summarizePortalData, buildFullContext, buildContextForProvider, getPortalData, _resetCache } = await import('../src/lib/publicData.js');

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

// ---- SUMMARY enriched coverage (expenses/loans/guarantors/resell) ----
// The compact summary now surfaces expense detail by description, loans per year
// with resolved borrower names, guarantors resolved to real names, and resold
// items — all data-driven, cache-only, IDs resolved so no raw code leaks.

test('summary lists expenses per year by description with summed amounts', () => {
  const data = {
    collections: [{ Year: 2026, Name: 'X', Amount: 1 }],
    expenses: [
      { Year: 2026, Amount: 1000, Discription: 'Tent and lighting' },
      { Year: 2026, Amount: 500, Discription: 'Tent and lighting' }, // same desc -> collapses
      { Year: 2026, Amount: 700, Discription: 'Prasad' },
    ],
  };
  const s = summarizePortalData(data, '');
  const line = s.split('\n').find(l => l.startsWith('Expenses 2026:')) || '';
  // Duplicate description collapses to a single summed line item (1000 + 500).
  assert.match(line, /Tent and lighting \(₹1,500\)/);
  assert.match(line, /Prasad \(₹700\)/);
  assert.equal((line.match(/Tent and lighting/g) || []).length, 1, 'description appears once, summed');
});

test('summary lists loans per year with resolved borrower name, amount, interest and tenure (no ID leaks)', () => {
  const data = {
    users: [{ ID: 'USER0002', Name: 'Suresh Gupta' }],
    collections: [{ Year: 2025, Name: 'USER0002', Amount: 1 }],
    loans: [
      { Year: 2025, Name: 'USER0002', Amount: 10000, 'Intrest Rate': '5%', Tenure: '12 months', 'Loan ID': 'L-7' },
    ],
  };
  const s = summarizePortalData(data, '');
  const line = s.split('\n').find(l => l.startsWith('Loans 2025:')) || '';
  assert.match(line, /Suresh Gupta: ₹10,000/);
  assert.match(line, /interest 5%/);
  assert.match(line, /tenure 12 months/);
  assert.match(line, /Loan L-7/);
  // The borrower ID must never leak into the human-facing loan line.
  assert.doesNotMatch(s, /USER0002/);
});

test('summary resolves guarantors to real names ("X guarantees Y"), independent of loans', () => {
  const data = {
    users: [
      { ID: 'USER0001', Name: 'Ramesh Verma' },
      { ID: 'USER0002', Name: 'Suresh Gupta' },
    ],
    loans: [], // guarantors surface even with no loans
    guarantors: [{ Year: 2025, Loaner: 'USER0002', Guarantor: 'USER0001', 'Loan ID': 'L-9' }],
  };
  const s = summarizePortalData(data, '');
  assert.match(s, /Guarantors: Ramesh Verma guarantees Suresh Gupta \(Loan L-9\)/);
  // No raw person-ID codes leak anywhere.
  assert.doesNotMatch(s, /USER000\d/);
});

test('summary lists resold items with their Detail and the person real name', () => {
  const data = {
    users: [{ ID: 'USER0003', Name: 'Anil Prasad' }],
    collections: [
      { Year: 2026, Name: 'USER0003', Amount: 250, Detail: 'Coconut basket', 'Is Resell': 'TRUE' },
      { Year: 2026, Name: 'USER0003', Amount: 500 }, // normal, not resell
    ],
  };
  const s = summarizePortalData(data, '');
  const line = s.split('\n').find(l => l.startsWith('Resold items')) || '';
  assert.match(line, /Coconut basket by Anil Prasad \(2026\) ₹250/);
  // The resell line carries a note that these amounts are already in the year total
  // (so the model does not double-count them on top of the collections total).
  assert.match(line, /already counted in the year's collections total/);
  assert.doesNotMatch(s, /USER0003/);
});

test('an orphan person ID (absent from users) in a loan, guarantor, or resell row is neutral-labelled, never leaked', () => {
  // No `users` entries resolve, so every borrower/guarantor/reseller ID is an
  // orphan. The NEW summary sections must degrade each to the neutral label
  // rather than leaking the raw USER#### code into the prompt.
  const data = {
    users: [], // nothing resolves
    collections: [
      { Year: 2026, Name: 'USER0066', Amount: 100, Detail: 'Coconut basket', 'Is Resell': 'TRUE' },
    ],
    loans: [
      { Year: 2025, Name: 'USER0099', Amount: 5000, 'Intrest Rate': '5%', Tenure: '12m', 'Loan ID': 'L-1' },
    ],
    guarantors: [
      { Year: 2025, Loaner: 'USER0088', Guarantor: 'USER0077', 'Loan ID': 'L-2' },
    ],
  };
  const s = summarizePortalData(data, '');
  // The raw internal code must never reach the prompt from any new section.
  assert.doesNotMatch(s, /USER\d+/);
  // Each new section still emits its row, labelled with the neutral 'unknown member'.
  const loanLine = s.split('\n').find(l => l.startsWith('Loans 2025:')) || '';
  assert.match(loanLine, /unknown member: ₹5,000/);
  const guarantorLine = s.split('\n').find(l => l.startsWith('Guarantors:')) || '';
  assert.match(guarantorLine, /unknown member guarantees unknown member \(Loan L-2\)/);
  const resellLine = s.split('\n').find(l => l.startsWith('Resold items')) || '';
  assert.match(resellLine, /Coconut basket by unknown member \(2026\) ₹100/);
});

test('summary preamble broadens guidance yet keeps the guardrail line', () => {
  const s = summarizePortalData(SAMPLE, '');
  // Broadened coverage guidance is present.
  assert.match(s, /top contributors/i);
  assert.match(s, /committee/i);
  assert.match(s, /guaranteed/i);
  assert.match(s, /resold items/i);
  // The guardrail against over-refusing remains.
  assert.match(s, /Only say you do not have the information if the answer genuinely is not in the data below/);
});

test('summary with the new sections still stays under its char bound on a large dataset', () => {
  const collections = [];
  const expenses = [];
  const loans = [];
  const guarantors = [];
  const users = [];
  for (let i = 0; i < 5000; i++) {
    users.push({ ID: 'USER' + i, Name: 'Person Number ' + i });
    collections.push({ Year: 2026, Name: 'USER' + i, Amount: i, Detail: 'Item ' + i, 'Is Resell': 'TRUE' });
    expenses.push({ Year: 2026, Amount: i, Discription: 'Spend ' + i });
    loans.push({ Year: 2025, Name: 'USER' + i, Amount: i, 'Intrest Rate': '5%', Tenure: '12m', 'Loan ID': 'L' + i });
    guarantors.push({ Year: 2025, Loaner: 'USER' + i, Guarantor: 'USER' + i, 'Loan ID': 'L' + i });
  }
  const s = summarizePortalData({ users, collections, expenses, loans, guarantors }, '');
  assert.ok(s.length <= 6100, 'enriched summary must still be capped (~6000 chars) regardless of data size');
});

// ---- PHASE 1: year-scoped retrieval ----
// When the question names a year that is present in the data, the summary is built
// from ONLY that year's rows so the context stays bounded as years accumulate. A
// no-year (or not-present-year) question falls through to the general aggregated
// path. CACHE-ONLY: no code path added here may call fetch / touch D1.

// A multi-year fixture with a DISTINCTIVE contributor unique to each year, so a
// year-scoped context can be asserted to include the right year and exclude an
// unrelated year's individual rows.
const YEAR_SCOPED_SAMPLE = {
  users: [
    { ID: 'USER0001', Name: 'Ramesh Verma' },   // 2019 only
    { ID: 'USER0002', Name: 'Suresh Gupta' },    // 2019
    { ID: 'USER0003', Name: 'Zephyrina Quobble' }, // 2024 only — distinctive
  ],
  collections: [
    { Year: 2019, Name: 'USER0001', Amount: 5000 },
    { Year: 2019, Name: 'USER0002', Amount: 3000 },
    { Year: 2024, Name: 'USER0003', Amount: 7000 },
  ],
  expenses: [
    { Year: 2019, Amount: 1000, Discription: 'Tent and lighting' },
    { Year: 2024, Amount: 2000, Discription: 'Sound system' },
  ],
  loans: [{ Year: 2019, Name: 'USER0002', Amount: 10000, 'Intrest Rate': '5%', Tenure: '12 months', 'Loan ID': 'L-7' }],
  guarantors: [{ Year: 2019, Loaner: 'USER0002', Guarantor: 'USER0001', 'Loan ID': 'L-7' }],
  committee: [
    { Year: 2019, Name: 'USER0001' },
    { Year: 2024, Name: 'USER0003' },
  ],
};

test('year-scoped: a question naming a known year yields ONLY that year and excludes an unrelated year', () => {
  const s = summarizePortalData(YEAR_SCOPED_SAMPLE, '2019 me total collection kitna tha?');
  // 2019 totals + rows present.
  assert.match(s, /Year 2019: collections ₹8,000/);
  assert.match(s, /Top contributors 2019:/);
  assert.match(s, /Ramesh Verma/);
  // The unrelated 2024-only contributor must NOT appear.
  assert.doesNotMatch(s, /Zephyrina Quobble/);
  assert.doesNotMatch(s, /Year 2024:/);
  // Scoping preamble present.
  assert.match(s, /only that year's data is shown below/);
});

test('year-scoped: loans / guarantors / committee for the year resolve IDs to names (no leak)', () => {
  const s = summarizePortalData(YEAR_SCOPED_SAMPLE, 'show me 2019');
  assert.match(s, /Loans 2019: Suresh Gupta: ₹10,000/);
  assert.match(s, /interest 5%/);
  assert.match(s, /tenure 12 months/);
  assert.match(s, /Loan L-7/);
  assert.match(s, /Guarantors 2019: Ramesh Verma guarantees Suresh Gupta \(Loan L-7\)/);
  assert.match(s, /Committee 2019 \(1 members\): Ramesh Verma/);
  assert.match(s, /Expenses 2019: Tent and lighting/);
  assert.doesNotMatch(s, /USER\d+/);
});

test('year-scoped: an orphan person ID (absent from users) is neutral-labelled, never leaked', () => {
  const data = {
    users: [], // nothing resolves
    collections: [{ Year: 2019, Name: 'USER0066', Amount: 100, Detail: 'Coconut basket', 'Is Resell': 'TRUE' }],
    loans: [{ Year: 2019, Name: 'USER0099', Amount: 5000, 'Intrest Rate': '5%', Tenure: '12m', 'Loan ID': 'L-1' }],
    guarantors: [{ Year: 2019, Loaner: 'USER0088', Guarantor: 'USER0077', 'Loan ID': 'L-2' }],
  };
  const s = summarizePortalData(data, 'what happened in 2019?');
  assert.doesNotMatch(s, /USER\d+/);
  assert.match(s, /Loans 2019: unknown member: ₹5,000/);
  assert.match(s, /Guarantors 2019: unknown member guarantees unknown member \(Loan L-2\)/);
  assert.match(s, /Resold items 2019 .*Coconut basket by unknown member ₹100/);
});

test('year-scoped: an orphan PLAIN (non-resell) contributor and orphan committee member are neutral-labelled, never leaked', () => {
  // Orphan IDs built via runtime string concatenation (no literal secret-like
  // values). Nothing resolves in `users`, so both the top-contributors block and
  // the committee block must degrade the raw code to the neutral label rather
  // than leaking USER#### — the exact path the resell-based orphan test misses.
  const orphanContributor = 'USER' + '0044';
  const orphanCommittee = 'USER' + '0055';
  const data = {
    users: [], // nothing resolves
    // A PLAIN contribution (NOT a resell), so it flows into top-contributors.
    collections: [{ Year: 2019, Name: orphanContributor, Amount: 1200 }],
    committee: [{ Year: 2019, Name: orphanCommittee }],
  };
  const s = summarizePortalData(data, 'top contributors in 2019?');
  // The raw internal code must never reach the prompt.
  assert.doesNotMatch(s, /USER\d+/);
  // Top-contributors line labels the orphan neutrally, keyed by 'unknown member'.
  assert.match(s, /Top contributors 2019: unknown member \(₹1,200\)/);
  // Committee line labels the orphan neutrally too.
  assert.match(s, /Committee 2019 \(1 members\): unknown member/);
});

test('detectYears (via summarizePortalData): a no-year question falls back to the general aggregated summary', () => {
  const s = summarizePortalData(YEAR_SCOPED_SAMPLE, 'top contributors overall');
  // General path: no year-scoping preamble; multiple years' totals present.
  assert.doesNotMatch(s, /only that year's data is shown below/);
  assert.match(s, /Year 2019:/);
  assert.match(s, /Year 2024:/);
  assert.match(s, /Top contributors 2019:/);
  assert.match(s, /Top contributors 2024:/);
});

test('detectYears (via summarizePortalData): a year NOT present in the data falls back to general (not scoped)', () => {
  // 2011 is a valid 4-digit year but absent from the data -> no scoping.
  const s = summarizePortalData(YEAR_SCOPED_SAMPLE, 'total collection in 2011?');
  assert.doesNotMatch(s, /only that year's data is shown below/);
  assert.match(s, /Year 2019:/);
  assert.match(s, /Year 2024:/);
});

test('year-scoped: per-person block is included when the question names someone alongside the year', () => {
  const s = summarizePortalData(YEAR_SCOPED_SAMPLE, 'Ramesh Verma ne 2019 me kitna diya?');
  assert.match(s, /only that year's data is shown below/);
  assert.match(s, /Contributions by "Ramesh Verma"/);
  assert.match(s, /total ₹5,000/);
  assert.doesNotMatch(s, /USER\d+/);
});

test('year-scoped and general contexts both stay <= 6100 chars on a 10-year dataset', () => {
  const users = [];
  const collections = [];
  const expenses = [];
  const loans = [];
  const guarantors = [];
  const committee = [];
  // 10 years x hundreds of rows each.
  for (let yi = 0; yi < 10; yi++) {
    const year = 2015 + yi;
    for (let i = 0; i < 300; i++) {
      const uid = 'USER' + (yi * 1000 + i);
      users.push({ ID: uid, Name: 'Person Number ' + (yi * 1000 + i) });
      collections.push({ Year: year, Name: uid, Amount: (i + 1) });
      expenses.push({ Year: year, Amount: (i + 1), Discription: 'Spend item ' + i });
      loans.push({ Year: year, Name: uid, Amount: (i + 1), 'Intrest Rate': '5%', Tenure: '12m', 'Loan ID': 'L' + (yi * 1000 + i) });
      guarantors.push({ Year: year, Loaner: uid, Guarantor: uid, 'Loan ID': 'L' + (yi * 1000 + i) });
      committee.push({ Year: year, Name: uid });
    }
  }
  const big = { users, collections, expenses, loans, guarantors, committee };
  const scoped = summarizePortalData(big, 'total collection in 2018?');
  const general = summarizePortalData(big, 'overall totals');
  assert.ok(scoped.length <= 6100, 'year-scoped summary stays capped on a 10-year dataset');
  assert.ok(general.length <= 6100, 'general summary stays capped on a 10-year dataset');
});

test('year-scoped context is CACHE-ONLY: it never calls fetch (does not touch D1)', () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('year-scoped context must not fetch'); };
  try {
    let out;
    assert.doesNotThrow(() => { out = summarizePortalData(YEAR_SCOPED_SAMPLE, '2019 collection details'); });
    assert.equal(typeof out, 'string');
    assert.ok(out.length > 0, 'returns a non-empty context string with no network access');
    assert.match(out, /only that year's data is shown below/);
  } finally { globalThis.fetch = orig; }
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

// ---- chatProvider.js dataMode mapping (Render side) ----
// getPublicChatProviders() asks the mgmt Worker over ?render-provider and must
// carry each provider's `dataMode` through (defaulting to undefined when absent).
// fetch is stubbed — no network, no pg. The mgmt base is derived from
// WORKER_WEBHOOK_URL's origin (https://mgmt.test), so the request lands there.
const { getPublicChatProviders, _resetProviderCache } = await import('../src/lib/chatProvider.js');

test('getPublicChatProviders carries dataMode through (full survives; missing => undefined)', async () => {
  _resetProviderCache();
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        configured: true,
        providers: [
          { type: 'openai', model: 'm-full', dataMode: 'full' },
          { type: 'anthropic', model: 'm-summary', dataMode: 'summary' },
          { type: 'openai', model: 'm-none' }, // no dataMode field
        ],
      }),
    };
  };
  try {
    const providers = await getPublicChatProviders();
    assert.equal(providers.length, 3);
    assert.equal(providers[0].dataMode, 'full');
    assert.equal(providers[1].dataMode, 'summary');
    assert.equal(providers[2].dataMode, undefined, 'a provider missing dataMode comes through as undefined');
    // The Render-only ?render-provider route on the mgmt base was hit.
    assert.ok(calls.some(u => u.includes('render-provider')), 'asked the Worker over ?render-provider');
    assert.ok(calls.some(u => u.startsWith('https://mgmt.test')), 'used the mgmt base from WORKER_WEBHOOK_URL');
  } finally { globalThis.fetch = orig; _resetProviderCache(); }
});

test('getPublicChatProviders falls back to a single `provider` (older Worker) with its dataMode', async () => {
  _resetProviderCache();
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ configured: true, provider: { type: 'openai', model: 'solo', dataMode: 'full' } }),
  });
  try {
    const providers = await getPublicChatProviders();
    assert.equal(providers.length, 1);
    assert.equal(providers[0].model, 'solo');
    assert.equal(providers[0].dataMode, 'full');
  } finally { globalThis.fetch = orig; _resetProviderCache(); }
});

// ---- end-to-end full-vs-summary routing (buildContextForProvider) ----
// The pure selection helper lives in publicData.js (no express), so we exercise the
// REAL routing logic callChatModelChain uses: a 'full' provider yields the full
// dataset layout; a 'summary'/missing-mode provider yields the compact summary.

test('routing: dataMode=full produces buildFullContext output, summary/missing produces summarizePortalData', () => {
  const q = '';
  const full = buildContextForProvider({ type: 'openai', model: 'm', dataMode: 'full' }, FULL_SAMPLE, q, 'en');
  const summary = buildContextForProvider({ type: 'openai', model: 'm', dataMode: 'summary' }, FULL_SAMPLE, q, 'en');
  const missing = buildContextForProvider({ type: 'openai', model: 'm' }, FULL_SAMPLE, q, 'en');

  // The full provider routes through buildFullContext (whole dataset layout).
  assert.match(full, /COMPLETE public dataset/);
  assert.match(full, /ALL CONTRIBUTIONS/);
  assert.equal(full, buildFullContext(FULL_SAMPLE, q));

  // A summary (or missing) mode routes through the compact summarizePortalData.
  assert.doesNotMatch(summary, /ALL CONTRIBUTIONS/);
  assert.match(summary, /Top contributors/);
  assert.equal(summary, summarizePortalData(FULL_SAMPLE, q));
  // A missing dataMode defaults to summary — identical to the explicit summary.
  assert.equal(missing, summary);
});

test('routing: lang=hi appends the Hindi instruction to either mode', () => {
  const full = buildContextForProvider({ dataMode: 'full' }, FULL_SAMPLE, '', 'hi');
  const summary = buildContextForProvider({ dataMode: 'summary' }, FULL_SAMPLE, '', 'hi');
  assert.match(full, /Reply in simple Hindi/);
  assert.match(summary, /Reply in simple Hindi/);
});

// ---- FULL data-mode context (buildFullContext) ----
// Full mode lays out the WHOLE public dataset row-by-row, IDs resolved to real
// names, CACHE-ONLY (never fetches / touches D1), bounded by a large cap with an
// automatic fall-back to the compact summary on a huge dataset.

const FULL_SAMPLE = {
  users: [
    { ID: 'USER0001', Name: 'Ramesh Verma' },
    { ID: 'USER0002', Name: 'Suresh Gupta' },
    { ID: 'USER0003', Name: 'Anil Prasad' },
  ],
  collections: [
    { Year: 2026, Name: 'USER0001', Amount: 5000, __rowIndex: 1 },
    { Year: 2026, Name: 'USER0002', Amount: 3000, __rowIndex: 2 },
    { Year: 2025, Name: 'USER0001', Amount: 2000, __rowIndex: 3 },
    { Year: 2024, Name: 'USER0003', Amount: 1500, __rowIndex: 4 },
  ],
  expenses: [
    { Year: 2026, Amount: 1000, Detail: 'Tent and lighting' },
    { Year: 2025, Amount: 800, Detail: 'Prasad' },
  ],
  loans: [{ Year: 2025, Name: 'USER0002', Amount: 10000, Detail: 'Advance' }],
  guarantors: [{ Name: 'USER0001', 'Loan Taker': 'USER0002' }],
  committee: [
    { Year: 2026, Name: 'USER0001', 'View Role': 'President' },
    { Year: 2026, Name: 'USER0002', 'View Role': 'Secretary' },
    { Year: 2025, Name: 'USER0003', 'View Role': 'Treasurer' },
  ],
  generatedFiles: [
    { doc_type: 'receipt', year: 2026, record_id: 'receipt-2026-1', public_link: 'https://files.test/ramesh.pdf' },
  ],
};

test('buildFullContext resolves IDs to real names and never emits a raw USER#### code', () => {
  const s = buildFullContext(FULL_SAMPLE, '');
  assert.match(s, /Ramesh Verma/);
  assert.match(s, /Suresh Gupta/);
  assert.match(s, /Anil Prasad/);
  // No raw person-ID code must ever leak into the full context.
  assert.doesNotMatch(s, /USER00\d\d/);
});

test('buildFullContext includes multiple years and multiple sections', () => {
  const s = buildFullContext(FULL_SAMPLE, '');
  // Multiple years present.
  assert.match(s, /Year 2026:/);
  assert.match(s, /Year 2025:/);
  assert.match(s, /Year 2024:/);
  // Multiple sections: contributions, expenses, committee, loans.
  assert.match(s, /ALL CONTRIBUTIONS/);
  assert.match(s, /ALL EXPENSES/);
  assert.match(s, /COMMITTEE MEMBERS BY YEAR/);
  assert.match(s, /ALL LOANS/);
  // Expense detail + committee role are carried through.
  assert.match(s, /Tent and lighting/);
  assert.match(s, /President/);
  // A public download link for a contribution is included.
  assert.match(s, /https:\/\/files\.test\/ramesh\.pdf/);
});

test('buildFullContext never throws on missing/empty data', () => {
  assert.doesNotThrow(() => buildFullContext({}, ''));
  assert.doesNotThrow(() => buildFullContext(null, null));
});

test('buildFullContext is CACHE-ONLY: it never calls fetch (does not touch D1)', () => {
  const orig = globalThis.fetch;
  // Any fetch attempt would mean it tried to hit the network / D1 — hard fail.
  globalThis.fetch = () => { throw new Error('buildFullContext must not fetch'); };
  try {
    let out;
    assert.doesNotThrow(() => { out = buildFullContext(FULL_SAMPLE, 'Ramesh ne kitna diya'); });
    assert.equal(typeof out, 'string');
    assert.ok(out.length > 0, 'returns a non-empty context string with no network access');
  } finally { globalThis.fetch = orig; }
});

test('buildFullContext stays under its cap on a normal dataset (does not fall back)', () => {
  const s = buildFullContext(FULL_SAMPLE, '');
  // A modest dataset must produce the full layout (not the summary fall-back).
  assert.match(s, /COMPLETE public dataset/);
  assert.ok(s.length < 80000, 'full context stays under the char cap');
});

test('buildFullContext auto-falls-back to the compact summary on a huge dataset', () => {
  const many = [];
  for (let i = 0; i < 20000; i++) many.push({ Year: 2026, Name: 'USER' + i, Amount: i, __rowIndex: i });
  const users = [];
  for (let i = 0; i < 20000; i++) users.push({ ID: 'USER' + i, Name: 'Person Number ' + i });
  const huge = { users, collections: many, committee: many.map(m => ({ Year: 2026, Name: m.Name })) };
  const s = buildFullContext(huge, '');
  // Over the cap => returns summarizePortalData output, which is itself capped ~6000.
  assert.ok(s.length <= 6100, 'huge full dataset degrades to the compact, capped summary');
});

test('buildFullContext lists loans and guarantors with real names', () => {
  const s = buildFullContext(FULL_SAMPLE, '');
  assert.match(s, /ALL LOANS \(1, total principal ₹10,000\)/);
  assert.match(s, /GUARANTORS \(1\)/);
  // Guarantor + loan-taker resolved to names, no IDs.
  assert.match(s, /Ramesh Verma guarantees Suresh Gupta/);
});

test('buildFullContext degrades an unresolved USER#### id to a neutral label (no raw code leaks)', () => {
  // An orphan contributor/committee/loan/guarantor ID absent from `users` must
  // NEVER print the raw code — the full-mode header promises real names only.
  const data = {
    users: [], // nothing resolves
    collections: [{ Year: 2026, Name: 'USER9999', Amount: 100, __rowIndex: 1 }],
    committee: [{ Year: 2026, Name: 'USER8888', 'View Role': 'President' }],
    loans: [{ Year: 2025, Name: 'USER7777', Amount: 500 }],
    guarantors: [{ Name: 'USER6666', 'Loan Taker': 'USER5555' }],
  };
  const s = buildFullContext(data, '');
  // No raw person-ID code anywhere in the full context.
  assert.doesNotMatch(s, /USER\d+/);
  // The rows still appear, labelled neutrally.
  assert.match(s, /unknown member/);
  // And the neutral label reaches every full-mode section.
  assert.match(s, /ALL CONTRIBUTIONS/);
  assert.match(s, /COMMITTEE MEMBERS BY YEAR/);
  assert.match(s, /ALL LOANS/);
  assert.match(s, /GUARANTORS/);
});

test('buildFullContext emits GUARANTORS even when there are no loan rows', () => {
  // Guarantors must not be coupled to loans: a portal with guarantors but no
  // loan rows must still surface the GUARANTORS section.
  const data = {
    users: [
      { ID: 'USER0001', Name: 'Ramesh Verma' },
      { ID: 'USER0002', Name: 'Suresh Gupta' },
    ],
    loans: [], // no loans at all
    guarantors: [{ Name: 'USER0001', 'Loan Taker': 'USER0002' }],
  };
  const s = buildFullContext(data, '');
  assert.doesNotMatch(s, /ALL LOANS/); // no loan section
  assert.match(s, /GUARANTORS \(1\)/); // but guarantors still appear
  assert.match(s, /Ramesh Verma guarantees Suresh Gupta/);
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
