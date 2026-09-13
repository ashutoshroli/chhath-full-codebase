/**
 * Pure themeId → skinId mapping (no Svelte imports), so it can be unit-tested
 * and reused by the component registry. The registry resolves these skin ids to
 * the actual Skin objects.
 */
export type SkinId = 'premium' | 'classic' | 'slate' | 'aurora' | 'festival';

export const DEFAULT_SKIN_ID: SkinId = 'premium';

export const THEME_SKIN_ID: Record<string, SkinId> = {
  sunrise: 'premium',
  'warm-night': 'premium',
  midnight: 'premium',
  'classic-light': 'classic',
  'slate-light': 'slate',
  'slate-dark': 'slate',
  aurora: 'aurora',
  festival: 'festival',
  // Gen-Z 2026 themes reuse the aurora skin (glassmorphism + animated mesh +
  // bento layout) with their own palette + live-background tokens.
  'neon-noir': 'aurora',
  'cyber-lime': 'aurora',
  'sunset-vapor': 'aurora',
  'mint-frost': 'aurora'
};

export function skinIdForTheme(themeId: string | null | undefined): SkinId {
  return (themeId && THEME_SKIN_ID[themeId]) || DEFAULT_SKIN_ID;
}
