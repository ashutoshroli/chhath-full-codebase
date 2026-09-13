<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import LiveBackground from '$lib/components/LiveBackground.svelte';
  import Header from '$lib/components/Header.svelte';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import Chatbot from '$lib/components/Chatbot.svelte';
  import StatusBanner from '$lib/components/StatusBanner.svelte';
  import { initPortal } from '$lib/stores/portal';
  import { config } from '$lib/config';

  let { children } = $props();

  // Respect low-power / reduced-motion for the animated background.
  let stillBg = $state(false);
  onMount(() => {
    if (browser) {
      stillBg = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    }
    initPortal();
  });
</script>

<svelte:head>
  <link rel="canonical" href={config.siteUrl} />
</svelte:head>

<LiveBackground still={stillBg} />

<div class="flex min-h-screen flex-col">
  <Header />
  <StatusBanner />

  <main class="mx-auto w-full max-w-6xl flex-1 px-3 pb-28 pt-3 md:pb-6">
    {@render children()}
  </main>

  <Footer />
</div>

<BottomNav />
<Chatbot />
