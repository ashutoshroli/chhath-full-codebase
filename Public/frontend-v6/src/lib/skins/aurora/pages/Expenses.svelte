<script lang="ts">
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { expenseItems } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { GLASS } from '../glass';

  let loading = $derived($portalState.status === 'loading');
  let items = $derived(expenseItems($portalState.data, $year));
  let total = $derived(items.reduce((s, e) => s + e.amount, 0));
  const desc = (e: { description: string; descriptionHindi: string }) => ($lang === 'hi' && e.descriptionHindi ? e.descriptionHindi : e.description);
</script>

<svelte:head><title>{$tr('expenses_ledger')} — {$tr('app_title')}</title></svelte:head>

<h1 class="mb-4 text-xl font-bold text-white">{$tr('expenses_ledger')}</h1>
{#if $portalState.failed}
  <ErrorState />
{:else}
  <div class="{GLASS} mb-3 flex items-center justify-between p-4">
    <span class="text-sm font-medium text-slate-300">{$tr('total_expense')}</span>
    <strong class="text-xl text-rose-300">{fmt(total)}</strong>
  </div>
  <div class="{GLASS} divide-y divide-white/10 p-4">
    {#if loading}
      {#each Array(6) as _}<div class="my-3 h-5 animate-pulse rounded bg-white/10"></div>{/each}
    {:else if items.length === 0}
      <p class="py-8 text-center text-sm text-slate-400">{$tr('no_expenses')}</p>
    {:else}
      {#each items as e, i (i)}
        <div class="flex items-center justify-between gap-3 py-3">
          <div class="min-w-0">
            <div class="truncate font-medium text-white">{desc(e) || $tr('na')}</div>
            <div class="text-xs text-slate-400">{#if e.category}{e.category} · {/if}{e.year}</div>
          </div>
          <strong class="flex-none text-rose-300">-{fmt(e.amount)}</strong>
        </div>
      {/each}
    {/if}
  </div>
{/if}
