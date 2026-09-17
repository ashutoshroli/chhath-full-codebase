<script lang="ts">
  /**
   * Contributors Live Scroll — the ONE contributor showcase on the home page.
   *
   *  - Full per-person, ranked dataset for the selected year.
   *  - Continuous automatic horizontal scroll (content moves left; cards flow in
   *    from the right), seamless infinite loop via a duplicated track.
   *  - Manual: touch swipe + prev/next buttons temporarily take over (auto pauses
   *    briefly, then resumes). Pause/resume button. Pauses on hover, when the tab
   *    is hidden, and under reduced-motion.
   *
   * Implementation: the auto-scroll drives `scrollLeft` directly (no CSS
   * scroll-behavior:smooth / scroll-snap, which fight per-frame updates and make
   * it stutter/stick). Manual swipe just uses native overflow scrolling.
   */
  import { ChevronLeft, ChevronRight, Pause, Play, Radio } from '@lucide/svelte';
  import { browser } from '$app/environment';
  import { portalState, year } from '$lib/stores/portal';
  import { tr } from '$lib/stores/lang';
  import { rankedContributors, ALL_YEARS } from '$lib/api/derive';
  import ContributorCard from './ContributorCard.svelte';

  interface Props {
    onselect?: (key: string) => void;
    oncountclick?: () => void;
  }
  let { onselect, oncountclick }: Props = $props();

  let ranked = $derived(rankedContributors($portalState.data, $year));
  let loading = $derived($portalState.status === 'loading');
  // Duplicate the list for a seamless loop (only when there's enough to scroll).
  let canLoop = $derived(ranked.length > 3);
  let doubled = $derived(canLoop ? [...ranked, ...ranked] : ranked);

  let track: HTMLDivElement | undefined = $state();
  let hovering = $state(false);
  let userPaused = $state(false);
  let reduceMotion = $state(false);
  // While the user is actively swiping/nudging, suspend auto-scroll for a moment.
  let interactingUntil = 0;

  const SPEED = 0.6; // px per frame (~36px/s @60fps) — gentle and readable

  // audit PR-41: `prefers-reduced-motion` was read ONCE. A visitor who turns the setting on —
  // which people with vestibular disorders do precisely BECAUSE something is moving — kept the
  // animation for the life of the page. It is a listener now, so the change takes effect at once.
  $effect(() => {
    if (!browser) return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    reduceMotion = mq.matches;
    const onChange = (e: MediaQueryListEvent) => (reduceMotion = e.matches);
    // Safari < 14 has no addEventListener on MediaQueryList; committee phones are old.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener?.(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener?.(onChange);
    };
  });

  // Re-read on visibility change too: `document.hidden` is not reactive, so without this the
  // loop below could not know the tab had come back.
  let tabHidden = $state(false);
  $effect(() => {
    if (!browser) return;
    tabHidden = document.hidden;
    const onVis = () => (tabHidden = document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });

  // Whether the scroller should be animating at all. Derived, so the effect below STARTS and
  // STOPS with it rather than running for ever.
  let shouldAnimate = $derived(canLoop && !userPaused && !hovering && !reduceMotion && !tabHidden);

  // audit PR-41: this used to schedule the next frame UNCONDITIONALLY and then return early
  // when inactive — so a paused, hovered, hidden or reduced-motion scroller still woke the
  // browser 60 times a second for the life of the page. On a phone that is measurable battery
  // for no pixels changed. The rAF loop now exists only while it has something to do.
  $effect(() => {
    if (!browser || !shouldAnimate) return;

    let raf = 0;
    const step = () => {
      const el = track;
      if (el && Date.now() >= interactingUntil) {
        el.scrollLeft += SPEED;
        // Seamless loop: track holds 2 copies; wrap at the halfway mark.
        const half = el.scrollWidth / 2;
        if (half > 0 && el.scrollLeft >= half) el.scrollLeft -= half;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });

  function nudge(dir: 1 | -1) {
    interactingUntil = Date.now() + 1200;
    track?.scrollBy({ left: dir * 240, behavior: 'smooth' });
  }
  function markInteracting() {
    interactingUntil = Date.now() + 1500;
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
    {#if oncountclick}
      <button
        type="button"
        onclick={oncountclick}
        aria-label={$tr('summary_view_list_label')}
        class="ml-auto hidden rounded text-[10px] font-semibold text-brand-600 underline decoration-dotted underline-offset-2 transition hover:text-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 cursor-pointer dark:text-brand-300 sm:inline"
      >{$tr('summary_view_list')}</button>
    {:else}
      <span class="ml-auto hidden text-[10px] text-slate-400 sm:inline">
        {$tr('total_contributions', { count: ranked.length })}
      </span>
    {/if}

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
      class="no-scrollbar flex gap-2.5 overflow-x-auto pb-1 pt-2.5"
      onpointerenter={() => (hovering = true)}
      onpointerleave={() => (hovering = false)}
      ontouchstart={markInteracting}
      ontouchmove={markInteracting}
      onwheel={markInteracting}
      role="list"
      aria-label={$tr('contributors_live_scroll', { year: $year })}
    >
      {#each doubled as entry, i (entry.item.key + '-' + i)}
        <!-- audit PR-41: the second copy exists only to make the loop seamless. `aria-hidden`
             kept it out of the screen-reader tree but NOT out of the tab order, so a keyboard
             user tabbed through every contributor twice and half of them announced nothing at
             all. `inert` removes them from focus and from the a11y tree together, which is the
             only combination that is honest. -->
        {@const isDuplicate = i >= ranked.length}
        <div role="listitem" inert={isDuplicate} aria-hidden={isDuplicate ? 'true' : undefined}>
          <ContributorCard {entry} compact onclick={() => onselect?.(entry.item.key)} />
        </div>
      {/each}
    </div>
  {/if}
</section>
