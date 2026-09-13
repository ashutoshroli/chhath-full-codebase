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
import { classicSkin } from './classic';
import { slateSkin } from './slate';

/** Explicit themeId → skin mapping. Unmapped themes fall back to Premium. */
const THEME_SKIN: Record<string, Skin> = {
  sunrise: premiumSkin,
  'warm-night': premiumSkin,
  midnight: premiumSkin,
  // Classic (v3) skin:
  'classic-light': classicSkin,
  // Slate (v2) skin — light + dark:
  'slate-light': slateSkin,
  'slate-dark': slateSkin
};

export const DEFAULT_SKIN = premiumSkin;

export function skinForTheme(themeId: string | null | undefined): Skin {
  return (themeId && THEME_SKIN[themeId]) || DEFAULT_SKIN;
}
