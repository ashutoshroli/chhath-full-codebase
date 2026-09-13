/**
 * Static narrative for the "10 Years of Chhath" (Our Journey) page.
 *
 * The YEAR-BY-YEAR story (each year's title + paragraph) is NO LONGER here — it
 * is DB-driven now (journey_entries, editable from the mgmt "Journey Content"
 * tab) and fetched via `journeyEntries()` in `$lib/api/derive`. The tagline is
 * DB-driven too (journeyTagline()). Every financial/contributor figure and the
 * year range are derived live from the real portal data via `decadeStats()`.
 *
 * What remains here is the fixed narrative that is NOT year-keyed: the
 * transparency-medium evolution timeline (Paper → … → Portal) and the three
 * headline milestones — these stay in i18n by design.
 */

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
