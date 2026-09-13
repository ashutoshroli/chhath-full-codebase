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
  DECADE_START_YEAR
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
    // 2100+2100+1501+1000+1000+786+500+600 = 9587
    expect(fin.collection).toBe(9587);
  });
  it('past loan returned uses previous-year (2025) loans with per-month simple interest', () => {
    // 10000 + 10000*(2/100)*12 = 10000 + 2400 = 12400
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
    // Below top-5: still ranked, but NOT flagged as top.
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
    // Data entry order is U1..U8. Even though U8(Sunil,600) > U7(Manish,500),
    // and the top-5 have the biggest amounts, display stays in entry order.
    expect(names).toEqual([
      'Ravi Kumar',
      'Sanjeet Kumar',
      'Abhishek Verma',
      'Govind Verma',
      'Pintu Kumar',
      'Aarohi Bharti',
      'Manish Kumar',
      'Sunil Das'
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
    expect(ranked.length).toBe(3); // money + material + service, NOT the resell row
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
    expect(s.totalCollected).toBe(1000); // 500 resell excluded, material/service = 0
  });

  it('resold rows are NOT in the contributor count', () => {
    const s = computeSummary(data, 2026);
    expect(s.contributors).toBe(3); // money + material + service only
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
      // A gave money twice -> amounts sum, count = 2, single 'money' tag.
      { Year: 2026, ID: 'A', Amount: '300', 'Contribution Type': '1' },
      { Year: 2026, ID: 'A', Amount: '200', 'Contribution Type': '1' },
      // B gave money AND material -> hasMoney + material tag.
      { Year: 2026, ID: 'B', Amount: '700', 'Contribution Type': '1' },
      { Year: 2026, ID: 'B', Amount: '0', 'Contribution Type': '2', Detail: 'Soop' },
      // C gave material AND service, no money -> both tags, no money.
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
  const currentYear = new Date().getFullYear();
  const data = parsePortalData({
    collections: [
      // A finalised historical year.
      { Year: 2017, ID: 'A', Amount: '1000', 'Contribution Type': '1' },
      { Year: 2017, ID: 'B', Amount: '500', 'Contribution Type': '1' },
      // The current (still-open) year — should be included live.
      { Year: currentYear, ID: 'A', Amount: '300', 'Contribution Type': '1' },
      // A resold row in the current year — excluded from count + total.
      { Year: currentYear, Name: 'Old Table', Amount: '999', 'Is Resell': 'TRUE' }
    ]
  })!;
  const d = decadeStats(data);

  it('starts at the fixed founding year and ends at the current year', () => {
    expect(d.startYear).toBe(DECADE_START_YEAR); // 2017
    expect(d.endYear).toBe(currentYear);
    expect(d.currentYear).toBe(currentYear);
  });

  it('produces a contiguous row per year from start to end', () => {
    expect(d.years[0].year).toBe(DECADE_START_YEAR);
    expect(d.years[d.years.length - 1].year).toBe(currentYear);
    expect(d.years.length).toBe(currentYear - DECADE_START_YEAR + 1);
  });

  it('per-year figures come from live data (2017 = 1500 / 2 people)', () => {
    const y2017 = d.years.find((y) => y.year === 2017)!;
    expect(y2017.total).toBe(1500);
    expect(y2017.contributors).toBe(2);
    expect(y2017.isCurrent).toBe(false);
  });

  it('flags the current year and reflects its live (partial) figure, resold excluded', () => {
    const cur = d.years.find((y) => y.year === currentYear)!;
    expect(cur.isCurrent).toBe(true);
    expect(cur.total).toBe(300); // 999 resold excluded
    expect(cur.contributors).toBe(1); // resold row is not a contributor
  });

  it('grand totals sum every year INCLUDING the current live year', () => {
    expect(d.grandTotal).toBe(1800); // 1500 + 300
    expect(d.grandContributors).toBe(3); // 2 + 1
  });
});

describe('decade i18n placeholders', () => {
  it('interpolates start/end range', () => {
    expect(t('en', 'decade_years', { start: 2017, end: 2027 })).toBe('2017 → 2027');
    expect(t('en', 'decade_table_h', { start: 2017, end: 2027 })).toBe('2017 → 2027 — Our Financial Journey');
  });
  it('interpolates the current-year note (all occurrences)', () => {
    expect(t('en', 'decade_current_note_h', { year: 2027 })).toBe('The 2027 financial records are not final yet');
  });
  it('interpolates every {count} occurrence in the clarify text', () => {
    const s = t('en', 'decade_total_clarify', { count: 700 });
    expect(s.includes('{count}')).toBe(false);
    expect(s.startsWith('700')).toBe(true);
  });
});

describe('summary + years', () => {
  const data = parsePortalData(sample)!;
  it('summary reflects real data', () => {
    const s = computeSummary(data, 2026);
    expect(s.contributors).toBe(8);
    expect(s.totalCollected).toBe(9587);
    expect(s.average).toBe(Math.round(9587 / 8));
    expect(s.recordedPct).toBe(100);
  });
  it('years are distinct and descending', () => {
    expect(availableYears(data)).toEqual([2026, 2025]);
  });
});

describe('config + i18n', () => {
  it('applies fallbacks and honors provided env', () => {
    expect(resolveConfig({}).apiBase).toBe(DEFAULTS.PUBLIC_API_BASE);
    expect(resolveConfig({ PUBLIC_API_BASE: 'https://x.test/' }).apiBase).toBe('https://x.test');
  });
  it('t falls back en->key and interpolates', () => {
    expect(t('en', 'nav_home')).toBe('Home');
    expect(t('hi', 'nav_home')).toBe('होम');
    expect(t('en', 'contributors_live_scroll', { year: 2026 })).toBe('Contributors 2026');
    expect(t('en', '__missing__')).toBe('__missing__');
  });
  it('localize prefers Hindi column when hi', () => {
    const row = { Name: 'Ravi', 'Name (Hindi)': 'रवि' };
    expect(localize(row, 'Name', 'en')).toBe('Ravi');
    expect(localize(row, 'Name', 'hi')).toBe('रवि');
    expect(localize({ Name: 'OnlyEn' }, 'Name', 'hi')).toBe('OnlyEn');
  });
});

describe('theme default selection', () => {
  it('device dark -> dark default, device light -> light default', () => {
    expect(pickDefaultTheme(true)).toBe(DEFAULT_DARK);
    expect(pickDefaultTheme(false)).toBe(DEFAULT_LIGHT);
  });
  it('no device signal -> random light or dark default (deterministic via rnd)', () => {
    expect(pickDefaultTheme(null, 0.2)).toBe(DEFAULT_LIGHT);
    expect(pickDefaultTheme(null, 0.8)).toBe(DEFAULT_DARK);
  });
  it('validates theme ids', () => {
    expect(isValidThemeId('sunrise')).toBe(true);
    expect(isValidThemeId('warm-night')).toBe(true);
    expect(isValidThemeId('nope')).toBe(false);
    expect(isValidThemeId(null)).toBe(false);
  });
});

describe('skin registry coverage', () => {
  it('every gallery theme maps to a known skin id', () => {
    const validSkins = new Set(['premium', 'classic', 'slate', 'aurora', 'festival']);
    for (const t of THEMES) {
      expect(THEME_SKIN_ID[t.id], `theme ${t.id} must map to a skin`).toBeDefined();
      expect(validSkins.has(skinIdForTheme(t.id))).toBe(true);
    }
  });
  it('an unknown theme falls back to the default skin', () => {
    expect(skinIdForTheme('does-not-exist')).toBe(DEFAULT_SKIN_ID);
    expect(skinIdForTheme(null)).toBe(DEFAULT_SKIN_ID);
  });
  it('the six themes shipped are split across all five skins', () => {
    const used = new Set(THEMES.map((t) => skinIdForTheme(t.id)));
    expect(used.has('premium')).toBe(true);
    expect(used.has('classic')).toBe(true);
    expect(used.has('slate')).toBe(true);
    expect(used.has('aurora')).toBe(true);
    expect(used.has('festival')).toBe(true);
  });
});
