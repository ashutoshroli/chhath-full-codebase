<script lang="ts">
  import { page } from '$app/stores';
  import { Sun, Moon, Languages } from '@lucide/svelte';
  import { theme } from '$lib/stores/theme';
  import { lang, tr } from '$lib/stores/lang';
  import { NAV_ITEMS } from './nav';
  import YearSelect from './YearSelect.svelte';

  const isActive = (href: string, path: string) =>
    href === '/' ? path === '/' : path.startsWith(href);
</script>

<header class="sticky top-0 z-40">
  <div
    class="mx-auto flex max-w-6xl items-center gap-2.5 px-3 py-2.5
      bg-white/70 backdrop-blur-md border-b border-black/5
      dark:bg-ink/70 dark:border-white/10"
  >
    <!-- Logo + bilingual title -->
    <a href="/" class="flex items-center gap-2.5" aria-label={$tr('app_title')}>
      <img src="/logo.svg" alt="" class="h-10 w-10 shrink-0 drop-shadow" width="40" height="40" />
      <span class="leading-tight">
        <span class="block text-[15px] font-black text-slate-900 dark:text-white sm:text-base">
          {$tr('app_title')}
          <span class="text-brand-600 dark:text-brand-300">·</span>
          <span class="text-brand-600 dark:text-brand-300">{$tr('app_subtitle')}</span>
        </span>
        <span class="block text-[9px] font-semibold tracking-wide text-brand-700/80 dark:text-brand-200/80">
          {$tr('brand_tagline')}
        </span>
      </span>
    </a>

    <!-- Desktop nav (md+) -->
    <nav class="ml-4 hidden items-center gap-1 md:flex" aria-label="Primary">
      {#each NAV_ITEMS as item}
        {@const active = isActive(item.href, $page.url.pathname)}
        <a
          href={item.href}
          aria-current={active ? 'page' : undefined}
          class="rounded-lg px-3 py-1.5 text-sm font-semibold transition
            {active
              ? 'bg-brand-500/10 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200'
              : 'text-slate-600 hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10'}"
        >
          {$tr(item.key)}
        </a>
      {/each}
    </nav>

    <!-- Controls: theme, language, year -->
    <div class="ml-auto flex items-center gap-1.5">
      <button
        class="chip !px-2.5"
        onclick={() => theme.toggle()}
        aria-label={$tr('toggle_theme')}
        title={$tr('toggle_theme')}
      >
        {#if $theme === 'dark'}
          <Sun class="h-4 w-4" aria-hidden="true" />
        {:else}
          <Moon class="h-4 w-4" aria-hidden="true" />
        {/if}
      </button>

      <button
        class="chip"
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
