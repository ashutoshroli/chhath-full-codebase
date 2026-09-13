<script lang="ts">
  import { ReceiptText, Search } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import SkeletonList from '$lib/components/SkeletonList.svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { expenseItems } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';

  let query = $state('');
  let debounced = $state('');
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const q = query;
    clearTimeout(timer);
    timer = setTimeout(() => (debounced = q.trim().toLowerCase()), 180);
    return () => clearTimeout(timer);
  });

  let loading = $derived($portalState.status === 'loading');
  let items = $derived(expenseItems($portalState.data, $year));
  let total = $derived(items.reduce((s, e) => s + e.amount, 0));

  let view = $derived.by(() => {
    if (!debounced) return items;
    return items.filter(
      (e) =>
        e.description.toLowerCase().includes(debounced) ||
        e.descriptionHindi.toLowerCase().includes(debounced) ||
        e.category.toLowerCase().includes(debounced)
    );
  });

  const desc = (e: { description: string; descriptionHindi: string }) =>
    $lang === 'hi' && e.descriptionHindi ? e.descriptionHindi : e.description;
</script>

<svelte:head>
  <title>{$tr('expenses_ledger')} — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={ReceiptText} titleKey="expenses_ledger" />

{#if $portalState.failed}
  <ErrorState />
{:else}
  <!-- Total summary -->
  <div class="surface mb-3 flex items-center justify-between p-4">
    <span class="text-sm font-semibold text-slate-600 dark:text-slate-300">{$tr('total_expense')}</span>
    <span class="text-2xl font-black text-danger">{fmt(total)}</span>
  </div>

  <label class="relative mb-3 block">
    <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    <input
      class="w-full rounded-xl bg-black/5 py-2 pl-9 pr-3 text-sm outline-none dark:bg-white/10"
      placeholder={$tr('search')}
      bind:value={query}
      aria-label={$tr('search')}
      type="search"
    />
  </label>

  {#if loading}
    <SkeletonList rows={6} />
  {:else if view.length === 0}
    <EmptyState message={debounced ? $tr('no_matches') : $tr('no_expenses')} />
  {:else}
    <ul class="space-y-2.5">
      {#each view as e, i (i)}
        <li class="surface flex items-center gap-3 p-3.5">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger/12 text-danger">
            <ReceiptText class="h-5 w-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold">{desc(e) || $tr('na')}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {#if e.category}{e.category} · {/if}{e.year}
            </p>
          </div>
          <span class="shrink-0 font-extrabold text-danger">{fmt(e.amount)}</span>
        </li>
      {/each}
    </ul>
  {/if}
{/if}
