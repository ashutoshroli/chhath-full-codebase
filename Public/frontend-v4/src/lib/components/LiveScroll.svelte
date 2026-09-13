<script lang="ts">
  /**
   * Contributors Live Scroll — the ONE contributor showcase on the home page.
   *
   * Behaviour required by the brief:
   *  - Full contribution dataset for the selected year (per-person, ranked).
   *  - Automatic horizontal scroll LEFT -> RIGHT (content moves leftward so new
   *    cards enter from the right), seamless infinite loop.
   *  - Touch swipe (native overflow), manual prev/next controls, pause/resume.
   *  - Pauses on hover / touch / when tab hidden / reduced-motion. No layout shift.
   *  - Only Top-5 cards carry the crown/gold treatment (handled in ContributorCard).
   */
  import { ChevronLeft, ChevronRight, Pause, Play, Radio } from '@lucide/svelte';
  import { browser } from '$app/environment';
  import { portalState, year } from '$lib/stores/portal';
  import { tr } from '$lib/stores/lang';
  import { rankedContributors, ALL_YEARS } from '$lib/api/derive';
  import ContributorCard from './ContributorCard.svelte';

  interface Props {
    onselect?: (key: string) => void;
  }
  let { onselect }: Props = $props();

  let ranked = $derived(rankedContributors($portalState.data, $year));
  let loading = $derived($portalState.status === 'loading');
  // Duplicate the list once for a seamless loop (only when there's enough to scroll).
  let doubled = $derived(ranked.length > 3 ? [...ranked, ...ranked] : ranked);

  let track: HTMLDivElement | undefined = $state();
  let paused = $state(false);
  let userPaused = $state(false);
  let reduceMotion = $state(false);

  const SPEED = 0.5; // px per frame (~30px/s at 60fps) — gentle, readable

  $effect(() => {
    if (!browser) return;
    reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const onVis = () => (paused = document.hidden ? true : paused);
    document.addEventListener('visibilitychange', onVis);

    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      const el = track;
      if (!el || paused || userPaused || reduceMotion) return;
      if (ranked.length <= 3) return;
      // Move content leftward so cards flow L -> R into view.
      el.scrollLeft += SPEED;
      // Seamless loop: the track holds 2 copies; reset at the halfway point.
      const half = el.scrollWidth / 2;
      if (el.scrollLeft >= half) el.scrollLeft -= half;
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  });

  function nudge(dir: 1 | -1) {
    track?.scrollBy({ left: dir * 240, behavior: 'smooth' });
  }
</script>

<section class="surface p-4 sm:p-5">
  <div class="mb-3 flex items-center gap-2">
    <span class="grid h-7 w-7 place-items-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-300">
      <Radio class="h-4 w-4" aria-hidden="true" />
    </span>
    <h2 class="text-sm font-extrabold sm:text-base">
      {$tr('contributors_live_scroll', { year: $year === ALL_YEARS ? $tr('all_years') : $year })}
    </h2>
    <span class="hidden rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success xs:inline">
      ● {$tr('live')}
    </span>
    <span class="ml-auto hidden text-[10px] text-slate-400 sm:inline">
      {$tr('total_contributions', { count: ranked.length })}
    </span>

    <div class="flex items-center gap-1">
      <button class="chip !h-8 !px-2" onclick={() => nudge(-1)} aria-label={$tr('prev')}>
        <ChevronLeft class="h-4 w-4" />
      </button>
      <button
        class="chip !h-8 !px-2"
        onclick={() => (userPaused = !userPaused)}
        aria-label={userPaused ? $tr('play') : $tr('pause')}
        aria-pressed={userPaused}
      >
        {#if userPaused}<Play class="h-4 w-4" />{:else}<Pause class="h-4 w-4" />{/if}
      </button>
      <button class="chip !h-8 !px-2" onclick={() => nudge(1)} aria-label={$tr('next')}>
        <ChevronRight class="h-4 w-4" />
      </button>
    </div>
  </div>

  {#if loading}
    <div class="flex gap-2.5 overflow-hidden">
      {#each Array(7) as _}
        <div class="skeleton h-[132px] w-[104px] shrink-0 rounded-2xl"></div>
      {/each}
    </div>
  {:else if ranked.length === 0}
    <p class="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{$tr('no_records_found')}</p>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={track}
      class="no-scrollbar flex gap-2.5 overflow-x-auto scroll-smooth pb-1 pt-2.5"
      style="scroll-snap-type: x proximity;"
      onpointerenter={() => (paused = true)}
      onpointerleave={() => (paused = false)}
      ontouchstart={() => (paused = true)}
      ontouchend={() => (paused = false)}
      role="list"
      aria-label={$tr('contributors_live_scroll', { year: $year })}
    >
      {#each doubled as entry, i (entry.item.key + '-' + i)}
        <div role="listitem" aria-hidden={i >= ranked.length ? 'true' : undefined}>
          <ContributorCard {entry} compact onclick={() => onselect?.(entry.item.key)} />
        </div>
      {/each}
    </div>
  {/if}
</section>
