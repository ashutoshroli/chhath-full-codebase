<script lang="ts">
  /**
   * Festival home (NEW v6) — celebratory maroon+gold: a decorated budget banner,
   * gold-bordered stat cards and a warm contributor list. Shared derive.
   */
  import { Crown } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { computeFinancials, rankedContributors, resoldItemsForYear, contributorTags, ALL_YEARS } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { CARD } from '../fest';

  let loading = $derived($portalState.status === 'loading');
  let fin = $derived(computeFinancials($portalState.data, $year));
  let ranked = $derived(rankedContributors($portalState.data, $year));
  let resold = $derived(resoldItemsForYear($portalState.data, $year));
  let yearLabel = $derived($year === ALL_YEARS ? $tr('all_years') : String($year));

  let tab = $state<'contributors' | 'resold'>('contributors');
  let search = $state('');
  let filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter((r) => r.item.name.toLowerCase().includes(q) || r.item.nameHindi.toLowerCase().includes(q));
  });
  const nameOf = (c: { name: string; nameHindi: string }) => ($lang === 'hi' && c.nameHindi ? c.nameHindi : c.name);
  const tagLabel = (t: 'material' | 'service') => (t === 'material' ? $tr('material') : $tr('service'));
</script>

<svelte:head><title>Chhath Puja Transparency Portal — Navyuvak Chhath Puja Samiti</title></svelte:head>

