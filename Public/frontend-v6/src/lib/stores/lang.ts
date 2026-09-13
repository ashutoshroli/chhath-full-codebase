/**
 * Language store (en/hi). Persisted under cpm_public_lang (shared semantics with
 * the other frontends). Exposes a derived `tr` helper store so components can do
 * `$tr('nav_home')` reactively.
 */
import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { LANG_KEY, normalizeLang, t as translate, type Lang } from '$lib/i18n';

function initial(): Lang {
  if (!browser) return 'en';
  try {
    return normalizeLang(localStorage.getItem(LANG_KEY));
  } catch {
    return 'en';
  }
}

function createLang() {
  const { subscribe, set, update } = writable<Lang>(initial());

  function apply(l: Lang) {
    if (!browser) return;
    try {
      localStorage.setItem(LANG_KEY, l);
      document.documentElement.setAttribute('lang', l);
    } catch {
      /* ignore */
    }
  }

  return {
    subscribe,
    set(l: Lang) {
      apply(l);
      set(l);
    },
    toggle() {
      update((l) => {
        const next: Lang = l === 'hi' ? 'en' : 'hi';
        apply(next);
        return next;
      });
    }
  };
}

export const lang = createLang();

/** Reactive translator: `$tr('key', { vars })`. */
export const tr = derived(lang, ($lang) => (key: string, vars?: Record<string, string | number>) =>
  translate($lang, key, vars)
);
