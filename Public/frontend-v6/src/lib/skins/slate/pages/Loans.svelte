<script lang="ts">
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { loanItems, ALL_YEARS } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';

  let loading = $derived($portalState.status === 'loading');
  let items = $derived(loanItems($portalState.data, $year));
  const nameOf = (x: { name: string; nameHindi: string }) => ($lang === 'hi' && x.nameHindi ? x.nameHindi : x.name);
  const villageOf = (g: { village: string; villageHindi: string }) => ($lang === 'hi' && g.villageHindi ? g.villageHindi : g.village);
</script>

<svelte:head><title>{$tr('loan_distribution')} — {$tr('app_title')}</title></svelte:head>

<h1 class="mb-4 text-xl font-bold text-slate-900 dark:text-white">{$tr('loan_distribution')}</h1>

{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="space-y-3">{#each Array(3) as _}<div class="skeleton h-40 w-full rounded-2xl"></div>{/each}</div>
{:else if items.length === 0}
  <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">{$tr('not_distributed')}</div>
{:else}
  <div class="space-y-4">
    {#each items as l, i (l.loanId || i)}
      <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">{$tr('surplus_loan')}{#if $year === ALL_YEARS} · {l.year}{/if}</h3>
            <div class="mt-1 text-lg font-bold text-slate-900 dark:text-white">{nameOf(l) || $tr('na')}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400">{$tr('given_to_verified')}</div>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div class="rounded-lg border border-slate-200 p-2.5 text-center dark:border-slate-800">
            <div class="text-[0.7rem] text-slate-500 dark:text-slate-400">{$tr('amount')}</div>
            <div class="font-bold text-slate-800 dark:text-slate-100">{fmt(l.principal)}</div>
          </div>
          <div class="rounded-lg border border-slate-200 p-2.5 text-center dark:border-slate-800">
            <div class="text-[0.7rem] text-slate-500 dark:text-slate-400">{$tr('int_rate')}</div>
            <div class="font-bold text-slate-800 dark:text-slate-100">{l.ratePerMonth}%</div>
          </div>
          <div class="rounded-lg border border-slate-200 p-2.5 text-center dark:border-slate-800">
            <div class="text-[0.7rem] text-slate-500 dark:text-slate-400">{$tr('tenure')}</div>
            <div class="font-bold text-slate-800 dark:text-slate-100">{l.tenure} Mo</div>
          </div>
        </div>

        <h4 class="mb-2 mt-4 text-sm font-semibold text-slate-700 dark:text-slate-200">{$tr('verified_guarantors')}</h4>
        {#if l.guarantors.length === 0}
          <p class="text-xs text-slate-400">{$tr('no_guarantors')}</p>
        {:else}
          <div class="space-y-1.5">
            {#each l.guarantors as g, gi (g.seed + '-' + gi)}
              <div class="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2 dark:border-slate-800">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{g.name || $tr('na')}</div>
                  <div class="text-[0.7rem] text-slate-500 dark:text-slate-400">
                    {#if villageOf(g)}{villageOf(g)} · {/if}{$tr('contributor_yes_no')}: {g.isContributor ? $tr('yes') : $tr('no')} · {$tr('committee_yes_no')}: {g.isCommittee ? $tr('yes') : $tr('no')}
                  </div>
                </div>
                {#if g.ruleViolation}
                  <span class="flex-none rounded-md bg-red-50 px-2 py-0.5 text-[0.68rem] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">{$tr('rule_violation')}</span>
                {:else}
                  <span class="flex-none rounded-md bg-emerald-50 px-2 py-0.5 text-[0.68rem] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{$tr('valid_guarantor')}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
