<script lang="ts">
  import { Trophy, Heart, Info } from '@lucide/svelte';
  import { tr, lang } from '$lib/stores/lang';
  import { portalState } from '$lib/stores/portal';
  import { decadeStats, journeyEntries, journeyTagline } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import { CARD } from '../fest';
  import { DECADE_TIMELINE, DECADE_MILESTONES } from '$lib/utils/decadeData';

  let d = $derived(decadeStats($portalState.data));
  let story = $derived(journeyEntries($portalState.data));
  let storyByYear = $derived(
    new Map(story.map((e, i) => [String(e.year), {
      i,
      title: $lang === 'hi' && e.titleHi ? e.titleHi : e.titleEn,
      content: $lang === 'hi' && e.contentHi ? e.contentHi : e.contentEn
    }]))
  );
  let tagline = $derived(journeyTagline($portalState.data));
  let taglineText = $derived(($lang === 'hi' ? tagline.hi : tagline.en) || $tr('decade_sub'));
  let rangeVars = $derived({ start: d.startYear, end: d.endYear });
</script>

<svelte:head><title>{$tr('decade_title')} — {$tr('app_title')}</title></svelte:head>

<!-- Hero -->
<div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[rgb(var(--fest-ink))] to-[rgb(var(--accent))] p-6 text-center text-white shadow-lg">
  <div class="pointer-events-none absolute inset-0 opacity-30" style="background: radial-gradient(70% 60% at 50% 0%, rgb(var(--accent-2) / 0.6), transparent 60%);"></div>
  <div class="relative">
    <Trophy class="mx-auto h-8 w-8 text-[rgb(var(--accent-2))]" aria-hidden="true" />
    <p class="mt-2 text-xs font-bold text-[rgb(var(--accent-2))]">{$tr('decade_years', rangeVars)}</p>
    <h1 class="text-2xl font-black text-[rgb(var(--accent-2))]">{$tr('decade_title')}</h1>
    <p class="mt-1 text-sm text-white/80">{taglineText}</p>
    <p class="mx-auto mt-3 max-w-xl text-sm text-white/90">{$tr('decade_intro')}</p>
  </div>
</div>

<!-- Origin -->
<div class="{CARD} mt-4 p-5">
  <h3 class="text-base font-black text-[rgb(var(--accent))]">{$tr('decade_origin_h')}</h3>
  <div class="mt-2 space-y-2 text-sm text-[rgb(var(--fest-ink))]">
    <p>{$tr('decade_origin_p1')}</p>
    <p>{$tr('decade_origin_p2')}</p>
    <p>{$tr('decade_origin_p3')}</p>
    <p class="font-semibold text-[rgb(var(--fest-ink))]">{$tr('decade_origin_p4')}</p>
  </div>
</div>

