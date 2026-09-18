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

const { summarizePortalData, buildFullContext, buildContextForProvider, languageDirective, getPortalData, _resetCache } = await import('../src/lib/publicData.js');

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

test('no-developer-instructions guardrail is present in both summary and full contexts, and reinforced for document questions', () => {
  // The live bot has replied to ordinary end users with developer/integration
  // advice (linkify, HTML/Markdown rendering, [download: URL] parse). The
  // guardrail must forbid that in EVERY mode and just hand back links plainly.
  const summary = summarizePortalData(SAMPLE, '');
  const full = buildFullContext(SAMPLE, '');
  // Summary mode carries the shared guardrail line.
  assert.match(summary, /NEVER give technical, developer, or integration instructions/);
  assert.match(summary, /do not mention HTML, Markdown, rendering, libraries \(e\.g\. linkify\), APIs, parsing/);
  // Full mode carries the identical shared guardrail line.
  assert.match(full, /NEVER give technical, developer, or integration instructions/);
  assert.match(full, /present the link plainly and in a friendly, user-facing way/);
  // The existing over-refusing guardrails must not be weakened.
  assert.match(summary, /Only say you do not have the information if the answer genuinely is not in the data below/);
  assert.match(full, /Only say you do not have the information if it genuinely is not below/);
  // A document-intent question reinforces the guardrail at the DOCUMENT LINKS block.
  const doc = summarizePortalData(SAMPLE, 'mujhe receipt ka download link chahiye');
  assert.match(doc, /DOCUMENT LINKS/);
  assert.match(doc, /Give NO developer, rendering, library, or parsing advice/);
  // The existing DOCUMENT LINKS example and PDF clause are preserved.
  assert.match(doc, /Yahan hai 2024 ki receipt: <link>/);
  assert.match(doc, /Do NOT describe or open the PDF/);
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

// ---- JOURNEY / 10-YEAR STORY (decade section) ----
// A visitor asking about "hamari yatra" / the 10-year / decade story gets a real,
// data-grounded section: DERIVED decade figures (span 2017 -> latest, grand total,
// grand contributors, best/peak year, resold rows EXCLUDED) plus a bounded digest
// of the real journeyEntries/journeyTagline when the backend shipped them. It is
// the friendly EXTRA appended after the core sections, cache-only, and bounded.

// Multi-year fixture spanning 2017..2024 (so the span is 2017 -> 2024). 2019 is the
// peak year. USER0009 is a RESOLD row that must NOT inflate a contributor count.
const JOURNEY_SAMPLE = {
  users: [
    { ID: 'USER0001', Name: 'Ramesh Verma' },
    { ID: 'USER0002', Name: 'Suresh Gupta' },
    { ID: 'USER0003', Name: 'Anil Prasad' },
    { ID: 'USER0009', Name: 'Reseller Ji' },
  ],
  collections: [
    { Year: 2017, Name: 'USER0001', Amount: 1000 },
    { Year: 2018, Name: 'USER0001', Amount: 2000 },
    { Year: 2018, Name: 'USER0002', Amount: 1000 },
    { Year: 2019, Name: 'USER0001', Amount: 9000 }, // peak year total
    { Year: 2019, Name: 'USER0002', Amount: 4000 },
    { Year: 2024, Name: 'USER0003', Amount: 3000 },
    // A resold row in 2024 — excluded from contributor counts AND its amount is a
    // resell (still summed into the year total per the existing aggregation).
    { Year: 2024, Name: 'USER0009', Amount: 500, Detail: 'Coconut basket', 'Is Resell': 'TRUE' },
  ],
};

// The decade span ends at max(2017, latest data year, CURRENT calendar year), so
// even when the cached data lags the calendar (latest here is 2024) the span still
// reaches "now" — mirroring decadeStats in derive.ts.
const CURRENT_YEAR = new Date().getFullYear();
const JOURNEY_END_YEAR = Math.max(2024, CURRENT_YEAR);
const JOURNEY_SPAN_LEN = JOURNEY_END_YEAR - 2017 + 1;

test('journey: summary emits the JOURNEY / 10-YEAR STORY header with the 2017 -> current-year span, grand total, and best year', () => {
  const s = summarizePortalData(JOURNEY_SAMPLE, 'hamari 10 saal ki yatra ke baare mein batao');
  assert.match(s, /JOURNEY \/ 10-YEAR STORY/);
  // Span runs from 2017 to the current calendar year (>= latest data year 2024).
  assert.match(s, new RegExp(`Span: 2017 to ${JOURNEY_END_YEAR} \\(${JOURNEY_SPAN_LEN} years\\)`));
  // Grand total mirrors decadeStats (money-only, resold EXCLUDED):
  // 1000+2000+1000+9000+4000+3000 = 20000 (the ₹500 resold row is not counted; the
  // extra empty years up to the current year add ₹0).
  assert.match(s, /Total collected across the whole journey: ₹20,000/);
  // 2019 is the peak year (9000 + 4000 = 13000).
  assert.match(s, /Best\/peak year so far: 2019 with ₹13,000/);
});

test('journey: contributor counts EXCLUDE resold rows (a resold row does not inflate the count)', () => {
  const s = summarizePortalData(JOURNEY_SAMPLE, 'poore decade ki journey batao');
  // 2024 has ONE real contributor (Anil Prasad); the resold row (Reseller Ji) is
  // excluded from BOTH the contributor count AND the money total (mirroring
  // decadeStats), so the year shows ₹3,000 from 1 contributor.
  assert.match(s, /2024: ₹3,000 \(1 contributors\)/);
  // Grand contributors = 1(2017)+2(2018)+2(2019)+0(2020..2023)+1(2024) = 6.
  assert.match(s, /from 6 contributor entries/);
});

test('journey: when journeyEntries + journeyTagline are present, the tagline and a `year — title` appear, WITHOUT the full content bodies', () => {
  const data = {
    ...JOURNEY_SAMPLE,
    journeyTagline: { en: 'A decade of devotion and service.', hi: 'सेवा का एक दशक।' },
    journeyEntries: [
      { year: 2017, title_en: 'The First Ghat', title_hi: 'पहला घाट', content_en: 'SECRET_BODY_ONE full story text that must not be dumped', content_hi: 'गुप्त कहानी' },
      { year: 2019, title_en: 'Record Turnout', title_hi: 'रिकॉर्ड भीड़', content_en: 'SECRET_BODY_TWO another long body', content_hi: 'लंबी कहानी' },
    ],
  };
  const s = summarizePortalData(data, 'hamari yatra ki kahani');
  assert.match(s, /Journey tagline: A decade of devotion and service\./);
  assert.match(s, /Story highlights:/);
  assert.match(s, /2017 — The First Ghat/);
  assert.match(s, /2019 — Record Turnout/);
  // The full content_en / content_hi bodies must NOT be dumped.
  assert.doesNotMatch(s, /SECRET_BODY_ONE/);
  assert.doesNotMatch(s, /SECRET_BODY_TWO/);
});

test('journey: when journeyEntries is absent, the DERIVED-figures narrative still appears (fallback path, no crash)', () => {
  // JOURNEY_SAMPLE carries no journeyEntries/journeyTagline.
  const s = summarizePortalData(JOURNEY_SAMPLE, 'decade story');
  assert.match(s, /JOURNEY \/ 10-YEAR STORY/);
  assert.match(s, /Total collected across the whole journey:/);
  // No story digest lines when there are no entries.
  assert.doesNotMatch(s, /Journey tagline:/);
  assert.doesNotMatch(s, /Story highlights:/);
});

test('journey: buildFullContext also contains the JOURNEY / 10-YEAR STORY section', () => {
  const s = buildFullContext(JOURNEY_SAMPLE, '');
  assert.match(s, /JOURNEY \/ 10-YEAR STORY/);
  assert.match(s, new RegExp(`Span: 2017 to ${JOURNEY_END_YEAR}`));
  assert.match(s, /Total collected across the whole journey: ₹20,000/);
  assert.match(s, /Best\/peak year so far: 2019/);
});

test('journey: the year-scoped path carries a small decade-context line', () => {
  // 2019 is present, so this routes through buildYearScopedContext.
  const s = summarizePortalData(JOURNEY_SAMPLE, '2019 me kitna collection hua?');
  assert.match(s, /only that year's data is shown below/); // confirm year-scoped branch
  assert.match(s, new RegExp(`Decade context: the committee's journey runs 2017 to ${JOURNEY_END_YEAR}`));
  assert.match(s, /best year 2019/);
  // The heavier full journey section (with the per-year growth list) is NOT on this path.
  assert.doesNotMatch(s, /JOURNEY \/ 10-YEAR STORY/);
});

test('journey: the section is CACHE-ONLY — summarizePortalData never calls fetch (does not touch D1)', () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('journey section must not fetch'); };
  try {
    let out;
    assert.doesNotThrow(() => { out = summarizePortalData(JOURNEY_SAMPLE, 'hamari yatra ki poori kahani batao'); });
    assert.match(out, /JOURNEY \/ 10-YEAR STORY/);
    assert.match(out, new RegExp(`Span: 2017 to ${JOURNEY_END_YEAR}`));
  } finally { globalThis.fetch = orig; }
});

test('journey: the section never throws and emits nothing when there is genuinely no data', () => {
  assert.doesNotThrow(() => summarizePortalData({}, 'hamari yatra'));
  const s = summarizePortalData({}, 'hamari yatra');
  assert.doesNotMatch(s, /JOURNEY \/ 10-YEAR STORY/);
});

test('journey: the section stays bounded — summary with the journey block still <= 6100 chars on a large multi-year dataset', () => {
  const users = [];
  const collections = [];
  const journeyEntries = [];
  for (let yi = 0; yi < 10; yi++) {
    const year = 2017 + yi;
    for (let i = 0; i < 400; i++) {
      const uid = 'USER' + (yi * 1000 + i);
      users.push({ ID: uid, Name: 'Person Number ' + (yi * 1000 + i) });
      collections.push({ Year: year, Name: uid, Amount: (i + 1) });
    }
    journeyEntries.push({ year, title_en: 'Chapter ' + year + ' of a very long journey title that keeps going', title_hi: 'अध्याय', content_en: 'x'.repeat(5000), content_hi: 'y'.repeat(5000) });
  }
  const big = { users, collections, journeyEntries, journeyTagline: { en: 'z'.repeat(2000) } };
  const s = summarizePortalData(big, 'hamari 10 saal ki yatra');
  assert.ok(s.length <= 6100, 'summary with the journey section stays capped (~6000 chars)');
});

// ---- Review v1 fixes: money-only totals + current-year span ----

// Issue #1 (money-only divergence): material ('2') and service ('3') rows carry an
// Amount but must contribute ₹0 to the journey MONEY total, mirroring derive.ts
// contributorsForYear/computeSummary. This fixture puts a ₹10,000 material row and
// a ₹7,000 service row alongside a ₹1,000 money row in the SAME year; the journey
// grand total must be the money-only ₹1,000, not ₹18,000.
const JOURNEY_MIXED_TYPES = {
  users: [
    { ID: 'USER0001', Name: 'Money Giver' },
    { ID: 'USER0002', Name: 'Material Giver' },
    { ID: 'USER0003', Name: 'Service Giver' },
  ],
  collections: [
    { Year: 2018, Name: 'USER0001', Amount: 1000, 'Contribution Type': '1' },        // money
    { Year: 2018, Name: 'USER0002', Amount: 10000, 'Contribution Type': '2', Detail: 'Donated a generator' }, // material
    { Year: 2018, Name: 'USER0003', Amount: 7000, 'Contribution Type': '3', Detail: 'Volunteered' },          // service
  ],
};

test('journey (fix #1): a material/service row carrying an Amount does NOT inflate the journey money total', () => {
  const s = summarizePortalData(JOURNEY_MIXED_TYPES, 'hamari yatra ka total kitna hai');
  // Money-only grand total is ₹1,000 (the ₹10,000 material + ₹7,000 service Amounts
  // are excluded, mirroring the public "Our Journey" page).
  assert.match(s, /Total collected across the whole journey: ₹1,000 from/);
  // The inflated ₹18,000 (or ₹17,000) all-amount total must NOT appear.
  assert.doesNotMatch(s, /Total collected across the whole journey: ₹18,000/);
  assert.doesNotMatch(s, /Total collected across the whole journey: ₹17,000/);
  // But all three people still count as contributor entries for 2018 (count side is
  // any non-resold row with an ID, regardless of contribution type).
  assert.match(s, /from 3 contributor entries/);
  // The best year (2018) reflects the money-only total too.
  assert.match(s, /Best\/peak year so far: 2018 with ₹1,000/);
});

test('journey (fix #1): the year-scoped decade-context line is also money-only for mixed types', () => {
  // Route through buildYearScopedContext by naming the present year.
  const s = summarizePortalData(JOURNEY_MIXED_TYPES, '2018 me kitna aaya?');
  assert.match(s, /only that year's data is shown below/);
  // Decade context grand total is money-only ₹1,000, not the ₹18,000 all-amount sum.
  assert.match(s, /₹1,000 collected in total \(money contributions only\)/);
  assert.doesNotMatch(s, /₹18,000 collected in total/);
});

// Issue #2 (span omits current year): when the latest DATA year lags the calendar
// (here 2020, well before "now"), the span must still end at the current calendar
// year — mirroring decadeStats endYear = max(2017, dataMax, currentYear). A year
// present ONLY in loans/committee (2021) must also be honoured via availableYears.
const JOURNEY_STALE_DATA = {
  users: [{ ID: 'USER0001', Name: 'Old Timer' }],
  collections: [{ Year: 2020, Name: 'USER0001', Amount: 5000 }],
  loans: [{ Year: 2021, Name: 'USER0001', Amount: 1000, 'Loan ID': 'L1' }],
  committee: [{ Year: 2021, Name: 'USER0001' }],
};

test('journey (fix #2): the span ends at the CURRENT calendar year even when the data year lags', () => {
  const nowYear = new Date().getFullYear();
  const s = summarizePortalData(JOURNEY_STALE_DATA, 'poori decade journey batao');
  // The span must reach the current calendar year, not stop at the 2020 data year.
  assert.match(s, new RegExp(`Span: 2017 to ${nowYear} \\(`));
  assert.doesNotMatch(s, /Span: 2017 to 2020/);
  assert.doesNotMatch(s, /Span: 2017 to 2021/);
});

test('journey (fix #2): the latest data year unions loans/committee, not just collections', () => {
  // With current year in the far future this would be moot, but the union still
  // matters for endYear when a loans/committee year exceeds the collections year.
  // Here 2021 (loans+committee) > 2020 (collections); the span floor is thus >= 2021
  // (and, being <= now, is exactly the current calendar year).
  const nowYear = new Date().getFullYear();
  const s = summarizePortalData(JOURNEY_STALE_DATA, 'decade story');
  assert.match(s, new RegExp(`Span: 2017 to ${Math.max(2021, nowYear)}`));
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

test('year-scoped: the no-developer-instructions guardrail is present on the year path too', () => {
  // Review issue #2: buildYearScopedContext pushes NO_DEV_INSTRUCTIONS_LINE, but no
  // test asserted it there, so a partial revert of that one push would pass CI. This
  // question names a year present in the multi-year data, so summarizePortalData
  // routes through buildYearScopedContext (confirmed by the year-scoping preamble
  // and the year-only totals asserted below).
  const s = summarizePortalData(YEAR_SCOPED_SAMPLE, '2019 me total collection kitna tha?');
  // Confirm we are on the year-scoped branch (not the general aggregated path).
  assert.match(s, /only that year's data is shown below/);
  assert.match(s, /Year 2019: collections ₹8,000/);
  assert.doesNotMatch(s, /Year 2024:/);
  // The shared guardrail line is carried on this branch as well.
  assert.match(s, /NEVER give technical, developer, or integration instructions/);
  assert.match(s, /do not mention HTML, Markdown, rendering, libraries \(e\.g\. linkify\), APIs, parsing/);
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

// ---- PHASE 2: generated-PDF links handed back directly ----
// When the question is about a document (receipt/certificate/PDF/download), the
// context surfaces the matching generatedFiles public_link DIRECTLY so the model
// replies with the link rather than describing/fetching PDF content. Resolution is
// by named person and/or year (via the record_id trailing -<year>-<rowIndex> match),
// or a bounded list otherwise. CACHE-ONLY and LINKS-ONLY: no fetch, no PDF content,
// only public_link strings already in the payload.

const DOC_SAMPLE = {
  users: [
    { ID: 'USER0001', Name: 'Amit Kumar' },
    { ID: 'USER0002', Name: 'Suresh Gupta' },
  ],
  collections: [
    { Year: 2024, Name: 'USER0001', Amount: 500, __rowIndex: 7 },
    { Year: 2023, Name: 'USER0001', Amount: 300, __rowIndex: 3 },
    { Year: 2024, Name: 'USER0002', Amount: 900, __rowIndex: 9 },
  ],
  generatedFiles: [
    { doc_type: 'receipt', year: 2024, record_id: 'receipt-2024-7', public_link: 'https://files.test/amit-2024.pdf' },
    { doc_type: 'receipt', year: 2023, record_id: 'receipt-2023-3', public_link: 'https://files.test/amit-2023.pdf' },
    { doc_type: 'certificate', year: 2024, record_id: 'certificate-2024-9', public_link: 'https://files.test/suresh-2024.pdf' },
  ],
};

test('doc-intent: a document/receipt question surfaces matching public_link(s) directly in the context', () => {
  const s = summarizePortalData(DOC_SAMPLE, 'mujhe receipt ka download link chahiye');
  assert.match(s, /DOCUMENT LINKS/);
  // A bounded list of real links is surfaced (links-only).
  assert.match(s, /https:\/\/files\.test\/amit-2024\.pdf/);
  assert.match(s, /hand back the matching public link DIRECTLY/);
  // No internal record_id ever leaks.
  assert.doesNotMatch(s, /receipt-2024-7/);
});

test('doc-intent: a person+year document question resolves to THAT person\'s link via the trailing -<year>-<rowIndex> match', () => {
  // 2024 is present in the data, so this routes through the year-scoped path.
  const s = summarizePortalData(DOC_SAMPLE, 'Amit Kumar ki 2024 ki receipt ka link do');
  assert.match(s, /DOCUMENT LINKS/);
  assert.match(s, /Documents for "Amit Kumar" \(2024\)/);
  assert.match(s, /https:\/\/files\.test\/amit-2024\.pdf/);
  // NOT the 2023 link (year-scoped) and NOT the other person's link.
  assert.doesNotMatch(s, /amit-2023\.pdf/);
  assert.doesNotMatch(s, /suresh-2024\.pdf/);
  // No raw ID / record_id leaks.
  assert.doesNotMatch(s, /USER\d+/);
  assert.doesNotMatch(s, /receipt-2024-7/);
});

test('doc-intent: a person document question with no year lists that person\'s links (general path)', () => {
  const s = summarizePortalData(DOC_SAMPLE, 'Amit Kumar ke certificate documents');
  assert.match(s, /DOCUMENT LINKS/);
  assert.match(s, /Documents for "Amit Kumar"/);
  // Both years' links for the person appear when no year narrows it.
  assert.match(s, /https:\/\/files\.test\/amit-2024\.pdf/);
  assert.match(s, /https:\/\/files\.test\/amit-2023\.pdf/);
  assert.doesNotMatch(s, /USER\d+/);
});

test('doc-intent: a missing document degrades gracefully with a neutral note and no fabricated link', () => {
  const data = {
    users: [{ ID: 'USER0001', Name: 'Amit Kumar' }],
    collections: [{ Year: 2024, Name: 'USER0001', Amount: 500, __rowIndex: 7 }],
    generatedFiles: [], // nothing generated
  };
  const s = summarizePortalData(data, 'Amit Kumar ki receipt ka link');
  assert.match(s, /DOCUMENT LINKS/);
  assert.match(s, /no downloadable document is available/i);
  // No fabricated URL of any kind.
  assert.doesNotMatch(s, /https?:\/\//);
  assert.doesNotMatch(s, /USER\d+/);
});

test('doc-intent: a document question with no files at all degrades gracefully (no crash, no link)', () => {
  const data = { collections: [], generatedFiles: [] };
  let s;
  assert.doesNotThrow(() => { s = summarizePortalData(data, 'receipt download'); });
  assert.match(s, /DOCUMENT LINKS/);
  assert.match(s, /No downloadable document is available/);
  assert.doesNotMatch(s, /https?:\/\//);
});

test('doc-intent: a non-document question does NOT emit a DOCUMENT LINKS block', () => {
  const s = summarizePortalData(DOC_SAMPLE, 'total collection kitna hua');
  assert.doesNotMatch(s, /DOCUMENT LINKS/);
});

test('doc-intent: a Devanagari document term (रसीद) triggers the DOCUMENT LINKS block', () => {
  const s = summarizePortalData(DOC_SAMPLE, 'रसीद का लिंक चाहिए');
  assert.match(s, /DOCUMENT LINKS/);
  assert.match(s, /https:\/\/files\.test\//);
});

test('doc-intent: an orphan person (absent from users) named in a document question is neutral-labelled, never leaked', () => {
  const orphan = 'USER' + '0044';
  const data = {
    users: [], // nothing resolves, so the person cannot be name-matched
    collections: [{ Year: 2024, Name: orphan, Amount: 500, __rowIndex: 7 }],
    generatedFiles: [{ doc_type: 'receipt', year: 2024, record_id: 'receipt-2024-7', public_link: 'https://files.test/x.pdf' }],
  };
  // No resolvable name means the question cannot match a person; it falls to the
  // bounded list. The DOCUMENT LINKS block itself must never leak the raw code or
  // the internal record_id — assert on the block's own lines.
  const s = summarizePortalData(data, 'receipt link do');
  assert.match(s, /DOCUMENT LINKS/);
  const docLines = s.slice(s.indexOf('DOCUMENT LINKS'));
  assert.doesNotMatch(docLines, /USER\d+/);
  assert.doesNotMatch(docLines, /receipt-2024-7/);
  assert.match(docLines, /https:\/\/files\.test\/x\.pdf/);
});

test('doc-intent: the DOCUMENT LINKS block is CACHE-ONLY — never calls fetch (does not touch D1)', () => {
  const orig = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('document-links builder must not fetch'); };
  try {
    let out;
    assert.doesNotThrow(() => { out = summarizePortalData(DOC_SAMPLE, 'Amit Kumar ki receipt ka link'); });
    assert.equal(typeof out, 'string');
    assert.match(out, /DOCUMENT LINKS/);
    assert.match(out, /https:\/\/files\.test\//);
  } finally { globalThis.fetch = orig; }
});

test('doc-intent: the DOCUMENT LINKS block is bounded and the context stays under the char cap on a big dataset', () => {
  const users = [];
  const collections = [];
  const generatedFiles = [];
  for (let i = 0; i < 5000; i++) {
    users.push({ ID: 'USER' + i, Name: 'Person Number ' + i });
    collections.push({ Year: 2024, Name: 'USER' + i, Amount: i, __rowIndex: i });
    generatedFiles.push({ doc_type: 'receipt', year: 2024, record_id: 'receipt-2024-' + i, public_link: 'https://files.test/f' + i + '.pdf' });
  }
  const s = summarizePortalData({ users, collections, generatedFiles }, 'receipt download link');
  assert.match(s, /DOCUMENT LINKS/);
  assert.ok(s.length <= 6100, 'context with the document block stays capped (~6000 chars)');
  // Bounded: it does NOT dump all 5000 links.
  const linkCount = (s.match(/https:\/\/files\.test\//g) || []).length;
  assert.ok(linkCount <= 15, 'document block is bounded to a small number of links');
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
  // buildContextForProvider appends the single-language directive; the body is still
  // exactly buildFullContext(...) with the directive tail.
  assert.equal(full, buildFullContext(FULL_SAMPLE, q) + languageDirective('en'));

  // A summary (or missing) mode routes through the compact summarizePortalData.
  assert.doesNotMatch(summary, /ALL CONTRIBUTIONS/);
  assert.match(summary, /Top contributors/);
  assert.equal(summary, summarizePortalData(FULL_SAMPLE, q) + languageDirective('en'));
  // A missing dataMode defaults to summary — identical to the explicit summary.
  assert.equal(missing, summary);
});

test('routing: lang=hi appends the Hindi single-language directive to either mode', () => {
  const full = buildContextForProvider({ dataMode: 'full' }, FULL_SAMPLE, '', 'hi');
  const summary = buildContextForProvider({ dataMode: 'summary' }, FULL_SAMPLE, '', 'hi');
  assert.match(full, /Hindi/);
  assert.match(full, /Devanagari/);
  assert.match(summary, /Hindi/);
  assert.match(summary, /Devanagari/);
});

// ---- FEAT-002: anti-gibberish / single-language discipline directive ----
// Defense-in-depth against fallback models (e.g. mistral-nemotron) that produced
// garbled multilingual gibberish. buildContextForProvider must append a directive
// that is parameterized by `lang`: Hindi/Devanagari for 'hi', English otherwise,
// and in BOTH cases forbid mixing in characters from other languages/scripts.

test('lang directive: lang=hi forbids mixing other scripts and asks for Devanagari', () => {
  const ctx = buildContextForProvider({ dataMode: 'summary' }, FULL_SAMPLE, 'q', 'hi');
  // Hindi + Devanagari script instruction.
  assert.match(ctx, /Hindi/);
  assert.match(ctx, /Devanagari/);
  // Anti-mixing wording: explicitly forbids characters from other languages/scripts.
  assert.match(ctx, /Korean/);
  assert.match(ctx, /Japanese/);
  assert.match(ctx, /Chinese/);
  assert.match(ctx, /Spanish/);
  assert.match(ctx, /one single language/);
});

test('lang directive: lang=en gives the English single-language directive and does NOT ask for Hindi', () => {
  const ctx = buildContextForProvider({ dataMode: 'summary' }, FULL_SAMPLE, 'q', 'en');
  assert.match(ctx, /Reply in clear English/);
  assert.match(ctx, /one single language/);
  // Must NOT instruct a Hindi / Devanagari reply.
  assert.doesNotMatch(ctx, /Hindi/);
  assert.doesNotMatch(ctx, /Devanagari/);
});

test('lang directive: the appended directive is parameterized by lang (hi != en)', () => {
  const hi = buildContextForProvider({ dataMode: 'summary' }, FULL_SAMPLE, 'q', 'hi');
  const en = buildContextForProvider({ dataMode: 'summary' }, FULL_SAMPLE, 'q', 'en');
  // The two differ — the directive is not a single static line.
  assert.notEqual(hi, en);
  // Isolate the differing tail (everything the summary itself shares is identical).
  const base = summarizePortalData(FULL_SAMPLE, 'q');
  assert.notEqual(hi.slice(base.length), en.slice(base.length));
  assert.match(hi.slice(base.length), /Devanagari/);
  assert.doesNotMatch(en.slice(base.length), /Devanagari/);
});

test('lang directive: dataMode selection still works with the directive appended', () => {
  const q = '';
  const full = buildContextForProvider({ dataMode: 'full' }, FULL_SAMPLE, q, 'hi');
  const summary = buildContextForProvider({ dataMode: 'summary' }, FULL_SAMPLE, q, 'hi');
  // full-only marker present in full mode, absent in summary mode.
  assert.match(full, /ALL CONTRIBUTIONS/);
  assert.doesNotMatch(summary, /ALL CONTRIBUTIONS/);
  // Each equals the corresponding builder plus the same directive tail.
  assert.equal(full, buildFullContext(FULL_SAMPLE, q) + languageDirective('hi'));
  assert.equal(summary, summarizePortalData(FULL_SAMPLE, q) + languageDirective('hi'));
});

test('lang directive: NO_DEV_INSTRUCTIONS_LINE guardrail remains present for both langs', () => {
  const hi = buildContextForProvider({ dataMode: 'summary' }, FULL_SAMPLE, 'q', 'hi');
  const en = buildContextForProvider({ dataMode: 'summary' }, FULL_SAMPLE, 'q', 'en');
  assert.match(hi, /NEVER give technical, developer, or integration instructions/);
  assert.match(en, /NEVER give technical, developer, or integration instructions/);
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

test('clientIpFrom reads the hop our proxy observed, not the one the caller claimed', () => {
  // This test previously asserted the FIRST hop — i.e. it pinned the vulnerability
  // (audit Render/offload #8). X-Forwarded-For is built by each proxy appending the address
  // it received from, so the left-hand entries are client-supplied: a caller sending a
  // different first hop per request got a different limiter key every time, and the per-IP
  // window never filled. The rightmost entry is the one our own proxy added.
  assert.equal(clientIpFrom({ 'x-forwarded-for': '5.5.5.5, 10.0.0.1' }, '10.0.0.9'), '10.0.0.1');
  // A forged left-hand entry no longer changes the key.
  assert.equal(clientIpFrom({ 'x-forwarded-for': 'anything-i-like, 10.0.0.1' }, '10.0.0.9'), '10.0.0.1');
  assert.equal(clientIpFrom({}, '10.0.0.9'), '10.0.0.9');
});
