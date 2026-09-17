<script lang="ts">
  /**
   * Premium skin shell — the v5/v4 warm-glass chrome: live Chhath background,
   * frosted header, desktop nav + mobile bottom nav, footer, chatbot, popup.
   * Shared UI (StatusBanner, Chatbot, AnnouncementPopup, ThemeGallery) is used
   * as-is; those are skin-agnostic overlays.
   */
  import { onMount } from 'svelte';
  import { tr } from '$lib/stores/lang';
  import { browser } from '$app/environment';
  import LiveBackground from '$lib/components/LiveBackground.svelte';
  import Header from '$lib/components/Header.svelte';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import StatusBanner from '$lib/components/StatusBanner.svelte';
  import { openThemeGallery } from '$lib/stores/ui';

  let { children } = $props();

  let stillBg = $state(false);
  onMount(() => {
    if (browser) stillBg = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  });
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


<LiveBackground still={stillBg} />

<div class="flex min-h-screen flex-col">
  <Header onThemeClick={() => openThemeGallery()} />
  <StatusBanner />

  <main id="main" tabindex="-1" class="mx-auto w-full max-w-6xl flex-1 px-3 pb-28 pt-3 md:pb-6">
    {@render children()}
  </main>

  <Footer />
</div>

<BottomNav />
