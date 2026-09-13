/**
 * Theme registry for the v5 theme gallery.
 *
 * Each theme is a named "skin" derived from one of the project's existing public
 * portals (v1 classic, v2 slate/enterprise, v4 warm-glass) plus tasteful
 * variants. A theme drives a set of CSS custom properties applied on <html>
 * via `data-theme`, and declares whether it is a light or dark base (so the
 * Tailwind `dark:` variants and the live background react correctly).
 *
 * Adding a new theme later = add one entry here + its vars block in app.css.
 * Nothing else in the app needs to change.
 */

export type ThemeMode = 'light' | 'dark';

export interface ThemeDef {
  /** stable id persisted to localStorage */
  id: string;
  /** i18n key for the display name */
  labelKey: string;
  /** light or dark base (controls the `dark` class + bg behaviour) */
  mode: ThemeMode;
  /** which existing portal this look is derived from (for the gallery caption) */
  originKey: string;
  /** small swatch colors for the gallery preview chip: [bg, surface, accent] */
  swatch: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  {
    id: 'sunrise',
    labelKey: 'theme_sunrise',
    mode: 'light',
    originKey: 'theme_origin_v4',
    swatch: ['#FDE7C9', '#ffffff', '#F27A1A']
  },
  {
    id: 'warm-night',
    labelKey: 'theme_warm_night',
    mode: 'dark',
    originKey: 'theme_origin_v4',
    swatch: ['#241033', '#141622', '#FF9F45']
  },
  {
    id: 'classic-light',
    labelKey: 'theme_classic_light',
    mode: 'light',
    originKey: 'theme_origin_v1',
    swatch: ['#F8F9FA', '#ffffff', '#F27A1A']
  },
  {
    id: 'slate-light',
    labelKey: 'theme_slate_light',
    mode: 'light',
    originKey: 'theme_origin_v2',
    swatch: ['#f1f5f9', '#ffffff', '#F27A1A']
  },
  {
    id: 'slate-dark',
    labelKey: 'theme_slate_dark',
    mode: 'dark',
    originKey: 'theme_origin_v2',
    swatch: ['#020617', '#0f172a', '#F58C28']
  },
  {
    id: 'midnight',
    labelKey: 'theme_midnight',
    mode: 'dark',
    originKey: 'theme_origin_v5',
    swatch: ['#0b1020', '#151a2e', '#F5B840']
  }
];

export const DEFAULT_LIGHT = 'sunrise';
export const DEFAULT_DARK = 'warm-night';
export const THEME_KEY = 'cpm_public_v5_theme';

const byId = new Map(THEMES.map((t) => [t.id, t]));

export function getTheme(id: string | null | undefined): ThemeDef | undefined {
  return id ? byId.get(id) : undefined;
}

export function isValidThemeId(id: unknown): id is string {
  return typeof id === 'string' && byId.has(id);
}

/**
 * Pick a default theme for a first-time visitor:
 *  1. device prefers dark  -> DEFAULT_DARK
 *  2. device prefers light -> DEFAULT_LIGHT
 *  3. no clear preference   -> RANDOM light or dark default
 * `prefersDark` is `true|false` when known, or `null` when the device gives no
 * signal (then we fall back to random).
 */
export function pickDefaultTheme(prefersDark: boolean | null, rnd: number = Math.random()): string {
  if (prefersDark === true) return DEFAULT_DARK;
  if (prefersDark === false) return DEFAULT_LIGHT;
  return rnd < 0.5 ? DEFAULT_LIGHT : DEFAULT_DARK;
}
