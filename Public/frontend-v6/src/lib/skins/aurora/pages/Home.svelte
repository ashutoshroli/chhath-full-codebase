<script lang="ts">
  /**
   * Aurora home (NEW v6) — a bento-grid glass dashboard: a big budget tile,
   * small stat tiles, and a live contributor rail. Shared derive.
   *
   * The contributor rail is the shared <LiveScroll> (same component premium
   * uses), so aurora gets the identical right-to-left auto-scroll + prev/pause/
   * next controls + pause-on-interaction, and tapping a card opens the shared
   * ContributorDetail card (with photo). It restyles per skin automatically via
   * the themed `surface`/`chip`/`brand-*` classes.
   */
  import { TrendingDown, TrendingUp, Landmark, Users } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr } from '$lib/stores/lang';
  import { computeFinancials, computeSummary, rankedContributors, ALL_YEARS, type Contributor } from '$lib/api/derive';
  import type { Ranked } from '$lib/utils/ranking';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import ContributorsListModal from '$lib/components/ContributorsListModal.svelte';
  import ContributorDetail from '$lib/components/ContributorDetail.svelte';
  import LiveScroll from '$lib/components/LiveScroll.svelte';
  import { GLASS } from '../glass';

  let fin = $derived(computeFinancials($portalState.data, $year));
  let sum = $derived(computeSummary($portalState.data, $year));
  let yearLabel = $derived($year === ALL_YEARS ? $tr('all_years') : String($year));
  let listOpen = $state(false);
  let selected = $state<Ranked<Contributor> | null>(null);

  function onSelect(key: string) {
    const ranked = rankedContributors($portalState.data, $year);
    selected = ranked.find((r) => r.item.key === key) ?? null;
  }
</script>

<svelte:head><title>Chhath Puja Transparency Portal — Navyuvak Chhath Puja Samiti</title></svelte:head>

<!-- audit PR-41: every page needs exactly one h1, and the Home pages had none in three of
     the five skins. It is visually hidden rather than drawn: the hero/banner below already
     shows the portal's name to a sighted visitor, so adding a second visible title would be
     redundant, while a screen-reader user had NO page name at all and heading navigation
     landed nowhere. -->
<h1 class="sr-only">{$tr('app_title')}</h1>


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

  <!-- Contributors rail: shared live auto-scroll marquee (same as premium),
       tap a card to open the detail card with photo. -->
  <div class="mt-3">
    <LiveScroll onselect={onSelect} oncountclick={() => (listOpen = true)} />
  </div>
{/if}

<ContributorsListModal open={listOpen} onclose={() => (listOpen = false)} />
<ContributorDetail entry={selected} onclose={() => (selected = null)} />
