/**
 * Theme store (v5) — named multi-theme, not a simple light/dark boolean.
 *
 * - The initial theme is applied by the no-flash script in app.html BEFORE
 *   first paint (saved theme id, else device dark/light, else random).
 * - This store keeps Svelte in sync, persists the chosen id, and applies both
 *   `data-theme="<id>"` and the `dark` class (for Tailwind dark: variants) on
 *   <html>.
 */
import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import {
  THEME_KEY,
  getTheme,
  isValidThemeId,
  pickDefaultTheme,
  DEFAULT_LIGHT,
  type ThemeDef
} from '$lib/themes';

function devicePrefersDark(): boolean | null {
  if (!browser || !window.matchMedia) return null;
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return true;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return false;
  return null;
}

function initialId(): string {
  if (!browser) return DEFAULT_LIGHT;
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (isValidThemeId(saved)) return saved;
  } catch {
    /* ignore */
  }
  return pickDefaultTheme(devicePrefersDark());
}

function apply(id: string) {
  if (!browser) return;
  const theme = getTheme(id);
  if (!theme) return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  root.classList.toggle('dark', theme.mode === 'dark');
  try {
    localStorage.setItem(THEME_KEY, theme.id);
  } catch {
    /* ignore */
  }
}

function createTheme() {
  const { subscribe, set } = writable<string>(initialId());
  return {
    subscribe,
    /** Apply + persist a theme by id (used by the gallery "Apply"). */
    select(id: string) {
      if (!isValidThemeId(id)) return;
      apply(id);
      set(id);
    }
  };
}

export const themeId = createTheme();

/** The full ThemeDef for the active theme (for components that need mode etc.). */
export const activeTheme = derived(themeId, ($id): ThemeDef | undefined => getTheme($id));
