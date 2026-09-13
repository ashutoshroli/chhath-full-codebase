<script lang="ts">
  import { ArrowLeft, ChevronRight } from '@lucide/svelte';
  import { portalState } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { villages, peopleInVillage, downloadsForPerson } from '$lib/api/derive';
  import type { UserRow } from '$lib/api/schema';
  import { safeUrl } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';

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

<h1 class="mb-4 text-xl font-bold text-slate-900 dark:text-white">{$tr('download_center')}</h1>

{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="skeleton h-40 w-full rounded-2xl"></div>
{:else if selected}
  <button class="mb-3 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300" onclick={() => (selected = null)}>
    <ArrowLeft class="h-4 w-4" /> {$tr('back')}
  </button>
  <div class="mb-3 rounded-2xl border border-slate-200 bg-white p-4 font-semibold shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">{nameOf(selected)}</div>
  {#if groups.length === 0}
    <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">{$tr('no_docs')}</div>
  {:else}
    {#each groups as g}
      <h2 class="mb-2 mt-4 text-sm font-semibold text-slate-700 dark:text-slate-200">{$tr(g.titleKey)}</h2>
      <div class="space-y-2">
        {#each g.docs as d}
          <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{$tr(d.labelKey)}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400">{d.year}</div>
            </div>
            {#if safeUrl(d.publicLink)}
              <a class="flex-none rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white" href={safeUrl(d.publicLink)} target="_blank" rel="noopener">{$tr('download')}</a>
            {:else}
              <span class="flex-none rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-400 dark:bg-slate-800">{$tr('not_available')}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
{:else}
  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <label class="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400" for="dc-village">{$tr('village')}</label>
    <select id="dc-village" class="mb-3 w-full rounded-lg border border-slate-300 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" bind:value={village}>
      <option value="">{$tr('select_village')}</option>
      {#each villageList as v}<option value={v}>{v}</option>{/each}
    </select>
    <label class="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400" for="dc-search">{$tr('name')}</label>
    <input id="dc-search" type="search" bind:value={query} disabled={!village} placeholder={village ? $tr('search_by_name') : $tr('select_village_first')} class="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
  </div>

  <div class="mt-3">
    {#if !village}
      <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">{$tr('select_village_first')}</div>
    {:else if !searchQuery}
      <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">{$tr('type_to_search')}</div>
    {:else if people.length === 0}
      <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">{$tr('no_matches')}</div>
    {:else}
      <div class="space-y-2">
        {#each people as u (u.ID)}
          <button class="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm dark:border-slate-800 dark:bg-slate-900" onclick={() => (selected = u)}>
            <span class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{nameOf(u)}</span>
            <ChevronRight class="h-4 w-4 text-slate-400" />
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
