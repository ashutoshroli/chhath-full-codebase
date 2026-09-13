<script lang="ts">
  /**
   * The mobile "More" bottom-nav tab: a button that toggles a small popover
   * listing the NAV_MORE items (Downloads, Committee, Donate). Tap-outside and a
   * route change both close it. Shown only on mobile — desktop navs list every
   * item inline. Each skin passes its active/idle trigger classes so the tab
   * matches the surrounding bar; the popover itself is theme-agnostic (brand +
   * slate utilities that resolve on every theme, light + dark).
   */
  import { page } from '$app/stores';
  import { tr } from '$lib/stores/lang';
  import { NAV_MORE, NAV_MORE_PATHS } from './nav';
  import { MoreHorizontal } from '@lucide/svelte';

  interface Props {
    /** Wrapper <li>/<div> class so the trigger sizes like the other tabs. */
    itemClass?: string;
    /** Trigger button classes when the More section is active. */
    activeClass?: string;
    /** Trigger button classes when idle. */
    idleClass?: string;
    /** Optional extra classes on the trigger button (layout, shared with tabs). */
    triggerClass?: string;
    /** When true, wrap the icon in the premium-style pill badge. */
    iconBadge?: boolean;
  }
  let {
    itemClass = 'flex-1',
    activeClass = 'text-brand-500',
    idleClass = 'text-slate-500 dark:text-slate-400',
    triggerClass = 'flex w-full flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition',
    iconBadge = false
  }: Props = $props();

  let open = $state(false);
  const isMoreActive = $derived(NAV_MORE_PATHS.some((h) => $page.url.pathname.startsWith(h)));

  // Close the popover whenever the route changes.
  let lastPath = $state($page.url.pathname);
  $effect(() => {
    if ($page.url.pathname !== lastPath) {
      lastPath = $page.url.pathname;
      open = false;
    }
  });

  const isItemActive = (href: string) => $page.url.pathname.startsWith(href);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="relative {itemClass}">
  <button
    type="button"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={$tr('nav_more')}
    onclick={() => (open = !open)}
    class="{triggerClass} {open || isMoreActive ? activeClass : idleClass}"
  >
    {#if iconBadge}
      <span class="grid h-9 w-12 place-items-center rounded-xl transition {open || isMoreActive ? 'bg-brand-500/10 dark:bg-brand-500/20' : ''}">
        <MoreHorizontal class="h-5 w-5" aria-hidden="true" />
      </span>
    {:else}
      <MoreHorizontal class="h-5 w-5" aria-hidden="true" />
    {/if}
    {$tr('nav_more')}
  </button>

  {#if open}
    <!-- tap-outside catcher -->
    <button
      type="button"
      class="fixed inset-0 z-40 cursor-default"
      aria-label="Close menu"
      tabindex="-1"
      onclick={() => (open = false)}
    ></button>
    <!-- popover, anchored above the tab -->
    <div
      role="menu"
      class="absolute bottom-full right-0 z-50 mb-2 min-w-[10rem] overflow-hidden rounded-xl border border-black/10 bg-white/95 shadow-xl backdrop-blur-lg dark:border-white/10 dark:bg-ink/95"
    >
      {#each NAV_MORE as item}
        {@const Icon = item.icon}
        {@const active = isItemActive(item.href)}
        <a
          href={item.href}
          role="menuitem"
          aria-current={active ? 'page' : undefined}
          onclick={() => (open = false)}
          class="flex items-center gap-2.5 px-4 py-3 text-sm font-semibold transition
            {active ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'text-slate-700 hover:bg-black/[0.04] dark:text-slate-200 dark:hover:bg-white/5'}"
        >
          <Icon class="h-4 w-4" aria-hidden="true" />
          {$tr(item.key)}
        </a>
      {/each}
    </div>
  {/if}
</div>
