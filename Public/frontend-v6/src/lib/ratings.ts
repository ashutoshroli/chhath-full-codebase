/**
 * Age-rating registry (IARC) — the SINGLE source of truth for the app's age
 * ratings, shared by two very different consumers:
 *
 *   1. `vite.config.ts`  -> `iarc_rating_id` in the generated web app manifest,
 *      which is how the Microsoft Store / Google Play / PWABuilder pick up the
 *      already-issued IARC certificate instead of asking for the questionnaire
 *      again.
 *   2. `AgeRatings.svelte` -> the "Age ratings" block on the public /guide page.
 *
 * Because the manifest is built from this file too, the ID can never drift
 * between what the stores read and what the portal shows. Keep this module
 * DEPENDENCY-FREE (no `$lib` aliases, no browser globals): vite.config.ts loads
 * it while the Vite config itself is still being evaluated.
 *
 * Retaking the IARC questionnaire? Update IARC_RATING_ID / IARC_VERSION and the
 * affected rows below — nothing else in the app needs to change.
 */

/** IARC certificate ID issued for this app (Partner Center -> "Current Rating ID"). */
export const IARC_RATING_ID = 'f043e610-f55b-8cfc-8ef0-3f9268e38684';

/** Version of the IARC questionnaire the ratings were generated from. */
export const IARC_VERSION = '10.3';

/** Where a rating came from: the IARC certificate, or a storefront mapping. */
export type RatingSource = 'iarc' | 'microsoft';

export interface RatingEntry {
  /** stable id (also the keying value in the {#each}) */
  id: string;
  /** short system name shown as the card title, e.g. "ESRB" (not translated) */
  system: string;
  /** the mark printed on the certificate, e.g. "TE", "L", "E", "3+", "0" */
  mark: string;
  /** i18n key — full name of the rating body */
  bodyKey: string;
  /** i18n key — country / region the body covers */
  regionKey: string;
  /** i18n key — the rating description ("All ages" / "Everyone" / "3+") */
  descKey: string;
  /** who issued this row */
  source: RatingSource;
}

/**
 * The eight ratings generated from the IARC questionnaire, in the same order
 * Partner Center lists them (alphabetical by rating system). No interactive
 * elements were declared — this portal is a read-only dashboard.
 */
export const AGE_RATINGS: RatingEntry[] = [
  {
    id: 'ccc',
    system: 'CCC',
    mark: 'TE',
    bodyKey: 'rating_ccc_body',
    regionKey: 'rating_ccc_region',
    descKey: 'rating_desc_all_ages',
    source: 'microsoft'
  },
  {
    id: 'djctq',
    system: 'DJCTQ',
    mark: 'L',
    bodyKey: 'rating_djctq_body',
    regionKey: 'rating_djctq_region',
    descKey: 'rating_desc_all_ages',
    source: 'iarc'
  },
  {
    id: 'esrb',
    system: 'ESRB',
    mark: 'E',
    bodyKey: 'rating_esrb_body',
    regionKey: 'rating_esrb_region',
    descKey: 'rating_desc_everyone',
    source: 'iarc'
  },
  {
    id: 'iarc',
    system: 'IARC',
    mark: '3+',
    bodyKey: 'rating_iarc_body',
    regionKey: 'rating_iarc_region',
    descKey: 'rating_desc_3plus',
    source: 'iarc'
  },
  {
    id: 'microsoft',
    system: 'Microsoft',
    mark: '3',
    bodyKey: 'rating_ms_body',
    regionKey: 'rating_ms_region',
    descKey: 'rating_desc_3plus',
    source: 'microsoft'
  },
  {
    id: 'pcbp',
    system: 'PCBP',
    mark: '0+',
    bodyKey: 'rating_pcbp_body',
    regionKey: 'rating_pcbp_region',
    descKey: 'rating_desc_all_ages',
    source: 'iarc'
  },
  {
    id: 'pegi',
    system: 'PEGI',
    mark: '3',
    bodyKey: 'rating_pegi_body',
    regionKey: 'rating_pegi_region',
    descKey: 'rating_desc_3plus',
    source: 'iarc'
  },
  {
    id: 'usk',
    system: 'USK',
    mark: '0',
    bodyKey: 'rating_usk_body',
    regionKey: 'rating_usk_region',
    descKey: 'rating_desc_everyone',
    source: 'iarc'
  }
];

/** i18n key for a row's source label. */
export function sourceKey(source: RatingSource): string {
  return source === 'microsoft' ? 'rating_src_ms' : 'rating_src_iarc';
}
