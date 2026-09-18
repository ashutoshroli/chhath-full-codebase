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
  import { tr } from '$lib/stores/lang';
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

<!-- audit PR-41/PWA: the default (premium) skin's home rendered NO h1 (h1Count:0 in the
     live audit), because HeroBanner uses only <p>. Match the other skins' sr-only pattern:
     a screen-reader-only page name that renders on BOTH the failed and ready branches, so
     heading navigation lands somewhere without changing the visual design. -->
<h1 class="sr-only">{$tr('app_title')}</h1>

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
