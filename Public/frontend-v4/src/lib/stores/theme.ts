/**
 * Theme store (light/dark). The initial class is set by the no-flash script in
 * app.html BEFORE first paint; this store keeps Svelte in sync and persists the
 * choice under the same key the other frontends use (cpm_public_theme).
 */
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';
const THEME_KEY = 'cpm_public_theme';

function initial(): Theme {
  if (!browser) return 'light';
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function createTheme() {
  const { subscribe, set, update } = writable<Theme>(initial());

  function apply(theme: Theme) {
    if (!browser) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }

  return {
    subscribe,
    set(theme: Theme) {
      apply(theme);
      set(theme);
    },
    toggle() {
      update((t) => {
        const next: Theme = t === 'dark' ? 'light' : 'dark';
        apply(next);
        return next;
      });
    }
  };
}

export const theme = createTheme();
