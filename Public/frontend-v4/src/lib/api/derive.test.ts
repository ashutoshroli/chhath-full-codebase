import { describe, it, expect } from 'vitest';
import { parsePortalData } from './schema';
import {
  computeFinancials,
  contributorsForYear,
  rankedContributors,
  computeSummary,
  availableYears,
  loanTotalWithInterest
} from './derive';
import { competitionRank } from '$lib/utils/ranking';
import { resolveConfig, DEFAULTS } from '$lib/config';
import { t, localize } from '$lib/i18n';

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
    { ID: 'U7', Name: 'Manish Kumar', Village: 'Shaharpura' }
  ],
  collections: [
    { Year: 2026, ID: 'U1', Amount: '2100', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U2', Amount: '2100', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U3', Amount: '1501', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U4', Amount: '1000', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U5', Amount: '1000', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U6', Amount: '786', 'Contribution Type': '1' },
    { Year: 2026, ID: 'U7', Amount: '500', 'Contribution Type': '1' },
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
    // 2100+2100+1501+1000+1000+786+500 = 8987
    expect(fin.collection).toBe(8987);
  });
  it('past loan returned uses previous-year (2025) loans with per-month simple interest', () => {
    // 10000 + 10000*(2/100)*12 = 10000 + 2400 = 12400
    expect(fin.pastLoanReturned).toBe(12400);
  });
  it('total budget = collection + past loan returned', () => {
    expect(fin.totalBudget).toBe(8987 + 12400);
  });
  it('total expense and net surplus', () => {
    expect(fin.totalExpense).toBe(1503);
    expect(fin.netSurplus).toBe(8987 + 12400 - 1503);
    expect(fin.available).toBe(fin.netSurplus);
  });
  it('utilized % is derived and clamped', () => {
    expect(fin.utilizedPct).toBeCloseTo((1503 / (8987 + 12400)) * 100, 5);
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
    expect(c2026.length).toBe(7);
    const c2025 = contributorsForYear(data, 2025);
    expect(c2025.length).toBe(1);
    expect(c2025[0].amount).toBe(999);
  });
});

describe('summary + years', () => {
  const data = parsePortalData(sample)!;
  it('summary reflects real data', () => {
    const s = computeSummary(data, 2026);
    expect(s.contributors).toBe(7);
    expect(s.totalCollected).toBe(8987);
    expect(s.average).toBe(Math.round(8987 / 7));
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
    expect(t('en', 'contributors_live_scroll', { year: 2026 })).toBe('Contributors 2026 — Live Scroll');
    expect(t('en', '__missing__')).toBe('__missing__');
  });
  it('localize prefers Hindi column when hi', () => {
    const row = { Name: 'Ravi', 'Name (Hindi)': 'रवि' };
    expect(localize(row, 'Name', 'en')).toBe('Ravi');
    expect(localize(row, 'Name', 'hi')).toBe('रवि');
    expect(localize({ Name: 'OnlyEn' }, 'Name', 'hi')).toBe('OnlyEn');
  });
});
