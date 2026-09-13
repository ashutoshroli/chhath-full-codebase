<script lang="ts">
  /**
   * Slate (v2) home: the "Master Financial Calculation" panel with a 5-column
   * budget grid (Past Loan / Current Collection / TOTAL BUDGET highlighted /
   * Total Expense / Net Surplus) + a bordered contributor list. Shared derive.
   */
  import { Crown } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { computeFinancials, rankedContributors, ALL_YEARS } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';

  let loading = $derived($portalState.status === 'loading');
  let fin = $derived(computeFinancials($portalState.data, $year));
  let ranked = $derived(rankedContributors($portalState.data, $year));
  let yearLabel = $derived($year === ALL_YEARS ? $tr('all_years') : String($year));

  let search = $state('');
  let filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter((r) => r.item.name.toLowerCase().includes(q) || r.item.nameHindi.toLowerCase().includes(q));
  });
  const nameOf = (c: { name: string; nameHindi: string }) => ($lang === 'hi' && c.nameHindi ? c.nameHindi : c.name);
</script>

<svelte:head>
  <title>Chhath Puja Transparency Portal — Navyuvak Chhath Puja Samiti</title>
</svelte:head>

{#if $portalState.failed}
  <ErrorState />
{:else}
  <section class="space-y-6">
    <!-- Master financial calculation panel -->
    <div class="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:to-slate-950 sm:p-7">
      <div class="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h1 class="text-xl font-bold text-slate-900 dark:text-white sm:text-2xl">{$tr('master_calc')}</h1>
        <p class="text-sm font-semibold text-brand-600 dark:text-brand-400">
          {$year === ALL_YEARS ? $tr('lifetime_budget_overview') : yearLabel + ' ' + $tr('budget_overview')}
        </p>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="text-xs font-medium text-slate-500 dark:text-slate-400">{$year === ALL_YEARS ? $tr('lifetime_loans_returned') : $tr('past_loan_returned')}</div>
          <div class="mt-1 text-lg font-bold text-slate-800 dark:text-slate-100">{fmt(fin.pastLoanReturned)}</div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="text-xs font-medium text-slate-500 dark:text-slate-400">{$year === ALL_YEARS ? $tr('lifetime_collections') : $tr('current_year_collection')}</div>
          <div class="mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">+{fmt(fin.collection)}</div>
        </div>
        <div class="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900/50 dark:bg-brand-900/20">
          <div class="text-xs font-semibold text-brand-700 dark:text-brand-300">{$tr('total_budget')}</div>
          <div class="mt-1 text-xl font-extrabold text-brand-700 dark:text-brand-300">{fmt(fin.totalBudget)}</div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="text-xs font-medium text-slate-500 dark:text-slate-400">{$tr('total_expense')}</div>
          <div class="mt-1 text-lg font-bold text-red-600 dark:text-red-400">{fmt(fin.totalExpense)}</div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="text-xs font-medium text-slate-500 dark:text-slate-400">{$tr('net_surplus')}</div>
          <div class="mt-1 text-lg font-bold text-slate-800 dark:text-slate-100">{fmt(fin.netSurplus)}</div>
        </div>
      </div>
    </div>

    <!-- Contributors -->
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 class="text-lg font-bold text-slate-900 dark:text-white">{$tr('contributors_list')}</h2>
        <input
          type="search"
          bind:value={search}
          placeholder={$tr('search_by_name')}
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none
            focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 sm:w-64"
        />
      </div>

      <div class="divide-y divide-slate-100 dark:divide-slate-800">
        {#if loading}
          {#each Array(6) as _}
            <div class="flex items-center justify-between py-3">
              <div class="skeleton h-4 w-1/3"></div><div class="skeleton h-4 w-16"></div>
            </div>
          {/each}
        {:else if filtered.length === 0}
          <p class="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{search ? $tr('no_matches') : $tr('no_records_found')}</p>
        {:else}
          {#each filtered as entry (entry.item.key)}
            <div class="flex items-center justify-between gap-3 py-3">
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-100">
                  <span class="truncate">{nameOf(entry.item)}</span>
                  {#if entry.isTop}<Crown class="h-3.5 w-3.5 flex-none fill-current text-amber-500" aria-label="Top {entry.rank}" />{/if}
                </div>
                {#if entry.item.village}<div class="truncate text-xs text-slate-500 dark:text-slate-400">{entry.item.village}</div>{/if}
              </div>
              {#if entry.item.hasMoney}
                <strong class="flex-none text-emerald-600 dark:text-emerald-400">+{fmt(entry.item.amount)}</strong>
              {:else}
                <span class="flex-none rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {entry.item.kinds.has('material') ? $tr('material') : $tr('service')}
                </span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </section>
{/if}
