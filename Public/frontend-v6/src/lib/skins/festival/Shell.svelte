<script lang="ts">
  /**
   * Festival skin shell (NEW v6) — rich celebratory look: warm cream backdrop
   * with a soft marigold glow, deep-maroon accents, a decorative gold top border,
   * and a warm bottom nav. Shared stores + ThemeGallery opener.
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
  const isActive = (href: string, path: string) => (href === '/' ? path === '/' : path.startsWith(href));
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


<!-- Warm cream backdrop with marigold glow -->
<div class="pointer-events-none fixed inset-0 -z-10 bg-[rgb(var(--page-from))]" aria-hidden="true">
  <div class="absolute inset-x-0 top-0 h-72" style="background: radial-gradient(120% 90% at 50% -20%, rgb(var(--accent-2) / 0.55), transparent 60%);"></div>
  <div class="absolute inset-x-0 bottom-0 h-56" style="background: radial-gradient(120% 90% at 50% 120%, rgb(var(--accent) / 0.14), transparent 60%);"></div>
</div>

<!-- Decorative gold top border -->
<div class="fixed inset-x-0 top-0 z-50 h-1 bg-gradient-to-r from-[rgb(var(--accent))] via-[rgb(var(--accent-2))] to-[rgb(var(--accent))]"></div>

<header class="sticky top-0 z-40 border-b border-[rgb(var(--accent-2)/0.4)] bg-[rgb(var(--surface-bg)/0.9)] backdrop-blur-md">
  <div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
    <a href="/" class="flex min-w-0 items-center gap-2.5" aria-label={$tr('app_title')}>
      <img src="/logo.svg" alt="" width="38" height="38" class="h-9 w-9 flex-none rounded-full ring-2 ring-[rgb(var(--accent-2))]" />
      <span class="min-w-0 leading-tight">
        <span class="block truncate text-sm font-black text-[rgb(var(--fest-ink))]">{$tr('app_title')}</span>
        <span class="text-[0.68rem] font-semibold text-[rgb(var(--accent)/0.8)]">{$tr('app_subtitle')}</span>
      </span>
    </a>

    <nav class="ml-3 hidden items-center gap-1 md:flex" aria-label="Primary">
      {#each NAV_ITEMS as item}
        {@const active = isActive(item.href, $page.url.pathname)}
        <a href={item.href} aria-current={active ? 'page' : undefined}
          class="rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors
            {active ? 'bg-[rgb(var(--accent))] text-white shadow' : 'text-[rgb(var(--fest-ink))] hover:bg-[rgb(var(--accent-2)/0.2)]'}">
          {$tr(item.key)}
        </a>
      {/each}
    </nav>

    <div class="ml-auto flex flex-none items-center gap-1.5">
      <button class="grid h-9 w-9 place-items-center rounded-lg border border-[rgb(var(--accent)/0.3)] bg-[rgb(var(--surface-bg))] text-[rgb(var(--accent))] transition hover:bg-[rgb(var(--accent-2)/0.2)] active:scale-95" onclick={() => openThemeGallery()} aria-label={$tr('choose_theme')} title={$tr('choose_theme')}>
        <Palette class="h-4 w-4" aria-hidden="true" />
      </button>
      <button class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[rgb(var(--accent)/0.3)] bg-[rgb(var(--surface-bg))] px-2.5 text-sm font-bold text-[rgb(var(--accent))] transition hover:bg-[rgb(var(--accent-2)/0.2)] active:scale-95" onclick={() => lang.toggle()} aria-label={$tr('toggle_language')} title={$tr('toggle_language')}>
        <Languages class="h-4 w-4" aria-hidden="true" />
        <span class="hidden xs:inline">{$lang === 'hi' ? 'English' : 'हिंदी'}</span>
      </button>
      <YearSelect />
    </div>
  </div>
</header>

<StatusBanner />

<main id="main" tabindex="-1" class="mx-auto max-w-5xl px-4 pb-24 pt-5 md:pb-10">
  {@render children()}
</main>

<footer class="mx-auto max-w-5xl px-4 py-6 pb-24 text-center text-xs text-[rgb(var(--fest-ink)/0.7)] md:pb-6">
  <p class="font-semibold">{$tr('org_name')}, {$tr('org_location')}</p>
  <p class="mt-1 flex items-center justify-center gap-1">{$tr('seva_line')} <Heart class="h-3.5 w-3.5 fill-current text-[rgb(var(--accent))]" /></p>
  <FooterLinks />
</footer>

<!-- Warm bottom nav (mobile) -->
<nav class="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-[rgb(var(--accent-2)/0.4)] bg-[rgb(var(--surface-bg))] md:hidden" style="padding-bottom: env(safe-area-inset-bottom);" aria-label="Primary">
  {#each NAV_PRIMARY as item}
    {@const active = isActive(item.href, $page.url.pathname)}
    {@const Icon = item.icon}
    <a href={item.href} aria-current={active ? 'page' : undefined}
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold
        {active ? 'text-[rgb(var(--accent))]' : 'text-[rgb(var(--fest-ink)/0.6)]'}">
      <Icon class="h-5 w-5" aria-hidden="true" />
      {$tr(item.key)}
    </a>
  {/each}
  <MoreMenu
    itemClass="flex-1"
    activeClass="text-[rgb(var(--accent))]"
    idleClass="text-[rgb(var(--fest-ink)/0.6)]"
    triggerClass="flex w-full flex-col items-center gap-0.5 py-2 text-[10px] font-bold"
  />
</nav>
