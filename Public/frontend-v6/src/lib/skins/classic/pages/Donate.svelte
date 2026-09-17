<script lang="ts">
  import DonateContent from '$lib/components/DonateContent.svelte';
  import { tr } from '$lib/stores/lang';
</script>

<svelte:head><title>{$tr('donate_title')} — {$tr('app_title')}</title></svelte:head>

<!-- audit PR-41: was <h2>. This IS the page title, so it is the document's h1 — the classes
     are unchanged, so nothing moves; only the outline is corrected. -->
<h1 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-100">{$tr('donate_title')}</h1>
<DonateContent surfaceClass="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800" />
