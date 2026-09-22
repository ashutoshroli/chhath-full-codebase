<script lang="ts">
  import { page } from '$app/stores';
  import { Palette, Languages, Sun, Waves } from '@lucide/svelte';
  import { lang, tr } from '$lib/stores/lang';
  import { openThemeGallery } from '$lib/stores/ui';
  import { NAV_ITEMS, NAV_PRIMARY } from '$lib/components/nav';
  import MoreMenu from '$lib/components/MoreMenu.svelte';
  import YearSelect from '$lib/components/YearSelect.svelte';
  import StatusBanner from '$lib/components/StatusBanner.svelte';
  import FooterLinks from '$lib/components/FooterLinks.svelte';
  import '$lib/skins/surya-ghat/Skin.css';
  import '$lib/skins/surya-ghat/PageTheme.css';

  let { children } = $props();
  const isActive = (href: string, path: string) => (href === '/' ? path === '/' : path.startsWith(href));
</script>

<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-amber-500 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-slate-950">{$tr('skip_to_content')}</a>

<div class="surya-shell min-h-screen">
  <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
    <div class="absolute left-1/2 top-[-11rem] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-amber-400/10 blur-3xl"></div>
    <div class="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-teal-400/10 blur-3xl"></div>
    <div class="absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-cyan-500/5 blur-3xl"></div>
  </div>

  <header class="sticky top-0 z-40 border-b border-amber-300/15 bg-slate-950/75 backdrop-blur-xl">
    <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-6">
      <a href="/" class="group flex min-w-0 items-center gap-3" aria-label={$tr('app_title')}>
        <span class="grid h-11 w-11 flex-none place-items-center rounded-2xl border border-amber-300/30 bg-gradient-to-br from-amber-300/20 to-teal-300/10 shadow-[0_0_35px_rgba(230,166,67,.12)]"><Sun class="h-6 w-6 text-amber-300 transition-transform group-hover:rotate-45" aria-hidden="true" /></span>
        <span class="min-w-0 leading-tight"><span class="block truncate text-sm font-black tracking-wide text-white">{$tr('app_title')}</span><span class="flex items-center gap-1 text-[0.66rem] font-semibold uppercase tracking-[.18em] text-teal-200/70"><Waves class="h-3 w-3" />{$tr('app_subtitle')}</span></span>
      </a>
      <nav class="ml-4 hidden items-center gap-1 lg:flex" aria-label="Primary">
        {#each NAV_ITEMS as item}
          {@const active = isActive(item.href, $page.url.pathname)}
          <a href={item.href} aria-current={active ? 'page' : undefined} class="rounded-xl px-3 py-2 text-sm font-semibold transition {active ? 'bg-white/10 text-amber-200 shadow-inner shadow-white/5' : 'text-slate-300 hover:bg-white/5 hover:text-white'}">{$tr(item.key)}</a>
        {/each}
      </nav>
      <div class="ml-auto flex flex-none items-center gap-1.5">
        <button class="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-amber-200 hover:border-amber-300/30 hover:bg-amber-300/10" onclick={() => openThemeGallery()} aria-label={$tr('choose_theme')} title={$tr('choose_theme')}><Palette class="h-4 w-4" /></button>
        <button class="hidden h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-bold text-teal-100 hover:border-teal-300/30 sm:inline-flex" onclick={() => lang.toggle()} aria-label={$tr('toggle_language')} title={$tr('toggle_language')}><Languages class="h-4 w-4" /><span>{$lang === 'hi' ? 'English' : 'हिंदी'}</span></button>
        <YearSelect />
      </div>
    </div>
  </header>
  <StatusBanner />
  <main id="main" tabindex="-1" class="surya-main mx-auto px-4 pb-28 pt-6 md:px-6 md:pb-12">{@render children()}</main>
  <footer class="mx-auto max-w-6xl px-4 py-8 pb-28 text-center text-xs text-slate-400 md:px-6 md:pb-8"><p class="font-bold text-slate-300">{$tr('org_name')}, {$tr('org_location')}</p><p class="mt-1 text-teal-200/60">{$tr('seva_line')}</p><FooterLinks /></footer>
  <nav class="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-amber-300/10 bg-slate-950/90 backdrop-blur-xl md:hidden" style="padding-bottom: env(safe-area-inset-bottom);" aria-label="Primary">
    {#each NAV_PRIMARY as item}
      {@const active = isActive(item.href, $page.url.pathname)}
      {@const Icon = item.icon}
      <a href={item.href} aria-current={active ? 'page' : undefined} class="flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-bold {active ? 'text-amber-300' : 'text-slate-500'}"><Icon class="h-5 w-5" />{$tr(item.key)}</a>
    {/each}
    <MoreMenu itemClass="flex-1" activeClass="text-amber-300" idleClass="text-slate-500" triggerClass="flex w-full flex-col items-center gap-1 py-2 text-[10px] font-bold" />
  </nav>
</div>
