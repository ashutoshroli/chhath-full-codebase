/**
 * Static narrative for the "10 Years of Chhath" (Our Journey) page.
 *
 * The YEAR-BY-YEAR story (each year's title + paragraph) is NO LONGER here — it
 * is DB-driven now (journey_entries, editable from the mgmt "Journey Content"
 * tab) and fetched via `journeyEntries()` in `$lib/api/derive`. The tagline is
 * DB-driven too (journeyTagline()). Every financial/contributor figure and the
 * year range are derived live from the real portal data via `decadeStats()`.
 *
 * All the prose (intro, origin, evolution timeline, milestones, closing, …) is
 * DB-driven now via journey_page_text_en/_hi in portal_settings, read by
 * `journeyText()` with the i18n strings as fallback. This file keeps only the
 * milestone ANCHOR list (the 3 years + their i18n fallback keys); the timeline
 * steps are enumerated inline in each Decade skin (a fixed 5-step list).
 */

/** The three headline milestones (2017 / 2021 / 2026) — anchors + i18n fallback
 *  keys; live text comes from journeyText() keyed by `ms_<year>_h/_d`. */
export const DECADE_MILESTONES = [
  { year: '2017', headingKey: 'decade_ms3_2017_h', bodyKey: 'decade_ms3_2017_d' },
  { year: '2021', headingKey: 'decade_ms3_2021_h', bodyKey: 'decade_ms3_2021_d' },
  { year: '2026', headingKey: 'decade_ms3_2026_h', bodyKey: 'decade_ms3_2026_d' }
];
