<script lang="ts">
  /**
   * Festival home (NEW v6) — celebratory maroon+gold: a decorated budget banner,
   * gold-bordered stat cards and a warm contributor list. Shared derive.
   */
  import { Crown } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { computeFinancials, rankedContributors, ALL_YEARS } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { CARD } from '../fest';

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

<svelte:head><title>Chhath Puja Transparency Portal — Navyuvak Chhath Puja Samiti</title></svelte:head>

{#if $portalState.failed}
  <ErrorState />
{:else}
  <!-- Decorated budget banner -->
  <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#7a1420] to-[#B01E2E] p-6 text-center text-[#ffe9c7] shadow-lg">
    <div class="pointer-events-none absolute inset-0 opacity-30" style="background: radial-gradient(70% 60% at 50% 0%, rgba(245,184,64,.6), transparent 60%);"></div>
    <div class="relative">
      <p class="text-xs font-bold tracking-wide text-[#F5B840]">{$year === ALL_YEARS ? $tr('lifetime_budget_overview') : yearLabel + ' · ' + $tr('budget_overview')}</p>
      <p class="mt-1 text-[0.8rem] uppercase tracking-widest text-[#ffe9c7]/80">{$tr('total_budget')}</p>
      <p class="text-4xl font-black text-[#F5B840] drop-shadow">{fmt(fin.totalBudget)}</p>
      <div class="mt-3 flex justify-center gap-5 text-sm">
        <span>{$year === ALL_YEARS ? $tr('lifetime_loans_returned') : $tr('past_loan_returned')}: <b>{fmt(fin.pastLoanReturned)}</b></span>
        <span class="text-emerald-300">+{fmt(fin.collection)}</span>
      </div>
    </div>
  </div>

  <div class="mt-4 grid grid-cols-2 gap-3">
    <div class="{CARD} p-4">
      <div class="text-xs font-semibold text-[#7a1420]/70">{$tr('total_expense')}</div>
      <div class="text-lg font-black text-[#B01E2E]">{fmt(fin.totalExpense)}</div>
    </div>
    <div class="{CARD} p-4">
      <div class="text-xs font-semibold text-[#7a1420]/70">{$tr('net_surplus')}</div>
      <div class="text-lg font-black text-emerald-700">{fmt(fin.netSurplus)}</div>
    </div>
  </div>

  <h3 class="mb-3 mt-5 text-base font-black text-[#7a1420]">{$tr('contributors_list')}</h3>
  <input type="search" bind:value={search} placeholder={$tr('search_by_name')}
    class="mb-4 w-full rounded-xl border border-[#F5B840]/60 bg-white p-3 text-base text-[#7a1420] outline-none focus:border-[#B01E2E]" />

  <div class="{CARD} min-h-[200px] divide-y divide-[#F5B840]/30 p-4">
    {#if loading}
      {#each Array(6) as _}<div class="my-3 h-5 animate-pulse rounded bg-[#F5B840]/20"></div>{/each}
    {:else if filtered.length === 0}
      <p class="py-8 text-center text-sm text-[#7a1420]/60">{search ? $tr('no_matches') : $tr('no_records_found')}</p>
    {:else}
      {#each filtered as entry (entry.item.key)}
        <div class="flex items-center justify-between gap-3 py-3">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 font-semibold text-[#7a1420]">
              <span class="truncate">{nameOf(entry.item)}</span>
              {#if entry.isTop}<Crown class="h-3.5 w-3.5 flex-none fill-current text-[#F5B840]" aria-label="Top {entry.rank}" />{/if}
            </div>
            {#if entry.item.village}<div class="truncate text-xs text-[#7a1420]/60">{entry.item.village}</div>{/if}
          </div>
          {#if entry.item.hasMoney}
            <strong class="flex-none text-emerald-700">+{fmt(entry.item.amount)}</strong>
          {:else}
            <span class="flex-none rounded-md bg-[#B01E2E]/10 px-2 py-0.5 text-xs font-bold text-[#B01E2E]">{entry.item.kinds.has('material') ? $tr('material') : $tr('service')}</span>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
{/if}
