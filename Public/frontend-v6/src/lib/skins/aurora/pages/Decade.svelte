<script lang="ts">
  import { Trophy, Heart, Info } from '@lucide/svelte';
  import { tr, lang } from '$lib/stores/lang';
  import { portalState } from '$lib/stores/portal';
  import { decadeStats, journeyEntries, journeyTagline, journeyText, interp } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import { GLASS } from '../glass';
  import { DECADE_MILESTONES } from '$lib/utils/decadeData';

  let d = $derived(decadeStats($portalState.data));
  // DB-managed page text (mgmt "Journey Content" tab); i18n fallback per field.
  let jt = $derived(journeyText($portalState.data, $lang));
  const T = (key: string, i18nKey: string, vars?: Record<string, string | number>) =>
    key in jt ? interp(jt[key], vars) : $tr(i18nKey, vars);
  const TIMELINE = [
    ['tl_paper', 'decade_tl_paper'], ['tl_pdf', 'decade_tl_pdf'], ['tl_wa', 'decade_tl_wa'],
    ['tl_sheets', 'decade_tl_sheets'], ['tl_portal', 'decade_tl_portal']
  ] as const;
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
<div class="{GLASS} p-6 text-center">
  <span class="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-violet-500/20 text-violet-200"><Trophy class="h-6 w-6" aria-hidden="true" /></span>
  <p class="mt-2 text-xs font-bold text-violet-300">{$tr('decade_years', rangeVars)}</p>
  <h1 class="text-2xl font-black text-white">{$tr('decade_title')}</h1>
  <p class="mt-1 text-sm text-slate-300">{taglineText}</p>
  <p class="mx-auto mt-3 max-w-xl text-sm text-slate-200/90">{T('intro', 'decade_intro')}</p>
</div>

<!-- Origin -->
<div class="{GLASS} mt-4 p-5">
  <h3 class="text-base font-black text-violet-200">{T('origin_h', 'decade_origin_h')}</h3>
  <div class="mt-2 space-y-2 text-sm text-slate-200">
    <p>{T('origin_p1', 'decade_origin_p1')}</p>
    <p>{T('origin_p2', 'decade_origin_p2')}</p>
    <p>{T('origin_p3', 'decade_origin_p3')}</p>
    <p class="font-semibold text-white">{T('origin_p4', 'decade_origin_p4')}</p>
  </div>
</div>

