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
  },
  {
    // Brand-new (v6): modern glassmorphism with an animated aurora mesh and a
    // bento-grid dashboard.
    id: 'aurora',
    labelKey: 'theme_aurora',
    mode: 'dark',
    originKey: 'theme_origin_new',
    swatch: ['#0a0f1e', '#141b30', '#7c5cff']
  },
  {
    // Brand-new (v6): rich festive look — deep maroon + marigold gold, decorative
    // borders and celebratory cards.
    id: 'festival',
    labelKey: 'theme_festival',
    mode: 'light',
    originKey: 'theme_origin_new',
    swatch: ['#fff6e6', '#fffdf7', '#B01E2E']
  },
  {
    // Gen-Z 2026: dark glassmorphism, true-black canvas + neon cyan accent.
    id: 'neon-noir',
    labelKey: 'theme_neon_noir',
    mode: 'dark',
    originKey: 'theme_origin_genz',
    swatch: ['#05060a', '#0d1017', '#22d3ee']
  },
  {
    // Gen-Z 2026: near-black + electric lime — high-energy, high-contrast.
    id: 'cyber-lime',
    labelKey: 'theme_cyber_lime',
    mode: 'dark',
    originKey: 'theme_origin_genz',
    swatch: ['#070b06', '#0e1510', '#a3e635']
  },
  {
    // Gen-Z 2026: vaporwave aurora — deep indigo -> pink -> orange gradient.
    id: 'sunset-vapor',
    labelKey: 'theme_sunset_vapor',
    mode: 'dark',
    originKey: 'theme_origin_genz',
    swatch: ['#180b2e', '#241141', '#ff5db1']
  },
  {
    // Gen-Z 2026: cool dark-glass with a fresh mint/teal accent.
    id: 'mint-frost',
    labelKey: 'theme_mint_frost',
    mode: 'dark',
    originKey: 'theme_origin_genz',
    swatch: ['#04120f', '#0a1c18', '#2dd4bf']
  },
  {
    // Corporate / fintech clean — flat white surfaces + trust-blue accent (slate skin).
    id: 'executive-pro',
    labelKey: 'theme_executive_pro',
    mode: 'light',
    originKey: 'theme_origin_corporate',
    swatch: ['#f8fafc', '#ffffff', '#2563eb']
  },
  {
    // Premium dark glassmorphism — slate glass + cyan accent (aurora skin).
    id: 'midnight-glass',
    labelKey: 'theme_midnight_glass',
    mode: 'dark',
    originKey: 'theme_origin_genz',
    swatch: ['#0b1120', '#1e293b', '#38bdf8']
  },
  {
    // Minimalist community light — soft neutral surfaces + soft-orange accent (premium skin).
    id: 'pastel-zen',
    labelKey: 'theme_pastel_zen',
    mode: 'light',
    originKey: 'theme_origin_calm',
    swatch: ['#fafafa', '#ffffff', '#f97316']
  },
  {
    // Editorial / cultural trust — cream canvas + deep-forest-green accent (festival skin).
    id: 'heritage-serif',
    labelKey: 'theme_heritage_serif',
    mode: 'light',
    originKey: 'theme_origin_heritage',
    swatch: ['#fdfbf7', '#ffffff', '#064e3b']
  },
  {
    // Festival Dark — the festive maroon/gold scheme on a dark maroon-charcoal
    // canvas (festival skin).
    id: 'festival-dark',
    labelKey: 'theme_festival_dark',
    mode: 'dark',
    originKey: 'theme_origin_new',
    swatch: ['#1a0d10', '#2a1418', '#f5b840']
  },
  {
    // Heritage Serif Dark — the editorial serif look on a deep charcoal canvas,
    // forest green + antique gold (festival skin).
    id: 'heritage-serif-dark',
    labelKey: 'theme_heritage_serif_dark',
    mode: 'dark',
    originKey: 'theme_origin_heritage',
    swatch: ['#0f1211', '#1a201d', '#d97706']
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
