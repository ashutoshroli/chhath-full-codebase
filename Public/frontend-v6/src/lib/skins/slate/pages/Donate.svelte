<script lang="ts">
  import DonateContent from '$lib/components/DonateContent.svelte';
  import { tr } from '$lib/stores/lang';
</script>

<svelte:head><title>{$tr('donate_title')} — {$tr('app_title')}</title></svelte:head>

<h1 class="mb-4 text-xl font-black text-slate-900 dark:text-white">{$tr('donate_title')}</h1>
<DonateContent surfaceClass="rounded-2xl border border-slate-200 bg-white p-0 dark:border-slate-800 dark:bg-slate-900" />
