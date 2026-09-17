<script lang="ts">
  /**
   * Slate skin shell — the v2 "enterprise" look: clean slate surfaces, bordered
   * rounded-2xl cards, a sticky top bar with an inline nav, no live gradient.
   * Works in both Slate Light and Slate Dark (Tailwind dark: driven by the
   * theme's `dark` class). Uses the shared stores + ThemeGallery opener.
   */
  import { page } from '$app/stores';
  import { Palette, Languages, Heart } from '@lucide/svelte';
  import { lang, tr } from '$lib/stores/lang';
  import { openThemeGallery } from '$lib/stores/ui';
  import { NAV_ITEMS, NAV_PRIMARY } from '$lib/components/nav';
  import MoreMenu from '$lib/components/MoreMenu.svelte';
  import YearSelect from '$lib/components/YearSelect.svelte';
  import StatusBanner from '$lib/components/StatusBanner.svelte';
  import FooterLinks from '$lib/components/FooterLinks.svelte';

  let { children } = $props();
  const isActive = (href: string, path: string) =>
    href === '/' ? path === '/' : path.startsWith(href);
</script>

<!-- audit PR-41: a skip link. Every one of these shells puts a header, a language
     switcher, a theme picker and a primary nav ahead of the content, so a keyboard or
     switch-access visitor had to Tab through all of it on EVERY page before reaching what they
     came for (WCAG 2.4.1). Visually hidden until focused, so nothing changes for anyone else. -->
<a
  href="#main"
  class="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg
    focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
>{$tr('skip_to_content')}</a>


<!-- Flat slate background -->
<div class="fixed inset-0 -z-10 bg-slate-100 dark:bg-slate-950"></div>

<header
  class="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md
    dark:border-slate-800 dark:bg-slate-950/90"
>
  <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
    <a href="/" class="flex min-w-0 items-center gap-2.5" aria-label={$tr('app_title')}>
      <img src="/logo.svg" alt="" width="36" height="36" class="h-9 w-9 flex-none rounded-lg" />
      <span class="min-w-0 leading-tight">
        <span class="block truncate text-sm font-bold text-slate-900 dark:text-white">{$tr('app_title')}</span>
        <span class="text-[0.68rem] text-slate-500 dark:text-slate-400">{$tr('app_subtitle')}</span>
      </span>
    </a>

    <nav class="ml-3 hidden items-center gap-1 md:flex" aria-label="Primary">
      {#each NAV_ITEMS as item}
        {@const active = isActive(item.href, $page.url.pathname)}
        <a
          href={item.href}
          aria-current={active ? 'page' : undefined}
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors
            {active
              ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}"
        >
          {$tr(item.key)}
        </a>
      {/each}
    </nav>

    <div class="ml-auto flex flex-none items-center gap-1.5">
      <button
        class="grid h-9 w-9 place-items-center rounded-lg border border-slate-300 text-slate-600 transition
          hover:bg-slate-100 active:scale-95 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        onclick={() => openThemeGallery()}
        aria-label={$tr('choose_theme')}
        title={$tr('choose_theme')}
      >
        <Palette class="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-sm font-semibold text-slate-600 transition
          hover:bg-slate-100 active:scale-95 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        onclick={() => lang.toggle()}
        aria-label={$tr('toggle_language')}
        title={$tr('toggle_language')}
      >
        <Languages class="h-4 w-4" aria-hidden="true" />
        <span class="hidden xs:inline">{$lang === 'hi' ? 'English' : 'हिंदी'}</span>
      </button>
      <YearSelect />
    </div>
  </div>
</header>

<StatusBanner />

<main id="main" tabindex="-1" class="mx-auto max-w-6xl px-4 pb-24 pt-5 md:pb-10">
  {@render children()}
</main>

<footer
  class="mx-auto max-w-6xl border-t border-slate-200 px-4 py-6 pb-24 text-center text-xs text-slate-500
    dark:border-slate-800 dark:text-slate-400 md:pb-6"
>
  <p>{$tr('org_name')}, {$tr('org_location')}</p>
  <p class="mt-1 flex items-center justify-center gap-1">
    {$tr('seva_line')} <Heart class="h-3.5 w-3.5 fill-current text-danger" />
  </p>
  <FooterLinks />
</footer>

<!-- Mobile bottom nav (slate style) -->
<nav
  class="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-slate-200 bg-white
    dark:border-slate-800 dark:bg-slate-950 md:hidden"
  style="padding-bottom: env(safe-area-inset-bottom);"
  aria-label="Primary"
>
  {#each NAV_PRIMARY as item}
    {@const active = isActive(item.href, $page.url.pathname)}
    {@const Icon = item.icon}
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium
        {active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500 dark:text-slate-400'}"
    >
      <Icon class="h-5 w-5" aria-hidden="true" />
      {$tr(item.key)}
    </a>
  {/each}
  <MoreMenu
    itemClass="flex-1"
    activeClass="text-brand-600 dark:text-brand-400"
    idleClass="text-slate-500 dark:text-slate-400"
    triggerClass="flex w-full flex-col items-center gap-0.5 py-2 text-[10px] font-medium"
  />
</nav>
