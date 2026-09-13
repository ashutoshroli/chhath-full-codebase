<script lang="ts">
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { loanItems, ALL_YEARS } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { CARD } from '../fest';

  let loading = $derived($portalState.status === 'loading');
  let items = $derived(loanItems($portalState.data, $year));
  const nameOf = (x: { name: string; nameHindi: string }) => ($lang === 'hi' && x.nameHindi ? x.nameHindi : x.name);
  const villageOf = (g: { village: string; villageHindi: string }) => ($lang === 'hi' && g.villageHindi ? g.villageHindi : g.village);
</script>

<svelte:head><title>{$tr('loan_distribution')} — {$tr('app_title')}</title></svelte:head>

<h1 class="mb-4 text-xl font-black text-[#7a1420]">{$tr('loan_distribution')}</h1>
{#if $portalState.failed}
  <ErrorState />
{:else if loading}
  <div class="space-y-3">{#each Array(3) as _}<div class="h-40 animate-pulse rounded-2xl bg-[#F5B840]/20"></div>{/each}</div>
{:else if items.length === 0}
  <div class="{CARD} p-8 text-center text-[#7a1420]/60">{$tr('not_distributed')}</div>
{:else}
  <div class="space-y-4">
    {#each items as l, i (l.loanId || i)}
      <div class="{CARD} border-l-4 !border-l-[#F5B840] p-5">
        <h3 class="text-xs font-bold uppercase tracking-wide text-[#B01E2E]">{$tr('surplus_loan')}{#if $year === ALL_YEARS} · {l.year}{/if}</h3>
        <div class="mt-1 text-lg font-black text-[#7a1420]">{nameOf(l) || $tr('na')}</div>
        <div class="text-xs text-[#7a1420]/60">{$tr('given_to_verified')}</div>
        <div class="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div class="rounded-lg bg-[#F5B840]/15 p-2.5 text-center"><div class="text-[0.7rem] text-[#7a1420]/60">{$tr('amount')}</div><div class="font-bold text-[#7a1420]">{fmt(l.principal)}</div></div>
          <div class="rounded-lg bg-[#F5B840]/15 p-2.5 text-center"><div class="text-[0.7rem] text-[#7a1420]/60">{$tr('int_rate')}</div><div class="font-bold text-[#7a1420]">{l.ratePerMonth}%</div></div>
          <div class="rounded-lg bg-[#F5B840]/15 p-2.5 text-center"><div class="text-[0.7rem] text-[#7a1420]/60">{$tr('tenure')}</div><div class="font-bold text-[#7a1420]">{l.tenure} Mo</div></div>
        </div>
        <h4 class="mb-2 mt-4 text-sm font-bold text-[#7a1420]">{$tr('verified_guarantors')}</h4>
        {#if l.guarantors.length === 0}
          <p class="text-xs text-[#7a1420]/50">{$tr('no_guarantors')}</p>
        {:else}
          <div class="space-y-1.5">
            {#each l.guarantors as g, gi (g.seed + '-' + gi)}
              <div class="flex items-center justify-between gap-2 rounded-lg bg-[#fff6e6] p-2">
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-[#7a1420]">{g.name || $tr('na')}</div>
                  <div class="text-[0.7rem] text-[#7a1420]/60">{#if villageOf(g)}{villageOf(g)} · {/if}{$tr('contributor_yes_no')}: {g.isContributor ? $tr('yes') : $tr('no')} · {$tr('committee_yes_no')}: {g.isCommittee ? $tr('yes') : $tr('no')}</div>
                </div>
                {#if g.ruleViolation}
                  <span class="flex-none rounded bg-[#B01E2E]/10 px-2 py-0.5 text-[0.68rem] font-bold text-[#B01E2E]">{$tr('rule_violation')}</span>
                {:else}
                  <span class="flex-none rounded bg-emerald-100 px-2 py-0.5 text-[0.68rem] font-bold text-emerald-700">{$tr('valid_guarantor')}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
