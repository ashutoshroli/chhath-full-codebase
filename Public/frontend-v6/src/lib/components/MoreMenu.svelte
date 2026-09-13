<script lang="ts">
  /**
   * The mobile "More" bottom-nav tab: a button that opens a full bottom-sheet
   * modal (slide-up from the bottom, dimmed overlay) listing the NAV_MORE items
   * (Downloads, Committee, Donate) as clean full-width rows. The sheet has its
   * own header ("More" + close X). Tapping the overlay, the X, an item, Escape,
   * or a route change all close it. Shown only on mobile — desktop navs list
   * every item inline. Each skin passes its active/idle trigger classes so the
   * tab matches the surrounding bar; the sheet itself is theme-agnostic (brand +
   * slate utilities that resolve on every theme, light + dark).
   */
  import { page } from '$app/stores';
  import { tr } from '$lib/stores/lang';
  import { NAV_MORE, NAV_MORE_PATHS } from './nav';
  import { MoreHorizontal, X, ChevronRight } from '@lucide/svelte';
  import { fade, fly } from 'svelte/transition';

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
    <!-- Dimmed overlay + bottom-sheet modal (portal-style), rendered fixed to
         the viewport so it sits cleanly above ALL page content, not anchored to
         the tab. Tap the overlay to close. -->
    <div class="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label={$tr('nav_more')}>
      <button
        type="button"
        class="absolute inset-0 h-full w-full cursor-default bg-black/50 backdrop-blur-sm"
        aria-label="Close menu"
        tabindex="-1"
        onclick={() => (open = false)}
        transition:fade={{ duration: 180 }}
      ></button>

      <div
        class="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-ink"
        style="padding-bottom: env(safe-area-inset-bottom);"
        transition:fly={{ y: 320, duration: 260, opacity: 1 }}
      >
        <!-- grabber -->
        <div class="flex justify-center pt-2.5">
          <span class="h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20"></span>
        </div>
        <!-- header -->
        <div class="flex items-center justify-between px-5 pb-2 pt-2.5">
          <h2 class="text-base font-black text-slate-900 dark:text-white">{$tr('nav_more')}</h2>
          <button
            type="button"
            onclick={() => (open = false)}
            aria-label="Close"
            class="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/10"
          >
            <X class="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <!-- full-width rows -->
        <nav class="px-2 pb-3">
          {#each NAV_MORE as item}
            {@const Icon = item.icon}
            {@const active = isItemActive(item.href)}
            <a
              href={item.href}
              aria-current={active ? 'page' : undefined}
              onclick={() => (open = false)}
              class="flex items-center gap-3.5 rounded-xl px-3 py-3.5 text-[15px] font-semibold transition
                {active ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'text-slate-700 hover:bg-black/[0.04] dark:text-slate-200 dark:hover:bg-white/5'}"
            >
              <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-300">
                <Icon class="h-5 w-5" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">{$tr(item.key)}</span>
              <ChevronRight class="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            </a>
          {/each}
        </nav>
      </div>
    </div>
  {/if}
</div>
