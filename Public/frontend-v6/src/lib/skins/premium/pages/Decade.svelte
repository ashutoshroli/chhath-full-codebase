<script lang="ts">
  import { Trophy, Sunrise, HandHeart, Users, ShieldCheck, Sparkles, Heart, Info } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { tr, lang } from '$lib/stores/lang';
  import { portalState } from '$lib/stores/portal';
  import { decadeStats, journeyEntries, journeyTagline, journeyText, interp } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import { DECADE_MILESTONES } from '$lib/utils/decadeData';

  const yearIcons = [Sunrise, Users, Users, HandHeart, ShieldCheck, ShieldCheck, ShieldCheck, Users, Sparkles, Sparkles];
  const msIcons = [Sunrise, ShieldCheck, Sparkles];

  // Live decade figures (no hardcoded numbers).
  let d = $derived(decadeStats($portalState.data));
  // DB-managed page text (mgmt "Journey Content" tab). Each block falls back to
  // its built-in i18n string when the DB has nothing for that field.
  let jt = $derived(journeyText($portalState.data, $lang));
  const T = (key: string, i18nKey: string, vars?: Record<string, string | number>) =>
    key in jt ? interp(jt[key], vars) : $tr(i18nKey, vars);
  // The transparency-evolution timeline steps — DB text with i18n fallback.
  const TIMELINE = [
    ['tl_paper', 'decade_tl_paper'], ['tl_pdf', 'decade_tl_pdf'], ['tl_wa', 'decade_tl_wa'],
    ['tl_sheets', 'decade_tl_sheets'], ['tl_portal', 'decade_tl_portal']
  ] as const;
  // Story text (title/content per year) now comes from the DB (journey_entries),
  // keyed by year; the numbers still come from `d`. Falls back to empty when the
  // backend hasn't shipped journey content yet.
  let story = $derived(journeyEntries($portalState.data));
  let storyByYear = $derived(
    new Map(story.map((e, i) => [String(e.year), {
      i,
      title: $lang === 'hi' && e.titleHi ? e.titleHi : e.titleEn,
      content: $lang === 'hi' && e.contentHi ? e.contentHi : e.contentEn
    }]))
  );
  // Tagline: DB value (bilingual) with the built-in i18n string as fallback.
  let tagline = $derived(journeyTagline($portalState.data));
  let taglineText = $derived(
    ($lang === 'hi' ? tagline.hi : tagline.en) || $tr('decade_sub')
  );
  // Range vars for the placeholder-based headings.
  let rangeVars = $derived({ start: d.startYear, end: d.endYear });
</script>

<svelte:head>
  <title>{$tr('decade_title')} — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={Trophy} titleKey="decade_title" subtitle={$tr('decade_years', rangeVars)} />

<!-- Hero -->
<section
  class="relative overflow-hidden rounded-2xl p-6 text-center shadow-card
    bg-gradient-to-br from-amber-100 to-brand-200
    dark:from-brand-900/60 dark:to-amber-900/40"
>
  <div
    class="pointer-events-none absolute inset-0 opacity-40 dark:opacity-30"
    style="background: radial-gradient(120% 90% at 50% -10%, rgba(255,196,75,.7), transparent 60%);"
    aria-hidden="true"
  ></div>
  <div class="relative">
    <p class="font-hand text-xl text-brand-700 dark:text-brand-200">{$tr('decade_years', rangeVars)}</p>
    <h2 class="mt-1 text-2xl font-black sm:text-3xl">{$tr('decade_title')}</h2>
    <p class="mt-1 text-sm font-medium text-brand-900/70 dark:text-white/70">{taglineText}</p>
    <p class="mx-auto mt-3 max-w-xl text-sm text-brand-900/80 dark:text-brand-50/80">
      {T('intro', 'decade_intro')}
    </p>
  </div>
</section>

<!-- Origin -->
<section class="surface mt-4 p-5">
  <h3 class="text-base font-black text-brand-700 dark:text-brand-300">{T('origin_h', 'decade_origin_h')}</h3>
  <div class="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-200">
    <p>{T('origin_p1', 'decade_origin_p1')}</p>
    <p>{T('origin_p2', 'decade_origin_p2')}</p>
    <p>{T('origin_p3', 'decade_origin_p3')}</p>
    <p class="font-semibold text-slate-800 dark:text-slate-100">{T('origin_p4', 'decade_origin_p4')}</p>
  </div>
</section>

