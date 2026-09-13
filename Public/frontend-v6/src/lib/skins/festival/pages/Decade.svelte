<script lang="ts">
  import { Trophy, Heart, Info } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { portalState } from '$lib/stores/portal';
  import { decadeStats } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import { CARD } from '../fest';
  import { DECADE_YEARS, DECADE_TIMELINE, DECADE_MILESTONES } from '$lib/utils/decadeData';

  let d = $derived(decadeStats($portalState.data));
  let storyByYear = $derived(new Map(DECADE_YEARS.map((y, i) => [y.year, { ...y, i }])));
  let rangeVars = $derived({ start: d.startYear, end: d.endYear });
</script>

<svelte:head><title>{$tr('decade_title')} — {$tr('app_title')}</title></svelte:head>

<!-- Hero -->
<div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#7a1420] to-[#B01E2E] p-6 text-center text-[#ffe9c7] shadow-lg">
  <div class="pointer-events-none absolute inset-0 opacity-30" style="background: radial-gradient(70% 60% at 50% 0%, rgba(245,184,64,.6), transparent 60%);"></div>
  <div class="relative">
    <Trophy class="mx-auto h-8 w-8 text-[#F5B840]" aria-hidden="true" />
    <p class="mt-2 text-xs font-bold text-[#F5B840]">{$tr('decade_years', rangeVars)}</p>
    <h1 class="text-2xl font-black text-[#F5B840]">{$tr('decade_title')}</h1>
    <p class="mt-1 text-sm text-[#ffe9c7]/80">{$tr('decade_sub')}</p>
    <p class="mx-auto mt-3 max-w-xl text-sm text-[#ffe9c7]/90">{$tr('decade_intro')}</p>
  </div>
</div>

<!-- Origin -->
<div class="{CARD} mt-4 p-5">
  <h3 class="text-base font-black text-[#B01E2E]">{$tr('decade_origin_h')}</h3>
  <div class="mt-2 space-y-2 text-sm text-[#7a1420]">
    <p>{$tr('decade_origin_p1')}</p>
    <p>{$tr('decade_origin_p2')}</p>
    <p>{$tr('decade_origin_p3')}</p>
    <p class="font-semibold text-[#5a0f18]">{$tr('decade_origin_p4')}</p>
  </div>
</div>

