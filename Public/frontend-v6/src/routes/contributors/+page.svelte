<script lang="ts">
  import { Users, Search } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import ContributorCard from '$lib/components/ContributorCard.svelte';
  import ContributorDetail from '$lib/components/ContributorDetail.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { rankedContributors } from '$lib/api/derive';
  import type { Ranked } from '$lib/utils/ranking';
  import type { Contributor } from '$lib/api/derive';

  type SortKey = 'amount_desc' | 'amount_asc' | 'name';

  let query = $state('');
  let debounced = $state('');
  let sortKey = $state<SortKey>('amount_desc');
  let selected = $state<Ranked<Contributor> | null>(null);

  // Debounce the search input (fast, mobile-friendly).
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const q = query;
    clearTimeout(timer);
    timer = setTimeout(() => (debounced = q.trim().toLowerCase()), 180);
    return () => clearTimeout(timer);
  });

  let loading = $derived($portalState.status === 'loading');
  // Ranking is always computed on the full year dataset so ranks are stable,
  // THEN we filter/sort the view — filtering never changes a person's rank.
  let allRanked = $derived(rankedContributors($portalState.data, $year));

  let view = $derived.by(() => {
    const q = debounced;
    let list = allRanked;
    if (q) {
      list = list.filter(
        (r) =>
          r.item.name.toLowerCase().includes(q) ||
          r.item.nameHindi.toLowerCase().includes(q) ||
          r.item.village.toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    if (sortKey === 'amount_asc') sorted.sort((a, b) => a.item.amount - b.item.amount);
    else if (sortKey === 'name')
      sorted.sort((a, b) => a.item.name.localeCompare(b.item.name, $lang === 'hi' ? 'hi' : 'en'));
    // amount_desc keeps the ranked order.
    return sorted;
  });
</script>

<svelte:head>
  <title>{$tr('contributors_list')} — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={Users} titleKey="contributors_list" />

{#if $portalState.failed}
  <ErrorState />
{:else}
  <!-- Controls -->
  <div class="surface mb-3 flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
    <label class="relative flex-1">
      <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        class="w-full rounded-xl bg-black/5 py-2 pl-9 pr-3 text-sm outline-none dark:bg-white/10"
        placeholder={$tr('search_by_name')}
        bind:value={query}
        aria-label={$tr('search_by_name')}
        type="search"
      />
    </label>
    <select
      class="chip !h-10"
      bind:value={sortKey}
      aria-label={$tr('sort')}
    >
      <option value="amount_desc">{$tr('sort_amount_desc')}</option>
      <option value="amount_asc">{$tr('sort_amount_asc')}</option>
      <option value="name">{$tr('sort_name')}</option>
    </select>
  </div>

  {#if loading}
    <div class="grid grid-cols-3 gap-2.5 xs:grid-cols-4 sm:grid-cols-5 md:grid-cols-6">
      {#each Array(12) as _}
        <div class="skeleton h-[132px] rounded-2xl"></div>
      {/each}
    </div>
  {:else if view.length === 0}
    <EmptyState message={debounced ? $tr('no_matches') : $tr('no_records_found')} />
  {:else}
    <p class="mb-2 text-xs text-slate-500 dark:text-slate-400">
      {$tr('total_contributions', { count: view.length })}
    </p>
    <div class="grid grid-cols-3 gap-2.5 xs:grid-cols-4 sm:grid-cols-5 md:grid-cols-6">
      {#each view as entry (entry.item.key)}
        <ContributorCard {entry} compact={false} onclick={() => (selected = entry)} />
      {/each}
    </div>
  {/if}
{/if}

<ContributorDetail entry={selected} onclose={() => (selected = null)} />
