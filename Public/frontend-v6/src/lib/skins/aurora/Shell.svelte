<script lang="ts">
  /**
   * Aurora skin shell (NEW v6) — modern glassmorphism: animated aurora mesh
   * background, a floating glass pill header, and a floating glass pill bottom
   * nav on mobile. Uses shared stores + ThemeGallery opener.
   */
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { Palette, Languages, Heart } from '@lucide/svelte';
  import { lang, tr } from '$lib/stores/lang';
  import { openThemeGallery } from '$lib/stores/ui';
  import { NAV_ITEMS } from '$lib/components/nav';
  import YearSelect from '$lib/components/YearSelect.svelte';
  import StatusBanner from '$lib/components/StatusBanner.svelte';
  import FooterLinks from '$lib/components/FooterLinks.svelte';
  import AuroraBg from './AuroraBg.svelte';

  let { children } = $props();
  let still = $state(false);
  onMount(() => {
    if (browser) still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  });
  const isActive = (href: string, path: string) => (href === '/' ? path === '/' : path.startsWith(href));
</script>

<AuroraBg {still} />

<div class="text-slate-100">
  <header class="sticky top-0 z-40 px-3 pt-3">
    <div class="mx-auto flex max-w-6xl items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 backdrop-blur-xl">
      <a href="/" class="flex min-w-0 items-center gap-2.5" aria-label={$tr('app_title')}>
        <img src="/logo.svg" alt="" width="36" height="36" class="h-9 w-9 flex-none rounded-lg" />
        <span class="min-w-0 leading-tight">
          <span class="block truncate text-sm font-bold text-white">{$tr('app_title')}</span>
          <span class="text-[0.68rem] text-violet-200/70">{$tr('app_subtitle')}</span>
        </span>
      </a>

      <nav class="ml-3 hidden items-center gap-1 md:flex" aria-label="Primary">
        {#each NAV_ITEMS as item}
          {@const active = isActive(item.href, $page.url.pathname)}
          <a
            href={item.href}
            aria-current={active ? 'page' : undefined}
            class="rounded-full px-3.5 py-1.5 text-sm font-medium transition
              {active ? 'bg-white/15 text-white shadow-inner' : 'text-slate-300 hover:bg-white/10'}"
          >
            {$tr(item.key)}
          </a>
        {/each}
      </nav>

      <div class="ml-auto flex flex-none items-center gap-1.5">
        <button class="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-violet-200 transition hover:bg-white/10 active:scale-95" onclick={() => openThemeGallery()} aria-label={$tr('choose_theme')} title={$tr('choose_theme')}>
          <Palette class="h-4 w-4" aria-hidden="true" />
        </button>
        <button class="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 text-sm font-semibold text-violet-100 transition hover:bg-white/10 active:scale-95" onclick={() => lang.toggle()} aria-label={$tr('toggle_language')} title={$tr('toggle_language')}>
          <Languages class="h-4 w-4" aria-hidden="true" />
          <span class="hidden xs:inline">{$lang === 'hi' ? 'English' : 'हिंदी'}</span>
        </button>
        <YearSelect />
      </div>
    </div>
  </header>

  <StatusBanner />

  <main class="mx-auto max-w-6xl px-3 pb-28 pt-4 md:pb-10">
    {@render children()}
  </main>

  <footer class="mx-auto max-w-6xl px-4 py-6 pb-28 text-center text-xs text-slate-400 md:pb-6">
    <p>{$tr('org_name')}, {$tr('org_location')}</p>
    <p class="mt-1 flex items-center justify-center gap-1">{$tr('seva_line')} <Heart class="h-3.5 w-3.5 fill-current text-pink-400" /></p>
    <FooterLinks />
  </footer>

  <!-- Floating glass pill bottom nav (mobile) -->
  <nav class="fixed inset-x-0 bottom-3 z-40 px-4 md:hidden" aria-label="Primary" style="padding-bottom: env(safe-area-inset-bottom);">
    <div class="mx-auto flex max-w-md items-center justify-around rounded-2xl border border-white/10 bg-[#141b30]/80 px-1 py-1 backdrop-blur-xl">
      {#each NAV_ITEMS as item}
        {@const active = isActive(item.href, $page.url.pathname)}
        {@const Icon = item.icon}
        <a href={item.href} aria-current={active ? 'page' : undefined}
          class="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium
            {active ? 'bg-white/10 text-violet-200' : 'text-slate-400'}">
          <Icon class="h-5 w-5" aria-hidden="true" />
          {$tr(item.key)}
        </a>
      {/each}
    </div>
  </nav>
</div>
