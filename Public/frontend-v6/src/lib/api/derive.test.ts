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
import { localize } from '$lib/i18n';
import { pickDefaultTheme, isValidThemeId, DEFAULT_LIGHT, DEFAULT_DARK, THEMES } from '$lib/themes';
import { skinIdForTheme, THEME_SKIN_ID, DEFAULT_SKIN_ID } from '$lib/skins/skinMap';

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
  it('parses usable portal data and tolerates unknown fields', () => {
    const data = parsePortalData({ ...sample, extraTopLevel: 1 });
    expect(data).not.toBeNull();
    expect(data!.collections.length).toBe(9);
  });

  it('uses safe empty arrays for malformed sections', () => {
    const data = parsePortalData({ collections: 'not-an-array', committee: [{ Name: 'x' }] });
    expect(data!.collections).toEqual([]);
    expect(data!.committee.length).toBe(1);
  });
});

describe('financial derivations', () => {
  const data = parsePortalData(sample)!;
  const fin = computeFinancials(data, 2026);

  it('computes current-year collection', () => expect(fin.collection).toBe(9587));
  it('computes previous-year loan return with simple monthly interest', () => expect(fin.pastLoanReturned).toBe(12400));
  it('computes budget, expense and available amount', () => {
    expect(fin.totalBudget).toBe(21987);
    expect(fin.totalExpense).toBe(1503);
    expect(fin.netSurplus).toBe(20484);
    expect(fin.available).toBe(20484);
  });
  it('clamps utilization to 0..100', () => {
    expect(fin.utilizedPct).toBeGreaterThanOrEqual(0);
    expect(fin.utilizedPct).toBeLessThanOrEqual(100);
    expect(fin.utilizedPct).toBeCloseTo((1503 / 21987) * 100, 5);
  });
});

describe('loan interest helper', () => {
  it('computes principal, interest and total', () => {
    const r = loanTotalWithInterest({ Amount: '5000', 'Intrest Rate': '1.5', Tenure: '10' });
    expect(r.principal).toBe(5000);
    expect(r.interest).toBe(750);
    expect(r.total).toBe(5750);
  });
});

describe('competition ranking', () => {
  it('uses competition ranking rather than dense ranking', () => {
    const ranks = competitionRank(
      [{ a: 10 }, { a: 10 }, { a: 5 }, { a: 3 }, { a: 3 }, { a: 1 }],
      (x) => x.a
    ).map((r) => r.rank);
    expect(ranks).toEqual([1, 1, 3, 4, 4, 6]);
  });

  it('flags the true top five while preserving entry order', () => {
    const data = parsePortalData(sample)!;
    const ranked = rankedContributors(data, 2026);
    const byName = Object.fromEntries(ranked.map((r) => [r.item.name, r]));
    expect(byName['Ravi Kumar'].rank).toBe(1);
    expect(byName['Sanjeet Kumar'].rank).toBe(1);
    expect(byName['Abhishek Verma'].rank).toBe(3);
    expect(byName['Govind Verma'].rank).toBe(4);
    expect(byName['Pintu Kumar'].rank).toBe(4);
    expect(byName['Aarohi Bharti'].isTop).toBe(false);
    expect(ranked.map((r) => r.item.name)).toEqual([
      'Ravi Kumar', 'Sanjeet Kumar', 'Abhishek Verma', 'Govind Verma',
      'Pintu Kumar', 'Aarohi Bharti', 'Manish Kumar', 'Sunil Das'
    ]);
  });
});

