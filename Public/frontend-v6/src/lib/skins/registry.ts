/**
 * Theme → Skin registry.
 *
 * Many themes can share one skin (e.g. Sunrise / Warm Night / Midnight are all
 * the Premium layout in different palettes). Later phases add the `classic`
 * (v3) and `slate` (v2) skins plus brand-new skins; until then every theme
 * falls back to Premium so the app always renders.
 */
import type { Skin } from './types';
import { premiumSkin } from './premium';

/** Explicit themeId → skin mapping. Unmapped themes fall back to Premium. */
const THEME_SKIN: Record<string, Skin> = {
  sunrise: premiumSkin,
  'warm-night': premiumSkin,
  midnight: premiumSkin,
  // Phase 2/3 will point these at the classic / slate skins:
  'classic-light': premiumSkin,
  'slate-light': premiumSkin,
  'slate-dark': premiumSkin
};

export const DEFAULT_SKIN = premiumSkin;

export function skinForTheme(themeId: string | null | undefined): Skin {
  return (themeId && THEME_SKIN[themeId]) || DEFAULT_SKIN;
}
