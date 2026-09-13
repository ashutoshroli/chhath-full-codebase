<script lang="ts">
  import { Trophy, Sunrise, HandHeart, Users, ShieldCheck, Sparkles, Heart, Info } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { tr } from '$lib/stores/lang';
  import { DECADE_YEARS, DECADE_TABLE, DECADE_TIMELINE, DECADE_MILESTONES } from '$lib/utils/decadeData';

  const yearIcons = [Sunrise, Users, Users, HandHeart, ShieldCheck, ShieldCheck, ShieldCheck, Users, Sparkles, Sparkles];
  const msIcons = [Sunrise, ShieldCheck, Sparkles];
</script>

<svelte:head>
  <title>{$tr('decade_title')} — {$tr('app_title')}</title>
</svelte:head>

<PageHeading icon={Trophy} titleKey="decade_title" subtitle={$tr('decade_years')} />

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
    <p class="font-hand text-xl text-brand-700 dark:text-brand-200">{$tr('decade_years')}</p>
    <h2 class="mt-1 text-2xl font-black sm:text-3xl">{$tr('decade_title')}</h2>
    <p class="mt-1 text-sm font-medium text-brand-900/70 dark:text-white/70">{$tr('decade_sub')}</p>
    <p class="mx-auto mt-3 max-w-xl text-sm text-brand-900/80 dark:text-brand-50/80">
      {$tr('decade_intro')}
    </p>
  </div>
</section>

<!-- Origin -->
<section class="surface mt-4 p-5">
  <h3 class="text-base font-black text-brand-700 dark:text-brand-300">{$tr('decade_origin_h')}</h3>
  <div class="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-200">
    <p>{$tr('decade_origin_p1')}</p>
    <p>{$tr('decade_origin_p2')}</p>
    <p>{$tr('decade_origin_p3')}</p>
    <p class="font-semibold text-slate-800 dark:text-slate-100">{$tr('decade_origin_p4')}</p>
  </div>
</section>

<!-- Year-by-year journey -->
<section class="mt-5">
  <h3 class="mb-3 px-1 text-sm font-extrabold text-slate-600 dark:text-slate-300">{$tr('decade_journey')}</h3>
  <ol class="relative space-y-3 border-l-2 border-brand-500/30 pl-5">
    {#each DECADE_YEARS as y, i}
      {@const Icon = yearIcons[i] ?? Sparkles}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-white shadow-glow">
          <Icon class="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div class="surface p-4">
          <h4 class="text-sm font-black text-brand-700 dark:text-brand-300">{$tr(y.headingKey)}</h4>
          <p class="mt-1 text-sm text-slate-700 dark:text-slate-200">{$tr(y.bodyKey)}</p>
          {#if y.total}
            <div class="mt-3 flex flex-wrap gap-2">
              <span class="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                {$tr('decade_total_label')}: {y.total}
              </span>
              <span class="rounded-lg bg-brand-500/10 px-3 py-1.5 text-xs font-bold text-brand-700 dark:text-brand-300">
                {$tr('decade_contributors_label')}: {y.contributors}
              </span>
            </div>
          {:else}
            <div class="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <Info class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p class="font-bold">{$tr('decade_2026_note_h')}</p>
                <p class="mt-0.5">{$tr('decade_2026_note_p')}</p>
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
  <p class="font-mono text-xs text-slate-500 dark:text-slate-400">{$tr('decade_evolution_line')}</p>
  <h3 class="mt-2 text-base font-black text-brand-700 dark:text-brand-300">{$tr('decade_portal_h')}</h3>
  <p class="mt-1 text-sm text-slate-700 dark:text-slate-200">{$tr('decade_portal_p')}</p>
</section>

<!-- Financial journey table -->
<section class="mt-5 surface p-5">
  <h3 class="text-base font-black">{$tr('decade_table_h')}</h3>
  <div class="mt-3">
    <div class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-slate-200 pb-2 text-xs font-bold uppercase text-slate-500 dark:border-slate-700 dark:text-slate-400">
      <span>{$tr('decade_th_year')}</span>
      <span>{$tr('decade_th_total')}</span>
      <span>{$tr('decade_th_contributors')}</span>
    </div>
    {#each DECADE_TABLE as r}
      <div class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
        <span class="font-bold text-brand-700 dark:text-brand-300">{r.year}</span>
        <span class="font-semibold text-emerald-700 dark:text-emerald-300">{r.total}</span>
        <span class="text-slate-700 dark:text-slate-200">{r.contributors}</span>
      </div>
    {/each}
  </div>

  <div class="mt-4 rounded-xl bg-brand-500/10 p-4">
    <p class="text-xs font-extrabold uppercase text-brand-700 dark:text-brand-300">{$tr('decade_totals_h')}</p>
    <p class="mt-1 text-lg font-black text-slate-800 dark:text-slate-100">{$tr('decade_total_amount')}</p>
    <p class="text-sm font-bold text-slate-700 dark:text-slate-200">{$tr('decade_total_entries')}</p>
    <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">{$tr('decade_total_clarify')}</p>
  </div>
</section>

<!-- Transparency evolution timeline -->
<section class="mt-5">
  <h3 class="mb-3 px-1 text-sm font-extrabold text-slate-600 dark:text-slate-300">{$tr('decade_timeline_h')}</h3>
  <ol class="relative space-y-3 border-l-2 border-brand-500/30 pl-5">
    {#each DECADE_TIMELINE as step, i}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-[10px] font-black text-white shadow-glow">{i + 1}</span>
        <div class="surface p-3">
          <p class="text-sm font-black text-brand-700 dark:text-brand-300">{$tr(step.headingKey)}</p>
          <p class="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{$tr(step.bodyKey)}</p>
        </div>
      </li>
    {/each}
  </ol>
</section>

<!-- Our thinking / milestones -->
<section class="mt-5 surface p-5">
  <h3 class="text-base font-black">{$tr('decade_think_h')}</h3>
  <p class="mt-1 flex items-center gap-1.5 text-sm font-bold text-brand-700 dark:text-brand-300">
    <ShieldCheck class="h-4 w-4" aria-hidden="true" /> {$tr('decade_think_lead')}
  </p>
  <p class="mt-2 text-sm text-slate-700 dark:text-slate-200">{$tr('decade_think_p')}</p>

  <div class="mt-4 grid gap-2.5 sm:grid-cols-3">
    {#each DECADE_MILESTONES as m, i}
      {@const Icon = msIcons[i] ?? Sparkles}
      <div class="surface p-4">
        <span class="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-300">
          <Icon class="h-5 w-5" aria-hidden="true" />
        </span>
        <p class="mt-2 text-sm font-black">{$tr(m.headingKey)}</p>
        <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{$tr(m.bodyKey)}</p>
      </div>
    {/each}
  </div>
</section>

<!-- Closing -->
<section class="mt-5 surface p-6 text-center">
  <h3 class="text-lg font-black text-brand-700 dark:text-brand-300">{$tr('decade_closing_h')}</h3>
  <div class="mx-auto mt-2 max-w-xl space-y-2 text-sm text-slate-700 dark:text-slate-200">
    <p>{$tr('decade_closing_p1')}</p>
    <p>{$tr('decade_closing_p2')}</p>
    <p>{$tr('decade_closing_p3')}</p>
  </div>
</section>

<p class="mt-5 text-center text-sm font-medium text-slate-500 dark:text-slate-400">{$tr('decade_footer')}</p>

<p class="mt-4 flex items-center justify-center gap-1.5 font-hand text-lg text-brand-600 dark:text-brand-300">
  {$tr('seva_line')} <Heart class="h-4 w-4 fill-current text-danger" />
</p>