<!-- Year-by-year -->
<h3 class="mb-3 mt-4 px-1 text-sm font-extrabold text-[#B01E2E]">{$tr('decade_journey')}</h3>
<div class="{CARD} p-5">
  <ol class="relative space-y-4 border-l-2 border-[#F5B840] pl-5">
    {#each d.years as row (row.year)}
      {@const story = storyByYear.get(String(row.year))}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-[#B01E2E] text-[10px] font-black text-[#F5B840]">{row.year - d.startYear + 1}</span>
        <h4 class="text-sm font-black text-[#B01E2E]">{story ? $tr(story.headingKey) : row.year}</h4>
        {#if story}<p class="mt-1 text-sm text-[#7a1420]">{$tr(story.bodyKey)}</p>{/if}
        <div class="mt-2 flex flex-wrap gap-2">
          <span class="rounded-lg bg-emerald-600/10 px-3 py-1.5 text-xs font-bold text-emerald-800">{$tr('decade_total_label')}: {fmt(row.total)}</span>
          <span class="rounded-lg bg-[#B01E2E]/10 px-3 py-1.5 text-xs font-bold text-[#B01E2E]">{$tr('decade_contributors_label')}: {row.contributors}</span>
        </div>
        {#if row.isCurrent}
          <div class="mt-2 flex items-start gap-2 rounded-lg bg-[#F5B840]/20 p-3 text-xs text-[#7a1420]">
            <Info class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p class="font-bold">{$tr('decade_current_note_h', { year: row.year })}</p>
              <p class="mt-0.5">{$tr('decade_current_note_p', { year: row.year })}</p>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</div>

<!-- Portal callout -->
<div class="{CARD} mt-4 p-5 text-center">
  <p class="font-mono text-xs text-[#7a1420]/70">{$tr('decade_evolution_line')}</p>
  <h3 class="mt-2 text-base font-black text-[#B01E2E]">{$tr('decade_portal_h')}</h3>
  <p class="mt-1 text-sm text-[#7a1420]">{$tr('decade_portal_p')}</p>
</div>

<!-- Table -->
<div class="{CARD} mt-4 p-5">
  <h3 class="text-base font-black text-[#5a0f18]">{$tr('decade_table_h', rangeVars)}</h3>
  <div class="mt-3">
    <div class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-[#F5B840]/50 pb-2 text-xs font-bold uppercase text-[#7a1420]/70">
      <span>{$tr('decade_th_year')}</span>
      <span>{$tr('decade_th_total')}</span>
      <span>{$tr('decade_th_contributors')}</span>
    </div>
    {#each d.years as r (r.year)}
      <div class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-[#F5B840]/30 py-2 text-sm last:border-0">
        <span class="font-bold text-[#B01E2E]">{r.year}{#if r.isCurrent} •{/if}</span>
        <span class="font-semibold text-emerald-800">{fmt(r.total)}</span>
        <span class="text-[#7a1420]">{r.contributors}</span>
      </div>
    {/each}
  </div>
  <div class="mt-4 rounded-xl bg-[#B01E2E]/10 p-4">
    <p class="text-xs font-extrabold uppercase text-[#B01E2E]">{$tr('decade_totals_h', rangeVars)}</p>
    <p class="mt-1 text-lg font-black text-[#5a0f18]">{$tr('decade_total_amount', { amount: fmt(d.grandTotal) })}</p>
    <p class="text-sm font-bold text-[#7a1420]">{$tr('decade_total_entries', { count: d.grandContributors })}</p>
    <p class="mt-2 text-xs text-[#7a1420]/70">{$tr('decade_total_clarify', { count: d.grandContributors })}</p>
  </div>
</div>

<!-- Transparency timeline -->
<h3 class="mb-3 mt-4 px-1 text-sm font-extrabold text-[#B01E2E]">{$tr('decade_timeline_h')}</h3>
<div class="{CARD} p-5">
  <ol class="relative space-y-3 border-l-2 border-[#F5B840] pl-5">
    {#each DECADE_TIMELINE as step, i}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-[#B01E2E] text-[10px] font-black text-[#F5B840]">{i + 1}</span>
        <p class="text-sm font-black text-[#B01E2E]">{$tr(step.headingKey)}</p>
        <p class="mt-0.5 text-sm text-[#7a1420]">{$tr(step.bodyKey)}</p>
      </li>
    {/each}
  </ol>
</div>

<!-- Thinking / milestones -->
<div class="{CARD} mt-4 p-5">
  <h3 class="text-base font-black text-[#5a0f18]">{$tr('decade_think_h')}</h3>
  <p class="mt-1 text-sm font-bold text-[#B01E2E]">{$tr('decade_think_lead')}</p>
  <p class="mt-2 text-sm text-[#7a1420]">{$tr('decade_think_p')}</p>
  <div class="mt-4 grid gap-2.5 sm:grid-cols-3">
    {#each DECADE_MILESTONES as m}
      <div class="rounded-xl border border-[#F5B840]/50 p-4">
        <p class="text-sm font-black text-[#B01E2E]">{$tr(m.headingKey)}</p>
        <p class="mt-0.5 text-xs text-[#7a1420]/80">{$tr(m.bodyKey)}</p>
      </div>
    {/each}
  </div>
</div>

<!-- Closing -->
<div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#7a1420] to-[#B01E2E] p-6 text-center text-[#ffe9c7] shadow-lg mt-4">
  <div class="pointer-events-none absolute inset-0 opacity-30" style="background: radial-gradient(70% 60% at 50% 0%, rgba(245,184,64,.6), transparent 60%);"></div>
  <div class="relative">
    <h3 class="text-lg font-black text-[#F5B840]">{$tr('decade_closing_h')}</h3>
    <div class="mx-auto mt-2 max-w-xl space-y-2 text-sm text-[#ffe9c7]/90">
      <p>{$tr('decade_closing_p1')}</p>
      <p>{$tr('decade_closing_p2')}</p>
      <p>{$tr('decade_closing_p3')}</p>
    </div>
  </div>
</div>

<p class="mt-5 text-center text-sm font-medium text-[#B01E2E]">{$tr('decade_footer')}</p>

<p class="mt-4 flex items-center justify-center gap-1.5 text-base font-black text-[#B01E2E]">{$tr('seva_line')} <Heart class="h-4 w-4 fill-current text-[#B01E2E]" /></p>
