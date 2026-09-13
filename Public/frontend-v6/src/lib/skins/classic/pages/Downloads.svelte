<script lang="ts">
  import { ArrowLeft } from '@lucide/svelte';
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

<h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-100">{$tr('download_center')}</h2>

{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="skeleton h-40 w-full rounded-xl"></div>
{:else if selected}
  <button class="mb-3 inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-600 dark:border-gray-600 dark:text-gray-300" onclick={() => (selected = null)}>
    <ArrowLeft class="h-4 w-4" /> {$tr('back')}
  </button>
  <div class="mb-3 rounded-xl border border-gray-100 bg-white p-4 font-bold shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">{nameOf(selected)}</div>
  {#if groups.length === 0}
    <div class="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">{$tr('no_docs')}</div>
  {:else}
    {#each groups as g}
      <h3 class="mb-2 mt-4 text-sm font-bold text-gray-700 dark:text-gray-200">{$tr(g.titleKey)}</h3>
      <div class="space-y-2">
        {#each g.docs as d}
          <div class="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{$tr(d.labelKey)}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400">{d.year}</div>
            </div>
            {#if safeUrl(d.publicLink)}
              <a class="flex-none rounded-lg bg-[#F27A1A] px-3 py-1.5 text-xs font-bold text-white" href={safeUrl(d.publicLink)} target="_blank" rel="noopener">{$tr('download')}</a>
            {:else}
              <span class="flex-none rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-400 dark:bg-gray-700">{$tr('not_available')}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
{:else}
  <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <label class="mb-1.5 block text-[0.8rem] text-gray-500 dark:text-gray-400" for="dc-village">{$tr('village')}</label>
    <select id="dc-village" class="mb-3 w-full rounded-lg border border-gray-300 p-2.5 text-[0.95rem] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" bind:value={village}>
      <option value="">{$tr('select_village')}</option>
      {#each villageList as v}<option value={v}>{v}</option>{/each}
    </select>
    <label class="mb-1.5 block text-[0.8rem] text-gray-500 dark:text-gray-400" for="dc-search">{$tr('name')}</label>
    <input id="dc-search" type="search" bind:value={query} disabled={!village} placeholder={village ? $tr('search_by_name') : $tr('select_village_first')} class="w-full rounded-lg border border-gray-300 p-3 text-base outline-none focus:border-[#F27A1A] disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
  </div>

  <div class="mt-3">
    {#if !village}
      <div class="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">{$tr('select_village_first')}</div>
    {:else if !searchQuery}
      <div class="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">{$tr('type_to_search')}</div>
    {:else if people.length === 0}
      <div class="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">{$tr('no_matches')}</div>
    {:else}
      <div class="space-y-2">
        {#each people as u (u.ID)}
          <button class="flex w-full items-center justify-between rounded-lg border border-gray-100 bg-white p-3 text-left shadow-sm dark:border-gray-700 dark:bg-gray-800" onclick={() => (selected = u)}>
            <span class="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{nameOf(u)}</span>
            <span class="text-[#F27A1A]">›</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