describe('contributors and contribution kinds', () => {
  it('folds repeated contributions and preserves tags', () => {
    const data = parsePortalData({
      users: [{ ID: 'A', Name: 'Multi Giver' }, { ID: 'B', Name: 'Money+Material' }],
      collections: [
        { Year: 2026, ID: 'A', Amount: '300', 'Contribution Type': '1' },
        { Year: 2026, ID: 'A', Amount: '200', 'Contribution Type': '1' },
        { Year: 2026, ID: 'B', Amount: '700', 'Contribution Type': '1' },
        { Year: 2026, ID: 'B', Amount: '0', 'Contribution Type': '2', Detail: 'Soop' }
      ]
    })!;
    const list = contributorsForYear(data, 2026);
    const a = list.find((c) => c.name === 'Multi Giver')!;
    const b = list.find((c) => c.name === 'Money+Material')!;
    expect(a.amount).toBe(500);
    expect(a.count).toBe(2);
    expect(contributorTags(a)).toEqual(['money']);
    expect(b.amount).toBe(700);
    expect(contributorTags(b)).toEqual(['money', 'material']);
  });

  it('keeps material/service contributors unranked', () => {
    const data = parsePortalData({
      users: [{ ID: 'M', Name: 'Material Person' }, { ID: 'S', Name: 'Service Person' }],
      collections: [
        { Year: 2026, ID: 'M', Amount: '0', 'Contribution Type': '2', Detail: 'Soop' },
        { Year: 2026, ID: 'S', Amount: '0', 'Contribution Type': '3', Detail: 'Sound' }
      ]
    })!;
    const ranked = rankedContributors(data, 2026);
    expect(ranked).toHaveLength(2);
    expect(ranked.every((r) => r.rank === 0 && !r.isTop)).toBe(true);
  });
});

describe('resold items and summary', () => {
  const data = parsePortalData({
    users: [{ ID: 'M', Name: 'Money Person' }, { ID: 'X', Name: 'Material Person' }],
    collections: [
      { Year: 2026, ID: 'M', Amount: '1000', 'Contribution Type': '1' },
      { Year: 2026, ID: 'X', Amount: '0', 'Contribution Type': '2', Detail: 'Bamboo soop' },
      { Year: 2026, Name: 'Old Chair', Amount: '500', 'Is Resell': 'TRUE' }
    ]
  })!;

  it('excludes resold rows from contributor totals', () => {
    const summary = computeSummary(data, 2026);
    expect(summary.totalCollected).toBe(1000);
    expect(summary.contributors).toBe(2);
  });

  it('surfaces resold rows separately', () => {
    const items = resoldItemsForYear(data, 2026);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Old Chair');
    expect(items[0].amount).toBe(500);
  });
});

describe('years and decade data', () => {
  const data = parsePortalData(sample)!;

  it('returns available years descending', () => {
    expect(availableYears(data)).toEqual([2026, 2025]);
  });

  it('uses the current derive API for decade statistics', () => {
    const stats = decadeStats(data);
    expect(stats.startYear).toBe(DECADE_START_YEAR);
    expect(stats.years.length).toBeGreaterThan(0);
    expect(stats.years[0].year).toBe(DECADE_START_YEAR);
    const current = stats.years.find((y) => y.isCurrent);
    expect(current).toBeDefined();
  });
});

describe('i18n and theme registry', () => {
  it('localize prefers Hindi when requested', () => {
    expect(localize({ Name: 'English', 'Name (Hindi)': 'हिंदी' }, 'Name', 'hi')).toBe('हिंदी');
  });

  it('validates the built-in theme ids', () => {
    expect(pickDefaultTheme(true)).toBe(DEFAULT_DARK);
    expect(pickDefaultTheme(false)).toBe(DEFAULT_LIGHT);
    expect(isValidThemeId('sunrise')).toBe(true);
    expect(isValidThemeId('does-not-exist')).toBe(false);
  });
});

describe('skin registry coverage', () => {
  const validSkins = new Set(['premium', 'classic', 'slate', 'aurora', 'festival', 'surya-ghat']);

  it('every gallery theme maps to a known skin', () => {
    for (const theme of THEMES) {
      expect(THEME_SKIN_ID[theme.id]).toBeDefined();
      expect(validSkins.has(skinIdForTheme(theme.id))).toBe(true);
    }
  });

  it('unknown themes fall back safely', () => {
    expect(skinIdForTheme('does-not-exist')).toBe(DEFAULT_SKIN_ID);
    expect(skinIdForTheme(null)).toBe(DEFAULT_SKIN_ID);
  });

  it('the gallery currently covers all six shipped skins', () => {
    const used = new Set(THEMES.map((theme) => skinIdForTheme(theme.id)));
    expect(used).toEqual(new Set(['premium', 'classic', 'slate', 'aurora', 'festival', 'surya-ghat']));
  });
});
