<script lang="ts">
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { expenseItems } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import ErrorState from '$lib/components/ErrorState.svelte';

  let loading = $derived($portalState.status === 'loading');
  let items = $derived(expenseItems($portalState.data, $year));
  let total = $derived(items.reduce((s, e) => s + e.amount, 0));
  const desc = (e: { description: string; descriptionHindi: string }) =>
    $lang === 'hi' && e.descriptionHindi ? e.descriptionHindi : e.description;
</script>

<svelte:head><title>{$tr('expenses_ledger')} — {$tr('app_title')}</title></svelte:head>

<h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-100">{$tr('expenses_ledger')}</h2>

{#if $portalState.failed}
  <ErrorState />
{:else}
  <div class="mb-4 flex items-center justify-between rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <span class="text-sm font-semibold text-gray-600 dark:text-gray-300">{$tr('total_expense')}</span>
    <strong class="text-xl text-red-500">{fmt(total)}</strong>
  </div>

  <div class="min-h-[200px] rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
    {#if loading}
      {#each Array(6) as _}<div class="skeleton my-3 h-5 w-full"></div>{/each}
    {:else if items.length === 0}
      <p class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{$tr('no_expenses')}</p>
    {:else}
      {#each items as e, i (i)}
        <div class="flex items-center justify-between gap-3 border-b border-dashed border-gray-100 py-3 last:border-0 dark:border-gray-700">
          <div class="min-w-0">
            <div class="truncate font-medium text-gray-800 dark:text-gray-100">{desc(e) || $tr('na')}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">{#if e.category}{e.category} · {/if}{e.year}</div>
          </div>
          <strong class="flex-none text-red-500">-{fmt(e.amount)}</strong>
        </div>
      {/each}
    {/if}
  </div>
{/if}
