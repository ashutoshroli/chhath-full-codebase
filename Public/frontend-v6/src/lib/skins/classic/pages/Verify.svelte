<script lang="ts">
  import VerifyContent from '$lib/components/VerifyContent.svelte';
  import { tr } from '$lib/stores/lang';
</script>

<svelte:head><title>{$tr('verify_title')} — {$tr('app_title')}</title></svelte:head>

<h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-100">{$tr('verify_title')}</h2>
<VerifyContent surfaceClass="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800" />