<!-- Year-by-year journey -->
<section class="mt-5">
  <h3 class="mb-3 px-1 text-sm font-extrabold text-slate-600 dark:text-slate-300">{T('journey_h', 'decade_journey')}</h3>
  <ol class="relative space-y-3 border-l-2 border-brand-500/30 pl-5">
    {#each d.years as row (row.year)}
      {@const entry = storyByYear.get(String(row.year))}
      {@const Icon = yearIcons[entry?.i ?? story.length] ?? Sparkles}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-white shadow-glow">
          <Icon class="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div class="surface p-4">
          <h4 class="text-sm font-black text-brand-700 dark:text-brand-300">{entry?.title || row.year}</h4>
          {#if entry?.content}<p class="mt-1 text-sm text-slate-700 dark:text-slate-200">{entry.content}</p>{/if}
          <div class="mt-3 flex flex-wrap gap-2">
            <span class="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              {T('total_label', 'decade_total_label')}: {fmt(row.total)}
            </span>
            <span class="rounded-lg bg-brand-500/10 px-3 py-1.5 text-xs font-bold text-brand-700 dark:text-brand-300">
              {T('contributors_label', 'decade_contributors_label')}: {row.contributors}
            </span>
          </div>
          {#if row.isCurrent}
            <div class="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <Info class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p class="font-bold">{T('current_note_h', 'decade_current_note_h', { year: row.year })}</p>
                <p class="mt-0.5">{T('current_note_p', 'decade_current_note_p', { year: row.year })}</p>
              </div>
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
</section>

<!-- Portal callout -->
<section class="mt-5 surface overflow-hidden p-5 text-center">
  <p class="font-mono text-xs text-slate-500 dark:text-slate-400">{T('evolution_line', 'decade_evolution_line')}</p>
  <h3 class="mt-2 text-base font-black text-brand-700 dark:text-brand-300">{T('portal_h', 'decade_portal_h')}</h3>
  <p class="mt-1 text-sm text-slate-700 dark:text-slate-200">{T('portal_p', 'decade_portal_p')}</p>
</section>

<!-- Financial journey table -->
<section class="mt-5 surface p-5">
  <h3 class="text-base font-black">{T('table_h', 'decade_table_h', rangeVars)}</h3>
  <div class="mt-3">
    <div class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-slate-200 pb-2 text-xs font-bold uppercase text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <span>{T('th_year', 'decade_th_year')}</span>
      <span>{T('th_total', 'decade_th_total')}</span>
      <span>{T('th_contributors', 'decade_th_contributors')}</span>
    </div>
    {#each d.years as r (r.year)}
      <div class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
        <span class="font-bold text-brand-700 dark:text-brand-300">{r.year}{#if r.isCurrent} •{/if}</span>
        <span class="font-semibold text-emerald-700 dark:text-emerald-300">{fmt(r.total)}</span>
        <span class="text-slate-700 dark:text-slate-200">{r.contributors}</span>
      </div>
    {/each}
  </div>

  <div class="mt-4 rounded-xl bg-brand-500/10 p-4">
    <p class="text-xs font-extrabold uppercase text-brand-700 dark:text-brand-300">{T('totals_h', 'decade_totals_h', rangeVars)}</p>
    <p class="mt-1 text-lg font-black text-slate-800 dark:text-slate-100">{T('total_amount', 'decade_total_amount', { amount: fmt(d.grandTotal) })}</p>
    <p class="text-sm font-bold text-slate-700 dark:text-slate-200">{T('total_entries', 'decade_total_entries', { count: d.grandContributors })}</p>
    <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">{T('total_clarify', 'decade_total_clarify', { count: d.grandContributors })}</p>
  </div>
</section>

<!-- Transparency evolution timeline -->
<section class="mt-5">
  <h3 class="mb-3 px-1 text-sm font-extrabold text-slate-600 dark:text-slate-300">{T('timeline_h', 'decade_timeline_h')}</h3>
  <ol class="relative space-y-3 border-l-2 border-brand-500/30 pl-5">
    {#each TIMELINE as [key, i18n], i}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-[10px] font-black text-white shadow-glow">{i + 1}</span>
        <div class="surface p-3">
          <p class="text-sm font-black text-brand-700 dark:text-brand-300">{T(key + '_h', i18n + '_h')}</p>
          <p class="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{T(key + '_d', i18n + '_d')}</p>
        </div>
      </li>
    {/each}
  </ol>
</section>

<!-- Our thinking / milestones -->
<section class="mt-5 surface p-5">
  <h3 class="text-base font-black">{T('think_h', 'decade_think_h')}</h3>
  <p class="mt-1 flex items-center gap-1.5 text-sm font-bold text-brand-700 dark:text-brand-300">
    <ShieldCheck class="h-4 w-4" aria-hidden="true" /> {T('think_lead', 'decade_think_lead')}
  </p>
  <p class="mt-2 text-sm text-slate-700 dark:text-slate-200">{T('think_p', 'decade_think_p')}</p>

  <div class="mt-4 grid gap-2.5 sm:grid-cols-3">
    {#each DECADE_MILESTONES as m, i}
      {@const Icon = msIcons[i] ?? Sparkles}
      {@const msKey = 'ms_' + m.year}
      <div class="surface p-4">
        <span class="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-300">
          <Icon class="h-5 w-5" aria-hidden="true" />
        </span>
        <p class="mt-2 text-sm font-black">{T(msKey + '_h', m.headingKey)}</p>
        <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{T(msKey + '_d', m.bodyKey)}</p>
      </div>
    {/each}
  </div>
</section>

<!-- Closing -->
<section class="mt-5 surface p-6 text-center">
  <h3 class="text-lg font-black text-brand-700 dark:text-brand-300">{T('closing_h', 'decade_closing_h')}</h3>
  <div class="mx-auto mt-2 max-w-xl space-y-2 text-sm text-slate-700 dark:text-slate-200">
    <p>{T('closing_p1', 'decade_closing_p1')}</p>
    <p>{T('closing_p2', 'decade_closing_p2')}</p>
    <p>{T('closing_p3', 'decade_closing_p3')}</p>
  </div>
</section>

<p class="mt-5 text-center text-sm font-medium text-slate-500 dark:text-slate-400">{T('footer', 'decade_footer')}</p>

<p class="mt-4 flex items-center justify-center gap-1.5 font-hand text-lg text-brand-600 dark:text-brand-300">
  {$tr('seva_line')} <Heart class="h-4 w-4 fill-current text-danger" />
</p>
