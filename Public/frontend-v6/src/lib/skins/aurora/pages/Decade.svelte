<script lang="ts">
  import { Trophy, Heart, Info } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { GLASS } from '../glass';
  import { DECADE_YEARS, DECADE_TABLE, DECADE_TIMELINE, DECADE_MILESTONES } from '$lib/utils/decadeData';
</script>

<svelte:head><title>{$tr('decade_title')} — {$tr('app_title')}</title></svelte:head>

<!-- Hero -->
<div class="{GLASS} p-6 text-center">
  <span class="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-violet-500/20 text-violet-200"><Trophy class="h-6 w-6" aria-hidden="true" /></span>
  <p class="mt-2 text-xs font-bold text-violet-300">{$tr('decade_years')}</p>
  <h1 class="text-2xl font-black text-white">{$tr('decade_title')}</h1>
  <p class="mt-1 text-sm text-slate-300">{$tr('decade_sub')}</p>
  <p class="mx-auto mt-3 max-w-xl text-sm text-slate-200/90">{$tr('decade_intro')}</p>
</div>

<!-- Origin -->
<div class="{GLASS} mt-4 p-5">
  <h3 class="text-base font-black text-violet-200">{$tr('decade_origin_h')}</h3>
  <div class="mt-2 space-y-2 text-sm text-slate-200">
    <p>{$tr('decade_origin_p1')}</p>
    <p>{$tr('decade_origin_p2')}</p>
    <p>{$tr('decade_origin_p3')}</p>
    <p class="font-semibold text-white">{$tr('decade_origin_p4')}</p>
  </div>
</div>

<!-- Year-by-year -->
<h3 class="mb-3 mt-4 px-1 text-sm font-extrabold text-slate-300">{$tr('decade_journey')}</h3>
<div class="{GLASS} p-5">
  <ol class="relative space-y-4 border-l-2 border-violet-400/30 pl-5">
    {#each DECADE_YEARS as y, i}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-violet-500 text-[10px] font-black text-white">{i + 1}</span>
        <h4 class="text-sm font-black text-violet-200">{$tr(y.headingKey)}</h4>
        <p class="mt-1 text-sm text-slate-200">{$tr(y.bodyKey)}</p>
        {#if y.total}
          <div class="mt-2 flex flex-wrap gap-2">
            <span class="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-200">{$tr('decade_total_label')}: {y.total}</span>
            <span class="rounded-lg bg-violet-500/15 px-3 py-1.5 text-xs font-bold text-violet-200">{$tr('decade_contributors_label')}: {y.contributors}</span>
          </div>
        {:else}
          <div class="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/15 p-3 text-xs text-amber-200">
            <Info class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p class="font-bold">{$tr('decade_2026_note_h')}</p>
              <p class="mt-0.5">{$tr('decade_2026_note_p')}</p>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</div>

<!-- Portal callout -->
<div class="{GLASS} mt-4 p-5 text-center">
  <p class="font-mono text-xs text-slate-400">{$tr('decade_evolution_line')}</p>
  <h3 class="mt-2 text-base font-black text-violet-200">{$tr('decade_portal_h')}</h3>
  <p class="mt-1 text-sm text-slate-200">{$tr('decade_portal_p')}</p>
</div>

<!-- Table -->
<div class="{GLASS} mt-4 p-5">
  <h3 class="text-base font-black text-white">{$tr('decade_table_h')}</h3>
  <div class="mt-3">
    <div class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-white/10 pb-2 text-xs font-bold uppercase text-slate-400">
      <span>{$tr('decade_th_year')}</span>
      <span>{$tr('decade_th_total')}</span>
      <span>{$tr('decade_th_contributors')}</span>
    </div>
    {#each DECADE_TABLE as r}
      <div class="grid grid-cols-[1fr_1.4fr_1fr] gap-2 border-b border-white/5 py-2 text-sm last:border-0">
        <span class="font-bold text-violet-200">{r.year}</span>
        <span class="font-semibold text-emerald-200">{r.total}</span>
        <span class="text-slate-200">{r.contributors}</span>
      </div>
    {/each}
  </div>
  <div class="mt-4 rounded-xl bg-violet-500/15 p-4">
    <p class="text-xs font-extrabold uppercase text-violet-200">{$tr('decade_totals_h')}</p>
    <p class="mt-1 text-lg font-black text-white">{$tr('decade_total_amount')}</p>
    <p class="text-sm font-bold text-slate-200">{$tr('decade_total_entries')}</p>
    <p class="mt-2 text-xs text-slate-400">{$tr('decade_total_clarify')}</p>
  </div>
</div>

<!-- Transparency timeline -->
<h3 class="mb-3 mt-4 px-1 text-sm font-extrabold text-slate-300">{$tr('decade_timeline_h')}</h3>
<div class="{GLASS} p-5">
  <ol class="relative space-y-3 border-l-2 border-violet-400/30 pl-5">
    {#each DECADE_TIMELINE as step, i}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-violet-500 text-[10px] font-black text-white">{i + 1}</span>
        <p class="text-sm font-black text-violet-200">{$tr(step.headingKey)}</p>
        <p class="mt-0.5 text-sm text-slate-200">{$tr(step.bodyKey)}</p>
      </li>
    {/each}
  </ol>
</div>

<!-- Thinking / milestones -->
<div class="{GLASS} mt-4 p-5">
  <h3 class="text-base font-black text-white">{$tr('decade_think_h')}</h3>
  <p class="mt-1 text-sm font-bold text-violet-200">{$tr('decade_think_lead')}</p>
  <p class="mt-2 text-sm text-slate-200">{$tr('decade_think_p')}</p>
  <div class="mt-4 grid gap-2.5 sm:grid-cols-3">
    {#each DECADE_MILESTONES as m}
      <div class="rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <p class="text-sm font-black text-violet-200">{$tr(m.headingKey)}</p>
        <p class="mt-0.5 text-xs text-slate-400">{$tr(m.bodyKey)}</p>
      </div>
    {/each}
  </div>
</div>

<!-- Closing -->
<div class="{GLASS} mt-4 p-6 text-center">
  <h3 class="text-lg font-black text-violet-200">{$tr('decade_closing_h')}</h3>
  <div class="mx-auto mt-2 max-w-xl space-y-2 text-sm text-slate-200">
    <p>{$tr('decade_closing_p1')}</p>
    <p>{$tr('decade_closing_p2')}</p>
    <p>{$tr('decade_closing_p3')}</p>
  </div>
</div>

<p class="mt-5 text-center text-sm font-medium text-slate-400">{$tr('decade_footer')}</p>

<p class="mt-4 flex items-center justify-center gap-1.5 text-base font-semibold text-violet-300">{$tr('seva_line')} <Heart class="h-4 w-4 fill-current text-pink-400" /></p>
