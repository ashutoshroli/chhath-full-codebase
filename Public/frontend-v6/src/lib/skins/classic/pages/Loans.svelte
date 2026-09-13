<script lang="ts">
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { loanItems, ALL_YEARS } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';

  let loading = $derived($portalState.status === 'loading');
  let items = $derived(loanItems($portalState.data, $year));
  const nameOf = (x: { name: string; nameHindi: string }) =>
    $lang === 'hi' && x.nameHindi ? x.nameHindi : x.name;
  const villageOf = (g: { village: string; villageHindi: string }) =>
    $lang === 'hi' && g.villageHindi ? g.villageHindi : g.village;
</script>

<svelte:head><title>{$tr('loan_distribution')} — {$tr('app_title')}</title></svelte:head>

<h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-100">{$tr('loan_distribution')}</h2>

{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="min-h-[200px] space-y-3">
    {#each Array(3) as _}<div class="skeleton h-40 w-full rounded-xl"></div>{/each}
  </div>
{:else if items.length === 0}
  <div class="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
    {$tr('not_distributed')}
  </div>
{:else}
  <div class="space-y-4">
    {#each items as l, i (l.loanId || i)}
      <div class="rounded-xl border-l-4 border-[#F59E0B] bg-white p-5 shadow-sm dark:bg-gray-800">
        <h3 class="text-base font-bold text-gray-800 dark:text-gray-100">
          {$tr('surplus_loan')}{#if $year === ALL_YEARS} ({l.year}){/if}
        </h3>
        <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">{$tr('given_to_verified')}</p>

        <div class="text-[0.8rem] text-gray-500 dark:text-gray-400">{$tr('receiver_name')}</div>
        <div class="mb-3 text-lg font-bold text-gray-800 dark:text-gray-100">{nameOf(l) || $tr('na')}</div>

        <div class="grid grid-cols-3 gap-2 text-center text-sm">
          <div class="rounded-lg bg-gray-100 p-2 dark:bg-gray-700/50">
            <div class="text-[0.72rem] text-gray-500 dark:text-gray-400">{$tr('amount')}</div>
            <div class="font-bold text-gray-800 dark:text-gray-100">{fmt(l.principal)}</div>
          </div>
          <div class="rounded-lg bg-gray-100 p-2 dark:bg-gray-700/50">
            <div class="text-[0.72rem] text-gray-500 dark:text-gray-400">{$tr('int_rate')}</div>
            <div class="font-bold text-gray-800 dark:text-gray-100">{l.ratePerMonth}%</div>
          </div>
          <div class="rounded-lg bg-gray-100 p-2 dark:bg-gray-700/50">
            <div class="text-[0.72rem] text-gray-500 dark:text-gray-400">{$tr('tenure')}</div>
            <div class="font-bold text-gray-800 dark:text-gray-100">{l.tenure} Mo</div>
          </div>
        </div>

        <h4 class="mb-2 mt-4 text-sm font-bold text-gray-700 dark:text-gray-200">{$tr('verified_guarantors')}</h4>
        {#if l.guarantors.length === 0}
          <p class="text-xs text-gray-400">{$tr('no_guarantors')}</p>
        {:else}
          <div class="space-y-1.5">
            {#each l.guarantors as g, gi (g.seed + '-' + gi)}
              <div class="flex items-center justify-between gap-2 rounded-lg bg-gray-50 p-2 dark:bg-gray-700/40">
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{g.name || $tr('na')}</div>
                  <div class="text-[0.7rem] text-gray-500 dark:text-gray-400">
                    {#if villageOf(g)}{villageOf(g)} · {/if}{$tr('contributor_yes_no')}: {g.isContributor ? $tr('yes') : $tr('no')} · {$tr('committee_yes_no')}: {g.isCommittee ? $tr('yes') : $tr('no')}
                  </div>
                </div>
                {#if g.ruleViolation}
                  <span class="flex-none rounded bg-red-100 px-2 py-0.5 text-[0.68rem] font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300">{$tr('rule_violation')}</span>
                {:else}
                  <span class="flex-none rounded bg-emerald-100 px-2 py-0.5 text-[0.68rem] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{$tr('valid_guarantor')}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
