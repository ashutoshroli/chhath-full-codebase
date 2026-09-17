<script lang="ts">
  // audit PR-45: the DEFAULT skin's version of this page is a STATIC import, so it is
  // what the server prerenders and what most visitors hydrate — no extra request, and
  // the prerendered body keeps its real content (PR-42). A non-default skin's page
  // arrives with that skin's single lazily-loaded chunk. The static import is also what
  // keeps this page in THIS route's chunk instead of one shared by all eight routes.
  import DefaultPage from '$lib/skins/premium/pages/Downloads.svelte';
  import { skinPage } from '$lib/stores/skin';

  const activePage = skinPage('Downloads', DefaultPage);
  let Page = $derived($activePage);
</script>

<Page />
