<script lang="ts">
  /**
   * Aurora home (NEW v6) — a bento-grid glass dashboard: a big budget tile,
   * small stat tiles, and a scrollable contributor rail. Shared derive.
   */
  import { Crown, TrendingDown, TrendingUp, Landmark, Users } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { computeFinancials, computeSummary, rankedContributors, contributorTags, ALL_YEARS } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import { initials, avatarGradient } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import ContributorsListModal from '$lib/components/ContributorsListModal.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { GLASS } from '../glass';

  let loading = $derived($portalState.status === 'loading');
  let fin = $derived(computeFinancials($portalState.data, $year));
  let sum = $derived(computeSummary($portalState.data, $year));
  let ranked = $derived(rankedContributors($portalState.data, $year));
  let yearLabel = $derived($year === ALL_YEARS ? $tr('all_years') : String($year));
  const nameOf = (c: { name: string; nameHindi: string }) => ($lang === 'hi' && c.nameHindi ? c.nameHindi : c.name);
  let listOpen = $state(false);
  // Photos that failed to load — fall back to the initials avatar rather than
  // hiding the image and leaving a blank gap.
  let failedPhotos = $state(new SvelteSet<string>());
</script>

<svelte:head><title>Chhath Puja Transparency Portal — Navyuvak Chhath Puja Samiti</title></svelte:head>

{#if $portalState.failed}
  <ErrorState />
{:else}
  <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
    <!-- Big budget tile (spans) -->
    <div class="{GLASS} col-span-2 p-5">
      <p class="text-xs font-semibold uppercase tracking-wide text-violet-300/80">
        {yearLabel} · {$tr('total_budget')}
      </p>
      <p class="mt-1 text-4xl font-black text-white">{fmt(fin.totalBudget)}</p>
      <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span class="text-emerald-300">↑ {$tr('collected')} {fmt(fin.collection)}</span>
        <span class="text-rose-300">↓ {$tr('expenses')} {fmt(fin.totalExpense)}</span>
      </div>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div class="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400" style="width:{Math.min(100, fin.utilizedPct)}%"></div>
      </div>
      <p class="mt-1.5 text-xs text-violet-200/70">{fin.utilizedPct.toFixed(1)}% {$tr('utilized')} · {fmt(fin.available)} {$tr('still_available')}</p>
    </div>

    <!-- stat tiles -->
    <button
      type="button"
      onclick={() => (listOpen = true)}
      aria-label={$tr('summary_view_list_label')}
      class="{GLASS} p-4 text-left transition active:scale-[.98] cursor-pointer hover:ring-2 hover:ring-violet-400/50"
    >
      <Users class="h-5 w-5 text-violet-300" aria-hidden="true" />
      <p class="mt-2 text-2xl font-black text-white">{sum.contributors}</p>
      <p class="text-[11px] text-slate-300">{$tr('summary_contributors')}</p>
      <p class="mt-0.5 text-[10px] text-violet-300/80 underline decoration-dotted underline-offset-2">{$tr('summary_tap_to_view')}</p>
    </button>
    <div class="{GLASS} p-4">
      <Landmark class="h-5 w-5 text-cyan-300" aria-hidden="true" />
      <p class="mt-2 text-lg font-black text-white">{fmt(fin.pastLoanReturned)}</p>
      <p class="text-[11px] text-slate-300">{$year === ALL_YEARS ? $tr('lifetime_loans_returned') : $tr('past_loan_returned')}</p>
    </div>
    <div class="{GLASS} p-4">
      <TrendingUp class="h-5 w-5 text-emerald-300" aria-hidden="true" />
      <p class="mt-2 text-lg font-black text-white">{fmt(sum.totalCollected)}</p>
      <p class="text-[11px] text-slate-300">{$tr('summary_total_collected')}</p>
    </div>
    <div class="{GLASS} p-4">
      <TrendingDown class="h-5 w-5 text-rose-300" aria-hidden="true" />
      <p class="mt-2 text-lg font-black text-white">{fmt(fin.netSurplus)}</p>
      <p class="text-[11px] text-slate-300">{$tr('net_surplus')}</p>
    </div>
  </div>

  <!-- Contributors rail -->
  <div class="{GLASS} mt-3 p-4">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-bold text-white">{$tr('contributors_live_scroll', { year: yearLabel })}</h2>
      <button
        type="button"
        onclick={() => (listOpen = true)}
        aria-label={$tr('summary_view_list_label')}
        class="rounded text-right text-[10px] font-semibold text-violet-300/90 underline decoration-dotted underline-offset-2 transition hover:text-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-400/50 cursor-pointer"
      >{$tr('summary_view_list')}</button>
    </div>
    {#if loading}
      <div class="flex gap-2.5 overflow-hidden">{#each Array(7) as _}<div class="h-28 w-24 shrink-0 animate-pulse rounded-xl bg-white/10"></div>{/each}</div>
    {:else if ranked.length === 0}
      <p class="py-6 text-center text-sm text-slate-400">{$tr('no_records_found')}</p>
    {:else}
      <div class="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
        {#each ranked as entry (entry.item.key)}
          {@const g = avatarGradient(entry.item.key)}
          {@const tags = contributorTags(entry.item)}
          <div class="relative w-24 shrink-0 rounded-xl border p-3 text-center {entry.isTop ? 'border-amber-300/50 bg-amber-300/10' : 'border-white/10 bg-white/5'}">
            {#if entry.isTop}<Crown class="absolute left-1/2 -top-2 h-4 w-4 -translate-x-1/2 fill-current text-amber-300" aria-label="Top {entry.rank}" />{/if}
            {#if entry.item.photo && !failedPhotos.has(entry.item.key)}
              <img src={entry.item.photo} alt={nameOf(entry.item)} loading="lazy" class="mx-auto h-10 w-10 rounded-full object-cover" onerror={() => failedPhotos.add(entry.item.key)} />
            {:else}
              <span class="mx-auto grid h-10 w-10 place-items-center rounded-full text-sm font-black text-white" style="background-image:linear-gradient(135deg,{g[0]},{g[1]})">{initials(nameOf(entry.item))}</span>
            {/if}
            <p class="mt-1.5 truncate text-[11px] font-semibold text-white">{nameOf(entry.item)}</p>
            {#if entry.item.hasMoney}
              <p class="text-xs font-black text-violet-200">{fmt(entry.item.amount)}</p>
            {/if}
            {#if tags.includes('material') || tags.includes('service')}
              <p class="text-[9px] font-bold text-cyan-300">
                {#if tags.includes('material')}{$tr('material')}{/if}{#if tags.includes('material') && tags.includes('service')} · {/if}{#if tags.includes('service')}{$tr('service')}{/if}
              </p>
            {/if}
            {#if entry.item.count > 1}
              <p class="text-[9px] font-semibold text-slate-400">{$tr('times_contributed', { count: entry.item.count })}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<ContributorsListModal open={listOpen} onclose={() => (listOpen = false)} />
