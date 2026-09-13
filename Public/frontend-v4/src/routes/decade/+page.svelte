<script lang="ts">
  import { Trophy } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { tr } from '$lib/stores/lang';
</script>

<svelte:head>
  <title>{$tr('decade_title')} — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={Trophy} titleKey="decade_title" subtitle={$tr('decade_years')} />

<section class="surface flex min-h-[40vh] flex-col items-center justify-center gap-3 p-10 text-center">
  <span class="grid h-14 w-14 place-items-center rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-300">
    <Trophy class="h-7 w-7" aria-hidden="true" />
  </span>
  <p class="text-2xl font-black">Design</p>
</section>
