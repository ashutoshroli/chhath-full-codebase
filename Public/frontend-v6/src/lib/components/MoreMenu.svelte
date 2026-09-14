<script lang="ts">
  /**
   * The mobile "More" bottom-nav tab: a button that opens a full bottom-sheet
   * modal (slide-up from the bottom, dimmed overlay) listing the NAV_MORE items
   * (Downloads, Committee, Donate) as clean full-width rows. The sheet has its
   * own header ("More" + close X). Tapping the overlay, the X, an item, Escape,
   * or a route change all close it. Shown only on mobile — desktop navs list
   * every item inline. Each skin passes its active/idle trigger classes so the
   * tab matches the surrounding bar.
   *
   * IMPORTANT — the overlay is teleported to <body> via the `portal` action.
   * Each skin's <nav> is `position: fixed` and uses `backdrop-blur`; a nested
   * `position: fixed` child is contained by that blurred ancestor (backdrop-
   * filter creates a containing block), so without the portal the "fixed" modal
   * would be clipped to the nav bar and appear inline. Rendered on <body> it
   * covers the whole viewport. The SURFACE colour comes from the active theme
   * tokens (--surface-bg over --page-to) and the icons/active row use --accent,
   * so the sheet matches whatever theme is applied. Text / close / dividers use
   * Tailwind slate + `dark:` pairs (NOT --surface-border, which is a border/
   * hairline token that is white or an accent colour in several themes and left
   * the labels unreadable on light surfaces) — the sheet carries data-theme +
   * the `dark` class so those variants flip correctly.
   */
  import { page } from '$app/stores';
  import { tr } from '$lib/stores/lang';
  import { NAV_MORE, NAV_MORE_PATHS } from './nav';
  import { MoreHorizontal, X, ChevronRight } from '@lucide/svelte';
  import { fade, fly } from 'svelte/transition';
  import InstallButton from './InstallButton.svelte';

  // Teleport a node to document.body so it escapes the nav's fixed/blur
  // containing block and truly overlays the viewport.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    };
  }

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

  // Close the sheet whenever the route changes.
  let lastPath = $state($page.url.pathname);
  $effect(() => {
    if ($page.url.pathname !== lastPath) {
      lastPath = $page.url.pathname;
      open = false;
    }
  });

  // Lock background scroll while the sheet is open.
  $effect(() => {
    if (typeof document === 'undefined') return;
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  });

  const isItemActive = (href: string) => $page.url.pathname.startsWith(href);

  // The theme lives on <html> (data-theme + the `dark` class). The portaled
  // overlay is moved to <body>, OUTSIDE the element tree that carries those, so
  // its CSS custom properties would not resolve. Copy the current theme onto the
  // overlay so --surface-bg/--accent/etc. apply. Read fresh each time it opens.
  let activeTheme = $state('sunrise');
  let isDark = $state(false);
  $effect(() => {
    if (open && typeof document !== 'undefined') {
      const root = document.documentElement;
      activeTheme = root.getAttribute('data-theme') || 'sunrise';
      isDark = root.classList.contains('dark');
    }
  });
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
</div>

{#if open}
  <!-- Teleported to <body> so it escapes the nav's fixed/backdrop-blur
       containing block and covers the whole viewport. Carries `data-theme` +
       the `dark` class copied from <html> so the theme tokens resolve here too
       (a portaled node lives outside the app root that holds them). -->
  <div
    use:portal
    data-theme={activeTheme}
    class:dark={isDark}
    class="fixed inset-0 z-[100] md:hidden"
    role="dialog"
    aria-modal="true"
    aria-label={$tr('nav_more')}
  >
    <!-- Dim backdrop -->
    <button
      type="button"
      class="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
      aria-label="Close menu"
      tabindex="-1"
      onclick={() => (open = false)}
      transition:fade={{ duration: 180 }}
    ></button>

    <!-- Bottom sheet — opaque, theme-tokened surface (page gradient base +
         surface tint on top so it is solid on both light and dark themes). -->
    <div
      class="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-black/10 text-slate-700 shadow-2xl dark:border-white/10 dark:text-slate-200"
      style="
        background-color: var(--page-to, var(--page-from));
        background-image: linear-gradient(rgb(var(--surface-bg) / var(--surface-alpha, 1)), rgb(var(--surface-bg) / var(--surface-alpha, 1)));
        padding-bottom: env(safe-area-inset-bottom);
      "
      transition:fly={{ y: 340, duration: 260 }}
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
          class="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <X class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <!-- Install app — the SAME InstallButton component the /guide page uses,
           reused as-is (no duplicated install logic). Only reachable on mobile,
           because this whole sheet is md:hidden. The prompt it opens is captured
           by $lib/stores/install at app bootstrap, not on mount, so it still
           works even though this sheet mounts late (see that module). -->
      <div class="border-b border-black/10 px-5 pb-3 dark:border-white/10">
        <InstallButton />
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
              {active ? '' : 'text-slate-800 hover:bg-black/[0.05] dark:text-slate-100 dark:hover:bg-white/5'}"
            style={active
              ? 'color: rgb(var(--accent)); background: rgb(var(--accent) / 0.12);'
              : ''}
          >
            <span
              class="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
              style="background: rgb(var(--accent) / 0.16); color: rgb(var(--accent));"
            >
              <Icon class="h-5 w-5" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1">{$tr(item.key)}</span>
            <ChevronRight class="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          </a>
        {/each}
      </nav>
    </div>
  </div>
{/if}
