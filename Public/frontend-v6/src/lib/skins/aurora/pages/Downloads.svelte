<script lang="ts">
  import { ArrowLeft, ChevronRight } from '@lucide/svelte';
  import { portalState } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { villages, peopleInVillage, downloadsForPerson } from '$lib/api/derive';
  import type { UserRow } from '$lib/api/schema';
  import { safeUrl } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { GLASS } from '../glass';

  let loading = $derived($portalState.status === 'loading');
  let village = $state('');
  let query = $state('');
  let selected = $state<UserRow | null>(null);

  let villageList = $derived(villages($portalState.data, $lang));
  let searchQuery = $derived(query.trim());
  let people = $derived(village && searchQuery ? peopleInVillage($portalState.data, village, searchQuery) : []);
  let groups = $derived(selected ? downloadsForPerson($portalState.data, (selected.ID ?? '').toString()) : []);
  const nameOf = (u: UserRow) => (($lang === 'hi' && u['Name (Hindi)'] ? u['Name (Hindi)'] : u.Name ?? '').toString());
</script>

<svelte:head><title>{$tr('download_center')} — {$tr('app_title')}</title></svelte:head>

<h1 class="mb-4 text-xl font-bold text-white">{$tr('download_center')}</h1>
{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="h-40 animate-pulse rounded-2xl bg-white/10"></div>
{:else if selected}
  <button class="mb-3 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-200" onclick={() => (selected = null)}>
    <ArrowLeft class="h-4 w-4" /> {$tr('back')}
  </button>
  <div class="{GLASS} mb-3 p-4 font-semibold text-white">{nameOf(selected)}</div>
  {#if groups.length === 0}
    <div class="{GLASS} p-8 text-center text-slate-400">{$tr('no_docs')}</div>
  {:else}
    {#each groups as g}
      <h2 class="mb-2 mt-4 text-sm font-semibold text-slate-200">{$tr(g.titleKey)}</h2>
      <div class="space-y-2">
        {#each g.docs as d}
          <div class="{GLASS} flex items-center justify-between gap-3 p-3">
            <div class="min-w-0"><div class="truncate text-sm font-medium text-white">{$tr(d.labelKey)}</div><div class="text-xs text-slate-400">{d.year}</div></div>
            {#if safeUrl(d.publicLink)}
              <a class="flex-none rounded-full bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white" href={safeUrl(d.publicLink)} target="_blank" rel="noopener">{$tr('download')}</a>
            {:else}
              <span class="flex-none rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-400">{$tr('not_available')}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
{:else}
  <div class="{GLASS} p-4">
    <label class="mb-1.5 block text-xs font-medium text-slate-400" for="dc-village">{$tr('village')}</label>
    <select id="dc-village" class="mb-3 w-full rounded-lg border border-white/10 bg-white/5 p-2.5 text-sm text-white" bind:value={village}>
      <option class="bg-slate-900" value="">{$tr('select_village')}</option>
      {#each villageList as v}<option class="bg-slate-900" value={v}>{v}</option>{/each}
    </select>
    <label class="mb-1.5 block text-xs font-medium text-slate-400" for="dc-search">{$tr('name')}</label>
    <input id="dc-search" type="search" bind:value={query} disabled={!village} placeholder={village ? $tr('search_by_name') : $tr('select_village_first')} class="w-full rounded-lg border border-white/10 bg-white/5 p-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400 disabled:opacity-50" />
  </div>
  <div class="mt-3">
    {#if !village}
      <div class="{GLASS} p-8 text-center text-slate-400">{$tr('select_village_first')}</div>
    {:else if !searchQuery}
      <div class="{GLASS} p-8 text-center text-slate-400">{$tr('type_to_search')}</div>
    {:else if people.length === 0}
      <div class="{GLASS} p-8 text-center text-slate-400">{$tr('no_matches')}</div>
    {:else}
      <div class="space-y-2">
        {#each people as u (u.ID)}
          <button class="{GLASS} flex w-full items-center justify-between p-3 text-left" onclick={() => (selected = u)}>
            <span class="truncate text-sm font-medium text-white">{nameOf(u)}</span>
            <ChevronRight class="h-4 w-4 text-slate-400" />
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
