/**
 * Story text for the "10 Years of Chhath" (Our Journey) page.
 *
 * These carry only the NARRATIVE (bilingual headings + paragraphs) for each
 * year and section — NOT any numbers. Every financial/contributor figure and
 * the year range are derived live from the real portal data (see
 * `decadeStats()` in `$lib/api/derive`), so the page always reflects the sheet
 * and extends itself each year automatically.
 */

export interface DecadeYearStory {
  /** Calendar year. */
  year: string;
  /** i18n key for this year's heading. */
  headingKey: string;
  /** i18n key for this year's narrative paragraph. */
  bodyKey: string;
}

/** Year-by-year narrative sections shown on the Our Journey page. The numbers
 *  for each year are looked up live by year from `decadeStats()`. */
export const DECADE_YEARS: DecadeYearStory[] = [
  { year: '2017', headingKey: 'decade_y2017_h', bodyKey: 'decade_y2017_p' },
  { year: '2018', headingKey: 'decade_y2018_h', bodyKey: 'decade_y2018_p' },
  { year: '2019', headingKey: 'decade_y2019_h', bodyKey: 'decade_y2019_p' },
  { year: '2020', headingKey: 'decade_y2020_h', bodyKey: 'decade_y2020_p' },
  { year: '2021', headingKey: 'decade_y2021_h', bodyKey: 'decade_y2021_p' },
  { year: '2022', headingKey: 'decade_y2022_h', bodyKey: 'decade_y2022_p' },
  { year: '2023', headingKey: 'decade_y2023_h', bodyKey: 'decade_y2023_p' },
  { year: '2024', headingKey: 'decade_y2024_h', bodyKey: 'decade_y2024_p' },
  { year: '2025', headingKey: 'decade_y2025_h', bodyKey: 'decade_y2025_p' },
  { year: '2026', headingKey: 'decade_y2026_h', bodyKey: 'decade_y2026_p' }
];

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
