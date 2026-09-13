<script lang="ts">
  import { FileText } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { tr } from '$lib/stores/lang';

  let orgVars = $derived({ org_name: $tr('org_name'), org_location: $tr('org_location') });
</script>

<svelte:head>
  <title>{$tr('terms_subtitle')} — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={FileText} titleKey="app_subtitle" subtitle={$tr('terms_subtitle')} />

<article class="surface space-y-3 p-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
  <p>{$tr('terms_intro', orgVars)}</p>
  <h2 class="text-base font-bold text-slate-900 dark:text-white">{$tr('terms_use_h')}</h2>
  <p>{$tr('terms_use_p')}</p>
  <h2 class="text-base font-bold text-slate-900 dark:text-white">{$tr('terms_docs_h')}</h2>
  <p>{$tr('terms_docs_p')}</p>
  <p>{$tr('terms_closing')}</p>
</article>
