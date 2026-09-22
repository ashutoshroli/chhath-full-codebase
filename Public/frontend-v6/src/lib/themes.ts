/** Theme registry. Adding a theme requires one entry plus its visual token block/skin mapping. */
export type ThemeMode = 'light' | 'dark';

export interface ThemeDef {
  id: string;
  labelKey: string;
  mode: ThemeMode;
  originKey: string;
  swatch: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  { id: 'sunrise', labelKey: 'theme_sunrise', mode: 'light', originKey: 'theme_origin_v4', swatch: ['#FDE7C9', '#ffffff', '#F27A1A'] },
  { id: 'warm-night', labelKey: 'theme_warm_night', mode: 'dark', originKey: 'theme_origin_v4', swatch: ['#241033', '#141622', '#FF9F45'] },
  { id: 'classic-light', labelKey: 'theme_classic_light', mode: 'light', originKey: 'theme_origin_v1', swatch: ['#F8F9FA', '#ffffff', '#F27A1A'] },
  { id: 'slate-light', labelKey: 'theme_slate_light', mode: 'light', originKey: 'theme_origin_v2', swatch: ['#f1f5f9', '#ffffff', '#F27A1A'] },
  { id: 'slate-dark', labelKey: 'theme_slate_dark', mode: 'dark', originKey: 'theme_origin_v2', swatch: ['#020617', '#0f172a', '#F58C28'] },
  { id: 'midnight', labelKey: 'theme_midnight', mode: 'dark', originKey: 'theme_origin_v5', swatch: ['#0b1020', '#151a2e', '#F5B840'] },
  { id: 'aurora', labelKey: 'theme_aurora', mode: 'dark', originKey: 'theme_origin_new', swatch: ['#0a0f1e', '#141b30', '#7c5cff'] },
  { id: 'festival', labelKey: 'theme_festival', mode: 'light', originKey: 'theme_origin_new', swatch: ['#fff6e6', '#fffdf7', '#B01E2E'] },
  { id: 'neon-noir', labelKey: 'theme_neon_noir', mode: 'dark', originKey: 'theme_origin_genz', swatch: ['#05060a', '#0d1017', '#22d3ee'] },
  { id: 'cyber-lime', labelKey: 'theme_cyber_lime', mode: 'dark', originKey: 'theme_origin_genz', swatch: ['#070b06', '#0e1510', '#a3e635'] },
  { id: 'sunset-vapor', labelKey: 'theme_sunset_vapor', mode: 'dark', originKey: 'theme_origin_genz', swatch: ['#180b2e', '#241141', '#ff5db1'] },
  { id: 'mint-frost', labelKey: 'theme_mint_frost', mode: 'dark', originKey: 'theme_origin_genz', swatch: ['#04120f', '#0a1c18', '#2dd4bf'] },
  { id: 'executive-pro', labelKey: 'theme_executive_pro', mode: 'light', originKey: 'theme_origin_corporate', swatch: ['#f8fafc', '#ffffff', '#2563eb'] },
  { id: 'midnight-glass', labelKey: 'theme_midnight_glass', mode: 'dark', originKey: 'theme_origin_genz', swatch: ['#0b1120', '#1e293b', '#38bdf8'] },
  { id: 'pastel-zen', labelKey: 'theme_pastel_zen', mode: 'light', originKey: 'theme_origin_calm', swatch: ['#fafafa', '#ffffff', '#f97316'] },
  { id: 'heritage-serif', labelKey: 'theme_heritage_serif', mode: 'light', originKey: 'theme_origin_heritage', swatch: ['#fdfbf7', '#ffffff', '#064e3b'] },
  { id: 'festival-dark', labelKey: 'theme_festival_dark', mode: 'dark', originKey: 'theme_origin_new', swatch: ['#1a0d10', '#2a1418', '#f5b840'] },
  { id: 'heritage-serif-dark', labelKey: 'theme_heritage_serif_dark', mode: 'dark', originKey: 'theme_origin_heritage', swatch: ['#0f1211', '#1a201d', '#d97706'] },
  { id: 'surya-ghat', labelKey: 'Surya Ghat', mode: 'dark', originKey: 'theme_origin_new', swatch: ['#04111a', '#091822', '#ea4'] }
];

export const DEFAULT_LIGHT = 'sunrise';
export const DEFAULT_DARK = 'warm-night';
export const THEME_KEY = 'cpm_public_v5_theme';

const byId = new Map(THEMES.map((t) => [t.id, t]));
export function getTheme(id: string | null | undefined): ThemeDef | undefined { return id ? byId.get(id) : undefined; }
export function isValidThemeId(id: unknown): id is string { return typeof id === 'string' && byId.has(id); }
export function pickDefaultTheme(prefersDark: boolean | null, rnd: number = Math.random()): string {
  if (prefersDark === true) return DEFAULT_DARK;
  if (prefersDark === false) return DEFAULT_LIGHT;
  return rnd < 0.5 ? DEFAULT_LIGHT : DEFAULT_DARK;
}
