<script lang="ts">
  /**
   * Classic skin shell — replicates the v3/v1 portal chrome:
   *  - fixed 70px top-header (logo + bilingual title, controls: theme, lang, year)
   *  - desktop nav (md+) inline; mobile bottom-nav
   *  - flat off-white background (light) / gray-900 (dark), no live gradient
   * Uses the SHARED stores (theme/lang/year) and the shared ThemeGallery opener.
   * Colours come from the theme CSS vars via Tailwind's dark: + the classic look.
   */
  import { page } from '$app/stores';
  import { Palette, Languages, Heart } from '@lucide/svelte';
  import { lang, tr } from '$lib/stores/lang';
  import { openThemeGallery } from '$lib/stores/ui';
  import { NAV_ITEMS } from '$lib/components/nav';
  import YearSelect from '$lib/components/YearSelect.svelte';
  import StatusBanner from '$lib/components/StatusBanner.svelte';

  let { children } = $props();

  const isActive = (href: string, path: string) =>
    href === '/' ? path === '/' : path.startsWith(href);
</script>

<!-- Flat classic background (no live gradient) -->
<div class="fixed inset-0 -z-10 bg-[#F8F9FA] dark:bg-gray-900"></div>

<header
  class="fixed top-0 z-40 flex h-[70px] w-full items-center justify-between gap-2 px-4 sm:px-5
    bg-white/95 backdrop-blur-md shadow-sm dark:border-b dark:border-gray-800 dark:bg-gray-900/95"
>
  <a href="/" class="flex min-w-0 items-center gap-2" aria-label={$tr('app_title')}>
    <img src="/logo.svg" alt="" width="40" height="40" class="h-10 w-10 flex-none" />
    <span class="min-w-0 leading-none">
      <span class="block truncate text-[1.05rem] font-bold text-gray-800 dark:text-gray-100">{$tr('app_title')}</span>
      <span class="text-[0.7rem] text-gray-500 dark:text-gray-400">{$tr('app_subtitle')}</span>
    </span>
  </a>

  <nav class="hidden gap-2 md:flex" aria-label="Primary">
    {#each NAV_ITEMS as item}
      {@const active = isActive(item.href, $page.url.pathname)}
      <a
        href={item.href}
        aria-current={active ? 'page' : undefined}
        class="rounded-lg px-4 py-2 text-sm font-semibold transition-colors
          {active
            ? 'bg-[#FFEDD5] text-[#F27A1A] dark:bg-gray-800'
            : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}"
      >
        {$tr(item.key)}
      </a>
    {/each}
  </nav>

  <div class="flex flex-none items-center gap-2">
    <button
      class="flex items-center justify-center rounded-lg border-[1.5px] border-[#F27A1A] bg-white px-2.5 py-1.5
        text-[#F27A1A] transition-transform hover:bg-[#FFEDD5] active:scale-95 dark:bg-gray-800 dark:hover:bg-gray-700"
      onclick={() => openThemeGallery()}
      aria-label={$tr('choose_theme')}
      title={$tr('choose_theme')}
    >
      <Palette class="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
    <button
      class="flex items-center gap-1 rounded-lg border-[1.5px] border-[#F27A1A] bg-white px-2.5 py-1.5 text-sm font-bold
        leading-none text-[#F27A1A] transition-transform hover:bg-[#FFEDD5] active:scale-95 dark:bg-gray-800 dark:hover:bg-gray-700 sm:px-3"
      onclick={() => lang.toggle()}
      aria-label={$tr('toggle_language')}
      title={$tr('toggle_language')}
    >
      <Languages class="h-[18px] w-[18px]" aria-hidden="true" />
      <span>{$lang === 'hi' ? 'English' : 'हिंदी'}</span>
    </button>
    <YearSelect />
  </div>
</header>

<StatusBanner />

<main class="mx-auto mt-[86px] max-w-[1000px] px-4 pb-24 md:mt-[92px] md:pb-10">
  {@render children()}
</main>

<footer
  class="mx-auto mb-24 mt-10 max-w-[1000px] border-t border-black/[0.08] px-4 pt-4 text-center text-[0.78rem]
    leading-relaxed text-gray-500 dark:border-white/10 dark:text-gray-400 md:mb-8"
>
  <p class="my-1">{$tr('org_name')}, {$tr('org_location')}</p>
  <p class="my-1 flex items-center justify-center gap-1 opacity-90">
    {$tr('seva_line')} <Heart class="h-3.5 w-3.5 fill-current text-danger" />
  </p>
</footer>

<!-- Mobile bottom nav (classic style) -->
<nav
  class="fixed inset-x-0 bottom-0 z-40 flex h-[65px] items-center justify-around
    bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.05)] dark:border-t dark:border-gray-700 dark:bg-gray-800 md:hidden"
  aria-label="Primary"
>
  {#each NAV_ITEMS as item}
    {@const active = isActive(item.href, $page.url.pathname)}
    {@const Icon = item.icon}
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      class="flex w-1/5 flex-col items-center gap-0.5 text-xs font-semibold
        {active ? 'text-[#F27A1A]' : 'text-gray-500 dark:text-gray-400'}"
    >
      <Icon class="h-5 w-5" aria-hidden="true" />
      {$tr(item.key)}
    </a>
  {/each}
</nav>
