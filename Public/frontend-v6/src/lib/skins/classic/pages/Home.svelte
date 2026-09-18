<script lang="ts">
  /**
   * Classic (v3) home: dark budget card + two stat boxes + a vertical
   * contributor list — powered entirely by the shared derive functions.
   */
  import { Crown } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { computeFinancials, rankedContributors, resoldItemsForYear, contributorTags, ALL_YEARS, type Contributor } from '$lib/api/derive';
  import type { Ranked } from '$lib/utils/ranking';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import ContributorDetail from '$lib/components/ContributorDetail.svelte';

  let loading = $derived($portalState.status === 'loading');
  let fin = $derived(computeFinancials($portalState.data, $year));
  let ranked = $derived(rankedContributors($portalState.data, $year));
  let resold = $derived(resoldItemsForYear($portalState.data, $year));
  let yearLabel = $derived($year === ALL_YEARS ? $tr('all_years') : String($year));

  let tab = $state<'contributors' | 'resold'>('contributors');
  let search = $state('');
  let selected = $state<Ranked<Contributor> | null>(null);
  let filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter(
      (r) => r.item.name.toLowerCase().includes(q) || r.item.nameHindi.toLowerCase().includes(q)
    );
  });

  const nameOf = (c: { name: string; nameHindi: string }) =>
    $lang === 'hi' && c.nameHindi ? c.nameHindi : c.name;
  const tagLabel = (t: 'material' | 'service') => (t === 'material' ? $tr('material') : $tr('service'));
</script>

<svelte:head>
  <title>Chhath Puja Transparency Portal — Navyuvak Chhath Puja Samiti</title>
</svelte:head>

<!-- audit PR-41: every page needs exactly one h1, and the Home pages had none in three of
     the five skins. It is visually hidden rather than drawn: the hero/banner below already
     shows the portal's name to a sighted visitor, so adding a second visible title would be
     redundant, while a screen-reader user had NO page name at all and heading navigation
     landed nowhere. -->
<h1 class="sr-only">{$tr('app_title')}</h1>


