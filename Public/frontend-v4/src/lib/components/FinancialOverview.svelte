<script lang="ts">
  import { ArrowDownRight, ArrowUpRight, Landmark, RefreshCw } from '@lucide/svelte';
  import { portalState, year, refreshPortal } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { computeFinancials, ALL_YEARS } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import CountUp from './CountUp.svelte';
  import ProgressRing from './ProgressRing.svelte';

  let fin = $derived(computeFinancials($portalState.data, $year));
  let loading = $derived($portalState.status === 'loading');
  let refreshing = $state(false);

  async function onRefresh() {
    if (refreshing) return;
    refreshing = true;
    await refreshPortal();
    refreshing = false;
  }

  let updatedLabel = $derived(
    $portalState.savedAt
      ? new Intl.DateTimeFormat($lang === 'hi' ? 'hi-IN' : 'en-IN', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date($portalState.savedAt))
      : '—'
  );

  let yearLabel = $derived($year === ALL_YEARS ? $tr('all_years') : String($year));
</script>

<section class="surface p-4 sm:p-5">
  <!-- header row -->
  <div class="mb-4 flex items-center gap-2">
    <span class="inline-flex items-center gap-1.5 text-xs font-extrabold text-success">
      <span class="h-2 w-2 rounded-full bg-success shadow-[0_0_0_4px_rgba(16,185,129,.2)] animate-pulseDot"></span>
      {$tr('live')}
    </span>
    <h2 class="text-sm font-extrabold text-brand-700 dark:text-brand-300 sm:text-base">
      {yearLabel} · {$tr('financial_overview')}
    </h2>
    <div class="ml-auto flex items-center gap-2">
      <span class="hidden text-[10px] text-slate-400 sm:inline">
        {$tr('last_updated')}: {updatedLabel}
      </span>
      <button
        class="chip !h-8 !px-2"
        onclick={onRefresh}
        aria-label={$tr('refresh')}
        title={$tr('refresh')}
        disabled={refreshing}
      >
        <RefreshCw class="h-4 w-4 {refreshing ? 'animate-spin' : ''}" aria-hidden="true" />
      </button>
    </div>
  </div>

  {#if loading}
    <div class="grid grid-cols-[104px_1fr] items-center gap-4">
      <div class="skeleton h-26 w-26" style="height:104px;width:104px;border-radius:9999px"></div>
      <div class="space-y-2">
        <div class="skeleton h-3 w-24"></div>
        <div class="skeleton h-8 w-40"></div>
        <div class="skeleton h-3 w-32"></div>
      </div>
    </div>
    <div class="mt-4 space-y-2 border-t border-dashed border-black/10 pt-3 dark:border-white/10">
      {#each Array(3) as _}
        <div class="skeleton h-6 w-full"></div>
      {/each}
    </div>
  {:else}
    <div class="grid grid-cols-[104px_1fr] items-center gap-4">
      <ProgressRing percent={fin.utilizedPct} label={$tr('utilized')} />
      <div>
        <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">{$tr('total_budget')}</p>
        <p class="text-3xl font-black leading-tight text-brand-600 dark:text-brand-300 sm:text-4xl">
          <CountUp value={fin.totalBudget} format={fmt} />
        </p>
        <p class="mt-0.5 text-xs font-bold text-success">
          {fmt(fin.available)} {$tr('still_available')}
        </p>
      </div>
    </div>

    <dl class="mt-4 space-y-2.5 border-t border-dashed border-black/10 pt-3 dark:border-white/10">
      <div class="flex items-center gap-2.5 text-sm">
        <span class="grid h-7 w-7 place-items-center rounded-lg bg-success/15 text-success">
          <ArrowDownRight class="h-4 w-4" />
        </span>
        <dt class="flex-1 font-semibold text-slate-600 dark:text-slate-300">{$tr('collected')}</dt>
        <dd class="font-extrabold text-success">{fmt(fin.collection)}</dd>
      </div>
      <div class="flex items-center gap-2.5 text-sm">
        <span class="grid h-7 w-7 place-items-center rounded-lg bg-danger/15 text-danger">
          <ArrowUpRight class="h-4 w-4" />
        </span>
        <dt class="flex-1 font-semibold text-slate-600 dark:text-slate-300">{$tr('expenses')}</dt>
        <dd class="font-extrabold text-danger">{fmt(fin.totalExpense)}</dd>
      </div>
      <div class="flex items-center gap-2.5 text-sm">
        <span class="grid h-7 w-7 place-items-center rounded-lg bg-info/15 text-info">
          <Landmark class="h-4 w-4" />
        </span>
        <dt class="flex-1 font-semibold text-slate-600 dark:text-slate-300">
          {$year === ALL_YEARS ? $tr('lifetime_loans_returned') : $tr('past_loan_returned')}
        </dt>
        <dd class="font-extrabold text-info">{fmt(fin.pastLoanReturned)}</dd>
      </div>
    </dl>
  {/if}
</section>
