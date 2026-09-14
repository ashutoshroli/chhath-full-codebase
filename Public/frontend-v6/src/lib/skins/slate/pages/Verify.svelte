<script lang="ts">
  import VerifyContent from '$lib/components/VerifyContent.svelte';
  import { tr } from '$lib/stores/lang';
</script>

<svelte:head><title>{$tr('verify_title')} — {$tr('app_title')}</title></svelte:head>

<h1 class="mb-4 text-xl font-black text-slate-900 dark:text-white">{$tr('verify_title')}</h1>
<VerifyContent surfaceClass="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
