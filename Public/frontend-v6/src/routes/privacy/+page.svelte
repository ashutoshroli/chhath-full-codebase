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

  <!-- audit PR-44: the notice covered "what we show" and "data & caching" and nothing else, on a
       portal that runs an AI assistant, push notifications, an on-device notification inbox, a
       service-worker cache and third-party fonts. Each of those is now stated plainly, including
       the one that is a live third-party dependency (Google Fonts) rather than only the ones that
       are comfortable to describe. A test pins the list so a section cannot quietly disappear. -->
  {#each ['chat', 'push', 'offline', 'thirdparty', 'retention', 'rights'] as section (section)}
    <h2 class="text-base font-bold text-slate-900 dark:text-white">{$tr(`privacy_${section}_h`)}</h2>
    <p>{$tr(`privacy_${section}_p`)}</p>
  {/each}

  <p>{$tr('privacy_contact_p')}</p>
</article>