<!-- Year-by-year -->
<h3 class="mb-3 mt-4 px-1 text-sm font-extrabold text-[rgb(var(--accent))]">{$tr('decade_journey')}</h3>
<div class="{CARD} p-5">
  <ol class="relative space-y-4 border-l-2 border-[rgb(var(--accent-2))] pl-5">
    {#each d.years as row (row.year)}
      {@const entry = storyByYear.get(String(row.year))}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-[rgb(var(--accent))] text-[10px] font-black text-[rgb(var(--accent-2))]">{row.year - d.startYear + 1}</span>
        <h4 class="text-sm font-black text-[rgb(var(--accent))]">{entry?.title || row.year}</h4>
        {#if entry?.content}<p class="mt-1 text-sm text-[rgb(var(--fest-ink))]">{entry.content}</p>{/if}
        <div class="mt-2 flex flex-wrap gap-2">
          <span class="rounded-lg bg-emerald-600/10 px-3 py-1.5 text-xs font-bold text-emerald-800">{$tr('decade_total_label')}: {fmt(row.total)}</span>
          <span class="rounded-lg bg-[rgb(var(--accent)/0.1)] px-3 py-1.5 text-xs font-bold text-[rgb(var(--accent))]">{$tr('decade_contributors_label')}: {row.contributors}</span>
        </div>
        {#if row.isCurrent}
          <div class="mt-2 flex items-start gap-2 rounded-lg bg-[rgb(var(--accent-2)/0.2)] p-3 text-xs text-[rgb(var(--fest-ink))]">
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
  <p class="font-mono text-xs text-[rgb(var(--fest-ink)/0.7)]">{$tr('decade_evolution_line')}</p>
  <h3 class="mt-2 text-base font-black text-[rgb(var(--accent))]">{$tr('decade_portal_h')}</h3>
  <p class="mt-1 text-sm text-[rgb(var(--fest-ink))]">{$tr('decade_portal_p')}</p>
</div>

<!-- Table -->
<div class="{CARD} mt-4 p-5">
  <h3 class="text-base font-black text-[rgb(var(--fest-ink))]">{$tr('decade_table_h', rangeVars)}</h3>
  <div class="mt-3">
    <div class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-[rgb(var(--accent-2)/0.5)] pb-2 text-xs font-bold uppercase text-[rgb(var(--fest-ink)/0.7)]">
      <span>{$tr('decade_th_year')}</span>
      <span>{$tr('decade_th_total')}</span>
      <span>{$tr('decade_th_contributors')}</span>
    </div>
    {#each d.years as r (r.year)}
      <div class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-[rgb(var(--accent-2)/0.3)] py-2 text-sm last:border-0">
        <span class="font-bold text-[rgb(var(--accent))]">{r.year}{#if r.isCurrent} •{/if}</span>
        <span class="font-semibold text-emerald-800">{fmt(r.total)}</span>
        <span class="text-[rgb(var(--fest-ink))]">{r.contributors}</span>
      </div>
    {/each}
  </div>
  <div class="mt-4 rounded-xl bg-[rgb(var(--accent)/0.1)] p-4">
    <p class="text-xs font-extrabold uppercase text-[rgb(var(--accent))]">{$tr('decade_totals_h', rangeVars)}</p>
    <p class="mt-1 text-lg font-black text-[rgb(var(--fest-ink))]">{$tr('decade_total_amount', { amount: fmt(d.grandTotal) })}</p>
    <p class="text-sm font-bold text-[rgb(var(--fest-ink))]">{$tr('decade_total_entries', { count: d.grandContributors })}</p>
    <p class="mt-2 text-xs text-[rgb(var(--fest-ink)/0.7)]">{$tr('decade_total_clarify', { count: d.grandContributors })}</p>
  </div>
</div>

<!-- Transparency timeline -->
<h3 class="mb-3 mt-4 px-1 text-sm font-extrabold text-[rgb(var(--accent))]">{$tr('decade_timeline_h')}</h3>
<div class="{CARD} p-5">
  <ol class="relative space-y-3 border-l-2 border-[rgb(var(--accent-2))] pl-5">
    {#each DECADE_TIMELINE as step, i}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-[rgb(var(--accent))] text-[10px] font-black text-[rgb(var(--accent-2))]">{i + 1}</span>
        <p class="text-sm font-black text-[rgb(var(--accent))]">{$tr(step.headingKey)}</p>
        <p class="mt-0.5 text-sm text-[rgb(var(--fest-ink))]">{$tr(step.bodyKey)}</p>
      </li>
    {/each}
  </ol>
</div>

<!-- Thinking / milestones -->
<div class="{CARD} mt-4 p-5">
  <h3 class="text-base font-black text-[rgb(var(--fest-ink))]">{$tr('decade_think_h')}</h3>
  <p class="mt-1 text-sm font-bold text-[rgb(var(--accent))]">{$tr('decade_think_lead')}</p>
  <p class="mt-2 text-sm text-[rgb(var(--fest-ink))]">{$tr('decade_think_p')}</p>
  <div class="mt-4 grid gap-2.5 sm:grid-cols-3">
    {#each DECADE_MILESTONES as m}
      <div class="rounded-xl border border-[rgb(var(--accent-2)/0.5)] p-4">
        <p class="text-sm font-black text-[rgb(var(--accent))]">{$tr(m.headingKey)}</p>
        <p class="mt-0.5 text-xs text-[rgb(var(--fest-ink)/0.8)]">{$tr(m.bodyKey)}</p>
      </div>
    {/each}
  </div>
</div>

<!-- Closing -->
<div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[rgb(var(--fest-ink))] to-[rgb(var(--accent))] p-6 text-center text-white shadow-lg mt-4">
  <div class="pointer-events-none absolute inset-0 opacity-30" style="background: radial-gradient(70% 60% at 50% 0%, rgb(var(--accent-2) / 0.6), transparent 60%);"></div>
  <div class="relative">
    <h3 class="text-lg font-black text-[rgb(var(--accent-2))]">{$tr('decade_closing_h')}</h3>
    <div class="mx-auto mt-2 max-w-xl space-y-2 text-sm text-white/90">
      <p>{$tr('decade_closing_p1')}</p>
      <p>{$tr('decade_closing_p2')}</p>
      <p>{$tr('decade_closing_p3')}</p>
    </div>
  </div>
</div>

<p class="mt-5 text-center text-sm font-medium text-[rgb(var(--accent))]">{$tr('decade_footer')}</p>

<p class="mt-4 flex items-center justify-center gap-1.5 text-base font-black text-[rgb(var(--accent))]">{$tr('seva_line')} <Heart class="h-4 w-4 fill-current text-[rgb(var(--accent))]" /></p>