<!-- Year-by-year -->
<h3 class="mb-3 mt-4 px-1 text-sm font-extrabold text-slate-300">{T('journey_h', 'decade_journey')}</h3>
<div class="{GLASS} p-5">
  <ol class="relative space-y-4 border-l-2 border-violet-400/30 pl-5">
    {#each d.years as row (row.year)}
      {@const entry = storyByYear.get(String(row.year))}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-violet-500 text-[10px] font-black text-white">{row.year - d.startYear + 1}</span>
        <h4 class="text-sm font-black text-violet-200">{entry?.title || row.year}</h4>
        {#if entry?.content}<p class="mt-1 text-sm text-slate-200">{entry.content}</p>{/if}
        <div class="mt-2 flex flex-wrap gap-2">
          <span class="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-200">{T('total_label', 'decade_total_label')}: {fmt(row.total)}</span>
          <span class="rounded-lg bg-violet-500/15 px-3 py-1.5 text-xs font-bold text-violet-200">{T('contributors_label', 'decade_contributors_label')}: {row.contributors}</span>
        </div>
        {#if row.isCurrent}
          <div class="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/15 p-3 text-xs text-amber-200">
            <Info class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p class="font-bold">{T('current_note_h', 'decade_current_note_h', { year: row.year })}</p>
              <p class="mt-0.5">{T('current_note_p', 'decade_current_note_p', { year: row.year })}</p>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</div>

<!-- Portal callout -->
<div class="{GLASS} mt-4 p-5 text-center">
  <p class="font-mono text-xs text-slate-400">{T('evolution_line', 'decade_evolution_line')}</p>
  <h3 class="mt-2 text-base font-black text-violet-200">{T('portal_h', 'decade_portal_h')}</h3>
  <p class="mt-1 text-sm text-slate-200">{T('portal_p', 'decade_portal_p')}</p>
</div>

<!-- Table -->
<div class="{GLASS} mt-4 p-5">
  <h3 id="decade-table-h" class="text-base font-black text-white">{T('table_h', 'decade_table_h', rangeVars)}</h3>
  <div class="mt-3" role="table" aria-labelledby="decade-table-h">
        <!-- audit PR-41: this is a data table drawn with CSS grid, so a screen reader was given
         three unrelated runs of numbers with no column association at all — "2019, 41,300, 63"
         read as a flat list tells you nothing about which figure is which. ARIA table roles give
         it the semantics of a <table> with ZERO visual change, which matters because converting
         the grid to real <table> markup would relayout five skins I cannot look at. -->
<div role="row" class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-white/10 pb-2 text-xs font-bold uppercase text-slate-400">
      <span role="columnheader">{T('th_year', 'decade_th_year')}</span>
      <span role="columnheader">{T('th_total', 'decade_th_total')}</span>
      <span role="columnheader">{T('th_contributors', 'decade_th_contributors')}</span>
    </div>
    {#each d.years as r (r.year)}
      <div role="row" class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-white/5 py-2 text-sm last:border-0">
        <span role="cell" class="font-bold text-violet-200">{r.year}{#if r.isCurrent} •{/if}</span>
        <span role="cell" class="font-semibold text-emerald-200">{fmt(r.total)}</span>
        <span role="cell" class="text-slate-200">{r.contributors}</span>
      </div>
    {/each}
  </div>
  <div class="mt-4 rounded-xl bg-violet-500/15 p-4">
    <p class="text-xs font-extrabold uppercase text-violet-200">{T('totals_h', 'decade_totals_h', rangeVars)}</p>
    <p class="mt-1 text-lg font-black text-white">{T('total_amount', 'decade_total_amount', { amount: fmt(d.grandTotal) })}</p>
    <p class="text-sm font-bold text-slate-200">{T('total_entries', 'decade_total_entries', { count: d.grandContributors })}</p>
    <p class="mt-2 text-xs text-slate-400">{T('total_clarify', 'decade_total_clarify', { count: d.grandContributors })}</p>
  </div>
</div>

<!-- Transparency timeline -->
<h3 class="mb-3 mt-4 px-1 text-sm font-extrabold text-slate-300">{T('timeline_h', 'decade_timeline_h')}</h3>
<div class="{GLASS} p-5">
  <ol class="relative space-y-3 border-l-2 border-violet-400/30 pl-5">
    {#each TIMELINE as [key, i18n], i}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-violet-500 text-[10px] font-black text-white">{i + 1}</span>
        <p class="text-sm font-black text-violet-200">{T(key + '_h', i18n + '_h')}</p>
        <p class="mt-0.5 text-sm text-slate-200">{T(key + '_d', i18n + '_d')}</p>
      </li>
    {/each}
  </ol>
</div>

<!-- Thinking / milestones -->
<div class="{GLASS} mt-4 p-5">
  <h3 class="text-base font-black text-white">{T('think_h', 'decade_think_h')}</h3>
  <p class="mt-1 text-sm font-bold text-violet-200">{T('think_lead', 'decade_think_lead')}</p>
  <p class="mt-2 text-sm text-slate-200">{T('think_p', 'decade_think_p')}</p>
  <div class="mt-4 grid gap-2.5 sm:grid-cols-3">
    {#each DECADE_MILESTONES as m}
      {@const msKey = 'ms_' + m.year}
      <div class="rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <p class="text-sm font-black text-violet-200">{T(msKey + '_h', m.headingKey)}</p>
        <p class="mt-0.5 text-xs text-slate-400">{T(msKey + '_d', m.bodyKey)}</p>
      </div>
    {/each}
  </div>
</div>

<!-- Closing -->
<div class="{GLASS} mt-4 p-6 text-center">
  <h3 class="text-lg font-black text-violet-200">{T('closing_h', 'decade_closing_h')}</h3>
  <div class="mx-auto mt-2 max-w-xl space-y-2 text-sm text-slate-200">
    <p>{T('closing_p1', 'decade_closing_p1')}</p>
    <p>{T('closing_p2', 'decade_closing_p2')}</p>
    <p>{T('closing_p3', 'decade_closing_p3')}</p>
  </div>
</div>

<p class="mt-5 text-center text-sm font-medium text-slate-400">{T('footer', 'decade_footer')}</p>

<p class="mt-4 flex items-center justify-center gap-1.5 text-base font-semibold text-violet-300">{$tr('seva_line')} <Heart class="h-4 w-4 fill-current text-pink-400" /></p>
