<script lang="ts">
  import DonateContent from '$lib/components/DonateContent.svelte';
  import { tr } from '$lib/stores/lang';
</script>

<svelte:head><title>{$tr('donate_title')} — {$tr('app_title')}</title></svelte:head>

<h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-100">{$tr('donate_title')}</h2>
<DonateContent surfaceClass="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800" />
