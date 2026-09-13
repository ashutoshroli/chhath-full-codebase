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
  import { NAV_ITEMS } from '$lib/components/nav';
  import YearSelect from '$lib/components/YearSelect.svelte';
  import StatusBanner from '$lib/components/StatusBanner.svelte';

  let { children } = $props();
  const isActive = (href: string, path: string) => (href === '/' ? path === '/' : path.startsWith(href));
</script>

<!-- Warm cream backdrop with marigold glow -->
<div class="pointer-events-none fixed inset-0 -z-10 bg-[#fff6e6]" aria-hidden="true">
  <div class="absolute inset-x-0 top-0 h-72" style="background: radial-gradient(120% 90% at 50% -20%, rgba(245,184,64,.55), transparent 60%);"></div>
  <div class="absolute inset-x-0 bottom-0 h-56" style="background: radial-gradient(120% 90% at 50% 120%, rgba(176,30,46,.14), transparent 60%);"></div>
</div>

<!-- Decorative gold top border -->
<div class="fixed inset-x-0 top-0 z-50 h-1 bg-gradient-to-r from-[#B01E2E] via-[#F5B840] to-[#B01E2E]"></div>

<header class="sticky top-0 z-40 border-b border-[#F5B840]/40 bg-[#fffdf7]/90 backdrop-blur-md">
  <div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
    <a href="/" class="flex min-w-0 items-center gap-2.5" aria-label={$tr('app_title')}>
      <img src="/logo.svg" alt="" width="38" height="38" class="h-9 w-9 flex-none rounded-full ring-2 ring-[#F5B840]" />
      <span class="min-w-0 leading-tight">
        <span class="block truncate text-sm font-black text-[#7a1420]">{$tr('app_title')}</span>
        <span class="text-[0.68rem] font-semibold text-[#B01E2E]/80">{$tr('app_subtitle')}</span>
      </span>
    </a>

    <nav class="ml-3 hidden items-center gap-1 md:flex" aria-label="Primary">
      {#each NAV_ITEMS as item}
        {@const active = isActive(item.href, $page.url.pathname)}
        <a href={item.href} aria-current={active ? 'page' : undefined}
          class="rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors
            {active ? 'bg-[#B01E2E] text-white shadow' : 'text-[#7a1420] hover:bg-[#F5B840]/20'}">
          {$tr(item.key)}
        </a>
      {/each}
    </nav>

    <div class="ml-auto flex flex-none items-center gap-1.5">
      <button class="grid h-9 w-9 place-items-center rounded-lg border border-[#B01E2E]/30 bg-white text-[#B01E2E] transition hover:bg-[#F5B840]/20 active:scale-95" onclick={() => openThemeGallery()} aria-label={$tr('choose_theme')} title={$tr('choose_theme')}>
        <Palette class="h-4 w-4" aria-hidden="true" />
      </button>
      <button class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#B01E2E]/30 bg-white px-2.5 text-sm font-bold text-[#B01E2E] transition hover:bg-[#F5B840]/20 active:scale-95" onclick={() => lang.toggle()} aria-label={$tr('toggle_language')} title={$tr('toggle_language')}>
        <Languages class="h-4 w-4" aria-hidden="true" />
        <span class="hidden xs:inline">{$lang === 'hi' ? 'English' : 'हिंदी'}</span>
      </button>
      <YearSelect />
    </div>
  </div>
</header>

<StatusBanner />

<main class="mx-auto max-w-5xl px-4 pb-24 pt-5 md:pb-10">
  {@render children()}
</main>

<footer class="mx-auto max-w-5xl px-4 py-6 pb-24 text-center text-xs text-[#7a1420]/70 md:pb-6">
  <p class="font-semibold">{$tr('org_name')}, {$tr('org_location')}</p>
  <p class="mt-1 flex items-center justify-center gap-1">{$tr('seva_line')} <Heart class="h-3.5 w-3.5 fill-current text-[#B01E2E]" /></p>
</footer>

<!-- Warm bottom nav (mobile) -->
<nav class="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-[#F5B840]/40 bg-[#fffdf7] md:hidden" style="padding-bottom: env(safe-area-inset-bottom);" aria-label="Primary">
  {#each NAV_ITEMS as item}
    {@const active = isActive(item.href, $page.url.pathname)}
    {@const Icon = item.icon}
    <a href={item.href} aria-current={active ? 'page' : undefined}
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold
        {active ? 'text-[#B01E2E]' : 'text-[#7a1420]/60'}">
      <Icon class="h-5 w-5" aria-hidden="true" />
      {$tr(item.key)}
    </a>
  {/each}
</nav>