{#if $portalState.failed}
  <ErrorState />
{:else}
  <!-- Decorated budget banner — gradient + highlight come from theme tokens so
       festival (maroon/gold) and heritage-serif (green/antique-gold) look
       distinct on the same skin. -->
  <div
    class="relative overflow-hidden rounded-2xl p-6 text-center text-white shadow-lg"
    style="background-image: linear-gradient(to bottom right, var(--fest-banner-from), var(--fest-banner-to));"
  >
    <div class="pointer-events-none absolute inset-0 opacity-30" style="background: radial-gradient(70% 60% at 50% 0%, rgb(var(--accent-2) / 0.6), transparent 60%);"></div>
    <div class="relative">
      <p class="text-xs font-bold tracking-wide text-[rgb(var(--accent-2))]">{$year === ALL_YEARS ? $tr('lifetime_budget_overview') : yearLabel + ' · ' + $tr('budget_overview')}</p>
      <p class="mt-1 text-[0.8rem] uppercase tracking-widest text-white/80">{$tr('total_budget')}</p>
      <p class="text-4xl font-black text-[rgb(var(--accent-2))] drop-shadow">{fmt(fin.totalBudget)}</p>

      <!-- Collected / Expenses / Past loan returned — each clearly labelled -->
      <div class="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm">
        <span class="text-emerald-300">↑ {$tr('collected')} {fmt(fin.collection)}</span>
        <span class="text-rose-200">↓ {$tr('expenses')} {fmt(fin.totalExpense)}</span>
        <span class="text-white/90">{$year === ALL_YEARS ? $tr('lifetime_loans_returned') : $tr('past_loan_returned')}: <b>{fmt(fin.pastLoanReturned)}</b></span>
      </div>

      <!-- Utilization progress + still-available (was missing on this skin) -->
      <div class="mx-auto mt-3 h-2 max-w-sm overflow-hidden rounded-full bg-white/15">
        <div class="h-full rounded-full bg-[rgb(var(--accent-2))]" style="width:{Math.min(100, fin.utilizedPct)}%"></div>
      </div>
      <p class="mt-1.5 text-xs text-white/80">{fin.utilizedPct.toFixed(1)}% {$tr('utilized')} · {fmt(fin.available)} {$tr('still_available')}</p>
    </div>
  </div>

  <div class="mt-4 grid grid-cols-2 gap-3">
    <div class="{CARD} p-4">
      <div class="text-xs font-semibold text-[rgb(var(--fest-ink)/0.7)]">{$tr('total_expense')}</div>
      <div class="text-lg font-black text-[rgb(var(--accent))]">{fmt(fin.totalExpense)}</div>
    </div>
    <div class="{CARD} p-4">
      <div class="text-xs font-semibold text-[rgb(var(--fest-ink)/0.7)]">{$tr('net_surplus')}</div>
      <div class="text-lg font-black text-emerald-700">{fmt(fin.netSurplus)}</div>
    </div>
  </div>

  <!-- Contributors / Resold tab toggle -->
  <div class="mb-3 mt-5 inline-flex gap-1 rounded-xl bg-[rgb(var(--accent-2)/0.15)] p-1">
    <button
      type="button"
      onclick={() => (tab = 'contributors')}
      class="rounded-lg px-3 py-1.5 text-sm font-black transition
        {tab === 'contributors' ? 'bg-white text-[rgb(var(--accent))] shadow-sm' : 'text-[rgb(var(--fest-ink)/0.6)]'}"
      aria-pressed={tab === 'contributors'}
    >{$tr('tab_contributors')} · {ranked.length}</button>
    <button
      type="button"
      onclick={() => (tab = 'resold')}
      class="rounded-lg px-3 py-1.5 text-sm font-black transition
        {tab === 'resold' ? 'bg-white text-[rgb(var(--accent))] shadow-sm' : 'text-[rgb(var(--fest-ink)/0.6)]'}"
      aria-pressed={tab === 'resold'}
    >{$tr('tab_resold')} · {resold.length}</button>
  </div>

  {#if tab === 'contributors'}
    <input type="search" bind:value={search} placeholder={$tr('search_by_name')}
      class="mb-4 w-full rounded-xl border border-[rgb(var(--accent-2)/0.6)] bg-white p-3 text-base text-[rgb(var(--fest-ink))] outline-none focus:border-[rgb(var(--accent))]" />

    <div class="{CARD} min-h-[200px] divide-y divide-[rgb(var(--accent-2)/0.3)] p-4">
      {#if loading}
        {#each Array(6) as _}<div class="my-3 h-5 animate-pulse rounded bg-[rgb(var(--accent-2)/0.2)]"></div>{/each}
      {:else if filtered.length === 0}
        <p class="py-8 text-center text-sm text-[rgb(var(--fest-ink)/0.6)]">{search ? $tr('no_matches') : $tr('no_records_found')}</p>
      {:else}
        {#each filtered as entry (entry.item.key)}
          {@const tags = contributorTags(entry.item)}
          <div class="flex items-center justify-between gap-3 py-3">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 font-semibold text-[rgb(var(--fest-ink))]">
                <span class="truncate">{nameOf(entry.item)}</span>
                {#if entry.isTop}<Crown class="h-3.5 w-3.5 flex-none fill-current text-[rgb(var(--accent-2))]" aria-label="Top {entry.rank}" />{/if}
                {#if entry.item.count > 1}<span class="flex-none rounded bg-[rgb(var(--accent-2)/0.25)] px-1 text-xs font-bold text-[rgb(var(--fest-ink)/0.7)]">{$tr('times_contributed', { count: entry.item.count })}</span>{/if}
              </div>
              {#if entry.item.village}<div class="truncate text-xs text-[rgb(var(--fest-ink)/0.6)]">{entry.item.village}</div>{/if}
            </div>
            <div class="flex flex-none items-center gap-1.5">
              {#if entry.item.hasMoney}<strong class="text-emerald-700">+{fmt(entry.item.amount)}</strong>{/if}
              {#each tags.filter((t) => t !== 'money') as t}
                <span class="rounded-md bg-[rgb(var(--accent)/0.1)] px-2 py-0.5 text-xs font-bold text-[rgb(var(--accent))]">{tagLabel(t as 'material' | 'service')}</span>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {:else}
    <div class="{CARD} min-h-[200px] divide-y divide-[rgb(var(--accent-2)/0.3)] p-4">
      {#if resold.length === 0}
        <p class="py-8 text-center text-sm text-[rgb(var(--fest-ink)/0.6)]">{$tr('no_resold_items')}</p>
      {:else}
        {#each resold as item (item.key)}
          <div class="flex items-center justify-between gap-3 py-3">
            <span class="min-w-0 truncate font-semibold text-[rgb(var(--fest-ink))]">{item.name || $tr('resold_item')}</span>
            <strong class="flex-none text-emerald-700">+{fmt(item.amount)}</strong>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
{/if}
