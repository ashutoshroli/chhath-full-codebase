<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { initPortal } from '$lib/stores/portal';
  import { config } from '$lib/config';
  import { activeSkin } from '$lib/stores/skin';
  import { themeGalleryOpen, closeThemeGallery } from '$lib/stores/ui';
  import Chatbot from '$lib/components/Chatbot.svelte';
  import AnnouncementPopup from '$lib/components/AnnouncementPopup.svelte';
  import ThemeGallery from '$lib/components/ThemeGallery.svelte';

  let { children } = $props();

  // Svelte 5 renders a dynamic component from a plain variable reference.
  let Shell = $derived($activeSkin.Shell);

  onMount(() => {
    initPortal();
  });
</script>

<svelte:head>
  <link rel="canonical" href={config.siteUrl} />
</svelte:head>

<!-- The active skin owns the whole portal chrome (background, header, nav,
     footer). Switching theme -> switches skin -> the entire portal re-renders. -->
{#key $activeSkin.id}
  <Shell>
    {@render children()}
  </Shell>
{/key}

<!-- Skin-agnostic overlays rendered once, above every skin. -->
<Chatbot />
<AnnouncementPopup />
<ThemeGallery open={$themeGalleryOpen} onclose={closeThemeGallery} />
