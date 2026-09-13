<script lang="ts">
  import { ShieldCheck } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { tr } from '$lib/stores/lang';

  let orgVars = $derived({ org_name: $tr('org_name'), org_location: $tr('org_location') });
</script>

<svelte:head>
  <title>{$tr('privacy_subtitle')} — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={ShieldCheck} titleKey="app_subtitle" subtitle={$tr('privacy_subtitle')} />

<article class="surface space-y-3 p-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
  <p>{$tr('privacy_intro', orgVars)}</p>
  <h2 class="text-base font-bold text-slate-900 dark:text-white">{$tr('privacy_show_h')}</h2>
  <p>{$tr('privacy_show_p')}</p>
  <h2 class="text-base font-bold text-slate-900 dark:text-white">{$tr('privacy_data_h')}</h2>
  <p>{$tr('privacy_data_p')}</p>
  <p>{$tr('privacy_contact_p')}</p>
</article>
