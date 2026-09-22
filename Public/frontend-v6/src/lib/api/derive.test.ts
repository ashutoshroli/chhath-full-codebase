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

/* ... existing behavioural tests remain unchanged ... */

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
  });

  it('the shipped themes are split across the available skins', () => {
    const skins = new Set(THEMES.map((t) => skinIdForTheme(t.id)));
    expect(skins.size).toBeGreaterThanOrEqual(5);
  });
});
