<script lang="ts">
  import { ArrowLeft, ChevronRight } from '@lucide/svelte';
  import { portalState } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { villages, peopleInVillage, downloadsForPerson } from '$lib/api/derive';
  import type { UserRow } from '$lib/api/schema';
  import { safeUrl } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { CARD } from '../fest';

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

<h1 class="mb-4 text-xl font-black text-[#7a1420]">{$tr('download_center')}</h1>
{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="h-40 animate-pulse rounded-2xl bg-[#F5B840]/20"></div>
{:else if selected}
  <button class="mb-3 inline-flex items-center gap-1 rounded-lg border border-[#B01E2E]/30 bg-white px-3 py-1.5 text-sm font-semibold text-[#B01E2E]" onclick={() => (selected = null)}>
    <ArrowLeft class="h-4 w-4" /> {$tr('back')}
  </button>
  <div class="{CARD} mb-3 p-4 font-bold text-[#7a1420]">{nameOf(selected)}</div>
  {#if groups.length === 0}
    <div class="{CARD} p-8 text-center text-[#7a1420]/60">{$tr('no_docs')}</div>
  {:else}
    {#each groups as g}
      <h2 class="mb-2 mt-4 text-sm font-bold text-[#7a1420]">{$tr(g.titleKey)}</h2>
      <div class="space-y-2">
        {#each g.docs as d}
          <div class="{CARD} flex items-center justify-between gap-3 p-3">
            <div class="min-w-0"><div class="truncate text-sm font-semibold text-[#7a1420]">{$tr(d.labelKey)}</div><div class="text-xs text-[#7a1420]/60">{d.year}</div></div>
            {#if safeUrl(d.publicLink)}
              <a class="flex-none rounded-lg bg-[#B01E2E] px-3 py-1.5 text-xs font-bold text-white" href={safeUrl(d.publicLink)} target="_blank" rel="noopener">{$tr('download')}</a>
            {:else}
              <span class="flex-none rounded-lg bg-[#F5B840]/25 px-3 py-1.5 text-xs font-semibold text-[#7a1420]/50">{$tr('not_available')}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
{:else}
  <div class="{CARD} p-4">
    <label class="mb-1.5 block text-xs font-semibold text-[#7a1420]/70" for="dc-village">{$tr('village')}</label>
    <select id="dc-village" class="mb-3 w-full rounded-lg border border-[#F5B840]/60 bg-white p-2.5 text-sm text-[#7a1420]" bind:value={village}>
      <option value="">{$tr('select_village')}</option>
      {#each villageList as v}<option value={v}>{v}</option>{/each}
    </select>
    <label class="mb-1.5 block text-xs font-semibold text-[#7a1420]/70" for="dc-search">{$tr('name')}</label>
    <input id="dc-search" type="search" bind:value={query} disabled={!village} placeholder={village ? $tr('search_by_name') : $tr('select_village_first')} class="w-full rounded-lg border border-[#F5B840]/60 bg-white p-2.5 text-sm text-[#7a1420] outline-none focus:border-[#B01E2E] disabled:opacity-50" />
  </div>
  <div class="mt-3">
    {#if !village}
      <div class="{CARD} p-8 text-center text-[#7a1420]/60">{$tr('select_village_first')}</div>
    {:else if !searchQuery}
      <div class="{CARD} p-8 text-center text-[#7a1420]/60">{$tr('type_to_search')}</div>
    {:else if people.length === 0}
      <div class="{CARD} p-8 text-center text-[#7a1420]/60">{$tr('no_matches')}</div>
    {:else}
      <div class="space-y-2">
        {#each people as u (u.ID)}
          <button class="{CARD} flex w-full items-center justify-between p-3 text-left" onclick={() => (selected = u)}>
            <span class="truncate text-sm font-semibold text-[#7a1420]">{nameOf(u)}</span>
            <ChevronRight class="h-4 w-4 text-[#B01E2E]" />
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
