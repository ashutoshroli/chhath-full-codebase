<script lang="ts">
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { expenseItems } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { CARD } from '../fest';

  let loading = $derived($portalState.status === 'loading');
  let items = $derived(expenseItems($portalState.data, $year));
  let total = $derived(items.reduce((s, e) => s + e.amount, 0));
  const desc = (e: { description: string; descriptionHindi: string }) => ($lang === 'hi' && e.descriptionHindi ? e.descriptionHindi : e.description);
</script>

<svelte:head><title>{$tr('expenses_ledger')} — {$tr('app_title')}</title></svelte:head>

<h1 class="mb-4 text-xl font-black text-[rgb(var(--fest-ink))]">{$tr('expenses_ledger')}</h1>
{#if $portalState.failed}
  <ErrorState />
{:else}
  <div class="{CARD} mb-3 flex items-center justify-between p-4">
    <span class="text-sm font-semibold text-[rgb(var(--fest-ink)/0.7)]">{$tr('total_expense')}</span>
    <strong class="text-xl text-[rgb(var(--accent))]">{fmt(total)}</strong>
  </div>
  <div class="{CARD} divide-y divide-[rgb(var(--accent-2)/0.3)] p-4">
    {#if loading}
      {#each Array(6) as _}<div class="my-3 h-5 animate-pulse rounded bg-[rgb(var(--accent-2)/0.2)]"></div>{/each}
    {:else if items.length === 0}
      <p class="py-8 text-center text-sm text-[rgb(var(--fest-ink)/0.6)]">{$tr('no_expenses')}</p>
    {:else}
      {#each items as e, i (i)}
        <div class="flex items-center justify-between gap-3 py-3">
          <div class="min-w-0">
            <div class="truncate font-medium text-[rgb(var(--fest-ink))]">{desc(e) || $tr('na')}</div>
            <div class="text-xs text-[rgb(var(--fest-ink)/0.6)]">{#if e.category}{e.category} · {/if}{e.year}</div>
          </div>
          <strong class="flex-none text-[rgb(var(--accent))]">-{fmt(e.amount)}</strong>
        </div>
      {/each}
    {/if}
  </div>
{/if}