{#if $portalState.failed}
  <ErrorState />
{:else}
  <!-- Dark budget card (v3 signature) -->
  <div class="mb-4 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 p-5 text-white shadow-lg">
    <div class="mb-1.5 text-[0.85rem] text-gray-400">{$tr('master_calc')}</div>
    <h2 class="mb-4 text-lg font-semibold">
      {$year === ALL_YEARS ? $tr('lifetime_budget_overview') : yearLabel + ' ' + $tr('budget_overview')}
    </h2>

    <div class="mb-2.5 flex justify-between text-[0.95rem]">
      <span>{$year === ALL_YEARS ? $tr('lifetime_loans_returned') : $tr('past_loan_returned')}</span>
      <strong>{fmt(fin.pastLoanReturned)}</strong>
    </div>
    <div class="mb-4 flex justify-between text-[0.95rem]">
      <span>{$year === ALL_YEARS ? $tr('lifetime_collections') : $tr('current_year_collection')}</span>
      <strong class="text-emerald-400">+{fmt(fin.collection)}</strong>
    </div>

    <div class="flex items-center justify-between border-t border-dashed border-gray-600 pt-4">
      <span class="text-[1.1rem] font-bold">{$tr('total_budget')}</span>
      <strong class="text-2xl text-[#F27A1A]">{fmt(fin.totalBudget)}</strong>
    </div>
  </div>

  <!-- Two stat boxes -->
  <div class="mb-5 grid grid-cols-2 gap-4">
    <div class="rounded-lg border-l-4 border-red-500 bg-gray-100 p-4 dark:bg-gray-800">
      <div class="text-[0.8rem] text-gray-500 dark:text-gray-400">{$tr('total_expense')}</div>
      <div class="text-lg font-bold text-red-500">{fmt(fin.totalExpense)}</div>
    </div>
    <div class="rounded-lg border-l-4 border-emerald-500 bg-gray-100 p-4 dark:bg-gray-800">
      <div class="text-[0.8rem] text-gray-500 dark:text-gray-400">{$tr('net_surplus')}</div>
      <div class="text-lg font-bold text-emerald-500">{fmt(fin.netSurplus)}</div>
    </div>
  </div>

  <!-- Contributors / Resold tab toggle -->
  <div class="mb-3 mt-1 inline-flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
    <button
      type="button"
      onclick={() => (tab = 'contributors')}
      class="rounded-md px-3 py-1.5 text-sm font-semibold transition
        {tab === 'contributors' ? 'bg-white text-[#F27A1A] shadow-sm dark:bg-gray-700' : 'text-gray-500 dark:text-gray-400'}"
      aria-pressed={tab === 'contributors'}
    >{$tr('tab_contributors')} · {ranked.length}</button>
    <button
      type="button"
      onclick={() => (tab = 'resold')}
      class="rounded-md px-3 py-1.5 text-sm font-semibold transition
        {tab === 'resold' ? 'bg-white text-[#F27A1A] shadow-sm dark:bg-gray-700' : 'text-gray-500 dark:text-gray-400'}"
      aria-pressed={tab === 'resold'}
    >{$tr('tab_resold')} · {resold.length}</button>
  </div>

  {#if tab === 'contributors'}
    <input
      type="search"
      bind:value={search}
      placeholder={$tr('search_by_name')}
      class="mb-4 w-full rounded-lg border border-gray-300 bg-white p-3 text-base outline-none
        focus:border-[#F27A1A] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
    />

    <div class="min-h-[200px] rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {#if loading}
        {#each Array(6) as _}
          <div class="flex items-center justify-between border-b border-dashed border-gray-100 py-3 last:border-0 dark:border-gray-700">
            <div class="skeleton h-4 w-1/3"></div>
            <div class="skeleton h-4 w-16"></div>
          </div>
        {/each}
      {:else if filtered.length === 0}
        <p class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          {search ? $tr('no_matches') : $tr('no_records_found')}
        </p>
      {:else}
        {#each filtered as entry (entry.item.key)}
          {@const tags = contributorTags(entry.item)}
          <button
            type="button"
            onclick={() => (selected = entry)}
            class="flex w-full items-center justify-between gap-3 border-b border-dashed border-gray-100 py-3 text-left last:border-0 transition hover:bg-black/[.02] focus-visible:ring-2 dark:border-gray-700 dark:hover:bg-white/[.03]"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-100">
                <span class="truncate">{nameOf(entry.item)}</span>
                {#if entry.isTop}
                  <Crown class="h-3.5 w-3.5 flex-none fill-current text-[#F5B840]" aria-label="Top {entry.rank}" />
                {/if}
                {#if entry.item.count > 1}
                  <span class="flex-none rounded bg-gray-100 px-1 text-xs font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-400">{$tr('times_contributed', { count: entry.item.count })}</span>
                {/if}
              </div>
              {#if entry.item.village}
                <div class="truncate text-xs text-gray-500 dark:text-gray-400">{entry.item.village}</div>
              {/if}
            </div>
            <div class="flex flex-none items-center gap-1.5">
              {#if entry.item.hasMoney}
                <strong class="text-emerald-600 dark:text-emerald-400">+{fmt(entry.item.amount)}</strong>
              {/if}
              {#each tags.filter((t) => t !== 'money') as t}
                <span class="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{tagLabel(t as 'material' | 'service')}</span>
              {/each}
            </div>
          </button>
        {/each}
      {/if}
    </div>
  {:else}
    <div class="min-h-[200px] rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {#if resold.length === 0}
        <p class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{$tr('no_resold_items')}</p>
      {:else}
        {#each resold as item (item.key)}
          <div class="flex items-center justify-between gap-3 border-b border-dashed border-gray-100 py-3 last:border-0 dark:border-gray-700">
            <span class="min-w-0 truncate font-semibold text-gray-800 dark:text-gray-100">{item.name || $tr('resold_item')}</span>
            <strong class="flex-none text-emerald-600 dark:text-emerald-400">+{fmt(item.amount)}</strong>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
{/if}

<ContributorDetail entry={selected} onclose={() => (selected = null)} />
