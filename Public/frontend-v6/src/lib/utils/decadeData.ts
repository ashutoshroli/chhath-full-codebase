/**
 * Static data for the "10 Years of Chhath" (Decade) story page.
 *
 * These are HISTORICAL narrative figures (2017 → 2025) — not live API data — so
 * every skin renders the exact same numbers. Financial figures are pre-formatted
 * as strings (Indian ₹ grouping) because they are fixed historical records, and
 * the i18n text keys carry all the bilingual prose. 2026 is intentionally NOT a
 * final row here: the year is not complete, so the page shows a disclaimer
 * instead of presenting 2026 as completed historical data.
 */

export interface DecadeYear {
  /** Calendar year. */
  year: string;
  /** i18n key for this year's heading. */
  headingKey: string;
  /** i18n key for this year's narrative paragraph. */
  bodyKey: string;
  /** Pre-formatted total contribution (₹). Null when the year has no final figure (2026). */
  total: string | null;
  /** Recorded contributor entries for the year. Null when not final (2026). */
  contributors: number | null;
}

/** Year-by-year sections shown on the Decade page (2017 → 2026). */
export const DECADE_YEARS: DecadeYear[] = [
  { year: '2017', headingKey: 'decade_y2017_h', bodyKey: 'decade_y2017_p', total: '₹4,213', contributors: 28 },
  { year: '2018', headingKey: 'decade_y2018_h', bodyKey: 'decade_y2018_p', total: '₹6,054', contributors: 28 },
  { year: '2019', headingKey: 'decade_y2019_h', bodyKey: 'decade_y2019_p', total: '₹7,769', contributors: 34 },
  { year: '2020', headingKey: 'decade_y2020_h', bodyKey: 'decade_y2020_p', total: '₹7,941', contributors: 52 },
  { year: '2021', headingKey: 'decade_y2021_h', bodyKey: 'decade_y2021_p', total: '₹12,664', contributors: 63 },
  { year: '2022', headingKey: 'decade_y2022_h', bodyKey: 'decade_y2022_p', total: '₹16,058', contributors: 90 },
  { year: '2023', headingKey: 'decade_y2023_h', bodyKey: 'decade_y2023_p', total: '₹14,799', contributors: 83 },
  { year: '2024', headingKey: 'decade_y2024_h', bodyKey: 'decade_y2024_p', total: '₹33,886', contributors: 127 },
  { year: '2025', headingKey: 'decade_y2025_h', bodyKey: 'decade_y2025_p', total: '₹40,040', contributors: 141 },
  { year: '2026', headingKey: 'decade_y2026_h', bodyKey: 'decade_y2026_p', total: null, contributors: null }
];

/** Compact table rows (2017 → 2025 only — the finalised years). */
export const DECADE_TABLE = DECADE_YEARS.filter((y) => y.total !== null).map((y) => ({
  year: y.year,
  total: y.total as string,
  contributors: y.contributors as number
}));

/** Transparency-medium evolution steps (Paper → … → Portal). */
export const DECADE_TIMELINE = [
  { headingKey: 'decade_tl_paper_h', bodyKey: 'decade_tl_paper_d' },
  { headingKey: 'decade_tl_pdf_h', bodyKey: 'decade_tl_pdf_d' },
  { headingKey: 'decade_tl_wa_h', bodyKey: 'decade_tl_wa_d' },
  { headingKey: 'decade_tl_sheets_h', bodyKey: 'decade_tl_sheets_d' },
  { headingKey: 'decade_tl_portal_h', bodyKey: 'decade_tl_portal_d' }
];

/** The three headline milestones (2017 / 2021 / 2026). */
export const DECADE_MILESTONES = [
  { year: '2017', headingKey: 'decade_ms3_2017_h', bodyKey: 'decade_ms3_2017_d' },
  { year: '2021', headingKey: 'decade_ms3_2021_h', bodyKey: 'decade_ms3_2021_d' },
  { year: '2026', headingKey: 'decade_ms3_2026_h', bodyKey: 'decade_ms3_2026_d' }
];
