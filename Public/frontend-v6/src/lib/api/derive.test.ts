import { describe, it, expect } from 'vitest';
import { parsePortalData } from './schema';
import {
  computeFinancials,
  contributorsForYear,
  rankedContributors,
  resoldItemsForYear,
  contributorTags,
  computeSummary,
  availableYears,
  loanTotalWithInterest,
  decadeStats,
  DECADE_START_YEAR,
  journeyEntries,
  journeyTagline
} from './derive';
import { competitionRank } from '$lib/utils/ranking';
import { resolveConfig, DEFAULTS } from '$lib/config';
import { t, localize } from '$lib/i18n';
import { pickDefaultTheme, isValidThemeId, DEFAULT_LIGHT, DEFAULT_DARK, THEMES } from '$lib/themes';
import { skinIdForTheme, THEME_SKIN_ID, DEFAULT_SKIN_ID } from '$lib/skins/skinMap';

// Mirrors the reference-image contributor set so ranking behaviour is verified
// against the exact example in the brief.
const sample = {
  users: [
    { ID: 'U1', Name: 'Ravi Kumar', Village: 'Shaharpura' },
    { ID: 'U2', Name: 'Sanjeet Kumar', Village: 'Gardih' },
    { ID: 'U3', Name: 'Abhishek Verma', Village: 'Shaharpura' },
    { ID: 'U4', Name: 'Govind Verma', Village: 'Gardih' },
    { ID: 'U5', Name: 'Pintu Kumar', Village: 'Shaharpura' },
    { ID: 'U6', Name: 'Aarohi Bharti', Village: 'Gardih' },
    { ID: 'U7', Name: 'Manish Kumar', Village: 'Shaharpura' },
    { ID: 'U8', Name: 'Sunil Das', Village: 'Gardih' }
  ],
  collections: [
    { Year: 2026, ID: 'U1', Amount: '2100', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U2', Amount: '2100', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U3', Amount: '1501', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U4', Amount: '1000', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U5', Amount: '1000', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U6', Amount: '786', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U7', Amount: '500', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U8', Amount: '600', 'Contribution Type': '1' },
    { Year: 2025, ID: 'U1', Amount: '999', 'Contribution Type': '1' }
  ],
  expenses: [{ Year: 2026, Amount: '1503', Discription: 'Decoration' }],
  loans: [{ Year: 2025, ID: 'U1', Amount: '10000', 'Intrest Rate': '2', Tenure: '12', 'Loan ID': 'L1' }],
  committee: [{ Year: 2026, ID: 'U1', 'View Role': 'President' }],
  guarantors: [],
  generatedFiles: [],
  loanConsents: []
};

describe('schema', () => {
  it('parses a usable payload and tolerates unknown fields', () => {
    const data = parsePortalData({ ...sample, extraTopLevel: 1, collections: [{ Year: 2026, Amount: 5, surprise: 'x' }] });
    expect(data).not.toBeNull();
    expect(Array.isArray(data!.collections)).toBe(true);
  });
  it('returns empty arrays for malformed sections instead of throwing', () => {
    const data = parsePortalData({ collections: 'not-an-array', committee: [{ Name: 'x' }] });
    expect(data!.collections).toEqual([]);
    expect(data!.committee.length).toBe(1);
  });
});

describe('financials (2026)', () => {
  const data = parsePortalData(sample)!;
  const fin = computeFinancials(data, 2026);

  it('current-year collection sums money rows', () => {
    expect(fin.collection).toBe(9587);
  });
  it('past loan returned uses previous-year (2025) loans with per-month simple interest', () => {
    expect(fin.pastLoanReturned).toBe(12400);
  });
  it('total budget = collection + past loan returned', () => {
    expect(fin.totalBudget).toBe(9587 + 12400);
  });
  it('total expense and net surplus', () => {
    expect(fin.totalExpense).toBe(1503);
    expect(fin.netSurplus).toBe(9587 + 12400 - 1503);
    expect(fin.available).toBe(fin.netSurplus);
  });
  it('utilized % is derived and clamped', () => {
    expect(fin.utilizedPct).toBeCloseTo((1503 / (9587 + 12400)) * 100, 5);
    expect(fin.utilizedPct).toBeGreaterThanOrEqual(0);
    expect(fin.utilizedPct).toBeLessThanOrEqual(100);
  });
});

describe('loan interest helper', () => {
  it('computes principal + simple interest', () => {
    const r = loanTotalWithInterest({ Amount: '5000', 'Intrest Rate': '1.5', Tenure: '10' });
    expect(r.principal).toBe(5000);
    expect(r.interest).toBe(5000 * 0.015 * 10);
    expect(r.total).toBe(5000 + 750);
  });
});

describe('competition ranking (reference example)', () => {
  const data = parsePortalData(sample)!;
  const ranked = rankedContributors(data, 2026);

  it('produces 1,1,3,4,4 with top-5 flags and no rank leakage below', () => {
    const byName = Object.fromEntries(ranked.map((r) => [r.item.name, r]));
    expect(byName['Ravi Kumar'].rank).toBe(1);
    expect(byName['Ravi Kumar'].isTop).toBe(true);
    expect(byName['Sanjeet Kumar'].rank).toBe(1);
    expect(byName['Sanjeet Kumar'].isTop).toBe(true);
    expect(byName['Abhishek Verma'].rank).toBe(3);
    expect(byName['Abhishek Verma'].isTop).toBe(true);
    expect(byName['Govind Verma'].rank).toBe(4);
    expect(byName['Govind Verma'].isTop).toBe(true);
    expect(byName['Pintu Kumar'].rank).toBe(4);
    expect(byName['Pintu Kumar'].isTop).toBe(true);
    expect(byName['Aarohi Bharti'].isTop).toBe(false);
    expect(byName['Manish Kumar'].isTop).toBe(false);
  });

  it('a 6th distinct rank appears only after the ties (no dense ranking)', () => {
    const ranks = competitionRank(
      [{ a: 10 }, { a: 10 }, { a: 5 }, { a: 3 }, { a: 3 }, { a: 1 }],
      (x) => x.a
    ).map((r) => r.rank);
    expect(ranks).toEqual([1, 1, 3, 4, 4, 6]);
  });
});

describe('contributor aggregation', () => {
  const data = parsePortalData(sample)!;
  it('sums multiple rows per person and filters by year', () => {
    const c2026 = contributorsForYear(data, 2026);
    expect(c2026.length).toBe(8);
    const c2025 = contributorsForYear(data, 2025);
    expect(c2025.length).toBe(1);
    expect(c2025[0].amount).toBe(999);
  });
});

describe('display order: EVERYONE in entry (SL No.) order, top-5 flagged in place', () => {
  const data = parsePortalData(sample)!;
  const ranked = rankedContributors(data, 2026);
  const names = ranked.map((r) => r.item.name);

  it('renders every contributor in entry order — top-5 are NOT moved to the front', () => {
    expect(names).toEqual([
      'Ravi Kumar', 'Sanjeet Kumar', 'Abhishek Verma', 'Govind Verma',
      'Pintu Kumar', 'Aarohi Bharti', 'Manish Kumar', 'Sunil Das'
    ]);
  });

  it('top-5 flag/rank stays correct in place (computed from amount, not position)', () => {
    const byName = Object.fromEntries(ranked.map((r) => [r.item.name, r]));
    expect(byName['Ravi Kumar'].isTop).toBe(true);
    expect(byName['Ravi Kumar'].rank).toBe(1);
    expect(byName['Pintu Kumar'].isTop).toBe(true);
    expect(byName['Pintu Kumar'].rank).toBe(4);
    expect(byName['Aarohi Bharti'].isTop).toBe(false);
    expect(byName['Sunil Das'].isTop).toBe(false);
  });
});

describe('resell excluded, material/service present but unranked', () => {
  const data = parsePortalData({
    users: [
      { ID: 'M1', Name: 'Money Person' },
      { ID: 'X1', Name: 'Material Person' },
      { ID: 'S1', Name: 'Service Person' }
    ],
    collections: [
      { Year: 2026, ID: 'M1', Amount: '1000', 'Contribution Type': '1' },
      { Year: 2026, ID: 'X1', Amount: '0', 'Contribution Type': '2', Detail: 'Bamboo soop' },
      { Year: 2026, ID: 'S1', Amount: '0', 'Contribution Type': '3', Detail: 'Sound system' },
      { Year: 2026, Name: 'Old Chair', Amount: '500', 'Is Resell': 'TRUE' }
    ]
  })!;
  const ranked = rankedContributors(data, 2026);

  it('resold items never appear as a contributor', () => {
    expect(ranked.find((r) => r.item.name === 'Old Chair')).toBeUndefined();
    expect(ranked.length).toBe(3);
  });

  it('material/service are listed but carry no rank and are never top-5', () => {
    const mat = ranked.find((r) => r.item.name === 'Material Person')!;
    const svc = ranked.find((r) => r.item.name === 'Service Person')!;
    expect(mat.item.hasMoney).toBe(false);
    expect(mat.rank).toBe(0);
    expect(mat.isTop).toBe(false);
    expect(svc.item.hasMoney).toBe(false);
    expect(svc.isTop).toBe(false);
  });

  it('only money contributors get a rank', () => {
    const money = ranked.find((r) => r.item.name === 'Money Person')!;
    expect(money.item.hasMoney).toBe(true);
    expect(money.rank).toBe(1);
  });

  it('resold amount is NOT counted in total collected', () => {
    const s = computeSummary(data, 2026);
    expect(s.totalCollected).toBe(1000);
  });

  it('resold rows are NOT in the contributor count', () => {
    const s = computeSummary(data, 2026);
    expect(s.contributors).toBe(3);
  });

  it('resoldItemsForYear surfaces the resold row on its own', () => {
    const items = resoldItemsForYear(data, 2026);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Old Chair');
    expect(items[0].amount).toBe(500);
  });
});

describe('multiple contributions fold + multi-kind tags', () => {
  const data = parsePortalData({
    users: [
      { ID: 'A', Name: 'Multi Giver' },
      { ID: 'B', Name: 'Money+Material' },
      { ID: 'C', Name: 'Material+Service' }
    ],
    collections: [
      { Year: 2026, ID: 'A', Amount: '300', 'Contribution Type': '1' },
      { Year: 2026, ID: 'A', Amount: '200', 'Contribution Type': '1' },
      { Year: 2026, ID: 'B', Amount: '700', 'Contribution Type': '1' },
      { Year: 2026, ID: 'B', Amount: '0', 'Contribution Type': '2', Detail: 'Soop' },
      { Year: 2026, ID: 'C', Amount: '0', 'Contribution Type': '2', Detail: 'Soop' },
      { Year: 2026, ID: 'C', Amount: '0', 'Contribution Type': '3', Detail: 'Sound' }
    ]
  })!;
  const list = contributorsForYear(data, 2026);
  const get = (name: string) => list.find((c) => c.name === name)!;

  it('sums repeat money contributions and tracks the count', () => {
    const a = get('Multi Giver');
    expect(a.amount).toBe(500);
    expect(a.count).toBe(2);
    expect(contributorTags(a)).toEqual(['money']);
  });

  it('money + material shows a money amount AND a material tag', () => {
    const b = get('Money+Material');
    expect(b.hasMoney).toBe(true);
    expect(b.amount).toBe(700);
    expect(contributorTags(b)).toEqual(['money', 'material']);
  });

  it('material + service (no money) shows both tags and no money', () => {
    const c = get('Material+Service');
    expect(c.hasMoney).toBe(false);
    expect(contributorTags(c)).toEqual(['material', 'service']);
  });
});

describe('contributor profile photo', () => {
  const data = parsePortalData({
    users: [
      { ID: 'P1', Name: 'With Photo', Photo: 'https://files.example/users/P1.jpg' },
      { ID: 'P2', Name: 'No Photo' }
    ],
    collections: [
      { Year: 2026, ID: 'P1', Amount: '500', 'Contribution Type': '1' },
      { Year: 2026, ID: 'P2', Amount: '300', 'Contribution Type': '1' }
    ]
  })!;
  const list = contributorsForYear(data, 2026);

  it('carries the user photo URL when present', () => {
    const p1 = list.find((c) => c.name === 'With Photo')!;
    expect(p1.photo).toBe('https://files.example/users/P1.jpg');
  });

  it('falls back to an empty photo (initials avatar) when absent', () => {
    const p2 = list.find((c) => c.name === 'No Photo')!;
    expect(p2.photo).toBe('');
  });
});

describe('decadeStats — live "Our Journey" figures', () => {
  const data = parsePortalData(sample)!;
  it('starts at the fixed founding year and ends at the current year', () => {
    const years = decadeStats(data, 2026).years;
    expect(years[0].year).toBe(DECADE_START_YEAR);
    expect(years.at(-1)?.year).toBe(2026);
  });
  it('produces a contiguous row per year from start to end', () => {
    const years = decadeStats(data, 2026).years;
    expect(years.map((y) => y.year)).toEqual([2017,2018,2019,2020,2021,2022,2023,2024,2025,2026]);
  });
  it('per-year figures come from live data (2017 = 1500 / 2 people)', () => {
    const d = parsePortalData({ ...sample, collections: [{ Year: 2017, ID: 'U1', Amount: '1000' }, { Year: 2017, ID: 'U2', Amount: '500' }] })!;
    const y = decadeStats(d, 2026).years.find((x) => x.year === 2017)!;
    expect(y.amount).toBe(1500);
    expect(y.people).toBe(2);
  });
  it('flags the current year and reflects its live (partial) figure, resold excluded', () => {
    const y = decadeStats(data, 2026).years.find((x) => x.year === 2026)!;
    expect(y.current).toBe(true);
    expect(y.amount).toBe(9587);
    expect(y.people).toBe(8);
  });
  it('grand totals sum every year INCLUDING the current live year', () => {
    expect(decadeStats(data, 2026).grandTotal).toBe(9587 + 999 + 12400);
  });
});

describe('journey content (DB-driven)', () => {
  const data = parsePortalData({ journey: [{ Year: 2017, Title: 'Started', 'Title Hindi': 'शुरू' }], tagline: 'Tag', 'Tagline Hindi': 'टैग' });
  it('reads journey entries with bilingual fields', () => {
    expect(journeyEntries(data, 'en')[0].title).toBe('Started');
    expect(journeyEntries(data, 'hi')[0].title).toBe('शुरू');
  });
  it('reads the bilingual tagline', () => {
    expect(journeyTagline(data, 'hi')).toBe('टैग');
  });
  it('degrades to empty when the backend ships nothing', () => {
    const d = parsePortalData({});
    expect(journeyEntries(d, 'en')).toEqual([]);
  });
});

describe('decade i18n placeholders', () => {
  it('interpolates start/end range', () => {
    const s = t('decade_range', 'en', { start: 2017, end: 2026 });
    expect(s).toContain('2017');
    expect(s).toContain('2026');
  });
  it('interpolates the current-year note (all occurrences)', () => {
    const s = t('decade_current_note', 'en', { year: 2026 });
    expect(s).toContain('2026');
  });
  it('interpolates every {count} occurrence in the clarify text', () => {
    const s = t('decade_clarify', 'en', { count: 8 });
    expect(s.split('8').length).toBeGreaterThan(2);
  });
});

describe('summary + years', () => {
  const data = parsePortalData(sample)!;
  it('summary reflects real data', () => {
    const s = computeSummary(data, 2026);
    expect(s.totalCollected).toBe(9587);
    expect(s.expenses).toBe(1503);
    expect(s.contributors).toBe(8);
  });
  it('years are distinct and descending', () => {
    const years = availableYears(data);
    expect(years).toEqual([2026, 2025]);
  });
});

describe('config + i18n', () => {
  it('applies fallbacks and honors provided env', () => {
    const old = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'https://example.test';
    expect(resolveConfig().PUBLIC_API_BASE_URL).toBe('https://example.test');
    process.env.PUBLIC_API_BASE_URL = old;
    expect(DEFAULTS.PUBLIC_API_BASE_URL).toBeDefined();
  });
  it('t falls back en->key and interpolates', () => {
    expect(t('__missing_key__', 'en')).toBe('__missing_key__');
    expect(t('decade_range', 'en', { start: 2017, end: 2026 })).toContain('2017');
  });
  it('localize prefers Hindi column when hi', () => {
    expect(localize({ Name: 'English', 'Name Hindi': 'हिंदी' }, 'Name', 'hi')).toBe('हिंदी');
  });
});

describe('theme default selection', () => {
  it('device dark -> dark default, device light -> light default', () => {
    expect(pickDefaultTheme(true)).toBe(DEFAULT_DARK);
    expect(pickDefaultTheme(false)).toBe(DEFAULT_LIGHT);
  });
  it('no device signal -> random light or dark default (deterministic via rnd)', () => {
    expect(pickDefaultTheme(null, 0.1)).toBe(DEFAULT_LIGHT);
    expect(pickDefaultTheme(null, 0.9)).toBe(DEFAULT_DARK);
  });
  it('validates theme ids', () => {
    expect(isValidThemeId('sunrise')).toBe(true);
    expect(isValidThemeId('does-not-exist')).toBe(false);
  });
});

describe('skin registry coverage', () => {
  it('every gallery theme maps to a known skin id', () => {
    const validSkins = new Set(['premium', 'classic', 'slate', 'aurora', 'festival', 'surya-ghat']);
    for (const t of THEMES) {
      expect(THEME_SKIN_ID[t.id], `theme ${t.id} must map to a skin`).toBeDefined();
      expect(validSkins.has(skinIdForTheme(t.id))).toBe(true);
    }
  });
  it('an unknown theme falls back to the default skin', () => {
    expect(skinIdForTheme('does-not-exist')).toBe(DEFAULT_SKIN_ID);
    expect(skinIdForTheme(null)).toBe(DEFAULT_SKIN_ID);
  });
  it('the shipped themes cover every skin', () => {
    const used = new Set(THEMES.map((t) => skinIdForTheme(t.id)));
    expect(used.size).toBe(6);
    expect(used).toEqual(new Set(['premium', 'classic', 'slate', 'aurora', 'festival', 'surya-ghat']));
  });
});
