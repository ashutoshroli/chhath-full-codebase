<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
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
     footer). Switching theme -> switches skin -> the entire portal re-renders,
     with a brief cross-fade so the change feels smooth (reduced-motion users
     get an instant swap via app.css's global animation/transition override). -->
{#key $activeSkin.id}
  <div in:fade={{ duration: 220 }}>
    <Shell>
      {@render children()}
    </Shell>
  </div>
{/key}

<!-- Skin-agnostic overlays rendered once, above every skin. -->
<Chatbot />
<AnnouncementPopup />
<ThemeGallery open={$themeGalleryOpen} onclose={closeThemeGallery} />
