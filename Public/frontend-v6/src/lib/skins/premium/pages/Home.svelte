<script lang="ts">
  import HeroBanner from '$lib/components/HeroBanner.svelte';
  import FinancialOverview from '$lib/components/FinancialOverview.svelte';
  import SummaryCards from '$lib/components/SummaryCards.svelte';
  import LiveScroll from '$lib/components/LiveScroll.svelte';
  import DecadeBanner from '$lib/components/DecadeBanner.svelte';
  import ContributorDetail from '$lib/components/ContributorDetail.svelte';
  import ContributorsListModal from '$lib/components/ContributorsListModal.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { rankedContributors } from '$lib/api/derive';
  import type { Ranked } from '$lib/utils/ranking';
  import type { Contributor } from '$lib/api/derive';

  let selected = $state<Ranked<Contributor> | null>(null);
  let listOpen = $state(false);

  function onSelect(key: string) {
    const ranked = rankedContributors($portalState.data, $year);
    selected = ranked.find((r) => r.item.key === key) ?? null;
  }
</script>

<svelte:head>
  <title>Chhath Puja Transparency Portal — Navyuvak Chhath Puja Samiti</title>
  <meta
    name="description"
    content="Every contribution is visible. Every expense is accountable. Live financial transparency for Navyuvak Chhath Puja Samiti, Shaharpura, Gardih."
  />
</svelte:head>

{#if $portalState.failed}
  <ErrorState />
{:else}
  <div class="space-y-3">
    <HeroBanner />
    <FinancialOverview />
    <SummaryCards onRecordedClick={() => (listOpen = true)} />
    <LiveScroll onselect={onSelect} oncountclick={() => (listOpen = true)} />
    <DecadeBanner />
  </div>
{/if}

<ContributorDetail entry={selected} onclose={() => (selected = null)} />
<ContributorsListModal open={listOpen} onclose={() => (listOpen = false)} />
