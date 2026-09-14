<script lang="ts">
  /**
   * "Age ratings" block for the public /guide page — the IARC certificate the
   * app is published under, shown to visitors in both languages.
   *
   * THEME-DRIVEN, and deliberately in two layers (this matters — see below):
   *
   *  • Accent pixels (the rating "stamp" badges, the section icons, the rating
   *    description) read the live `--accent` token, NOT the fixed `brand-*`
   *    ramp. So the badges recolour with the theme: marigold on Festival,
   *    lime on Cyber Lime, trust-blue on Executive Pro, cyan on Midnight Glass.
   *    Every one of the 18 themes resolves `--accent` (own value, or the
   *    :root default #F27A1A for sunrise / classic-light / slate-light).
   *
   *  • Structure pixels (nested card borders, row dividers) use the
   *    `black/10 dark:white/10` pairing that the surrounding guide page already
   *    uses for its nested install-step boxes — NOT `--surface-border`. That is
   *    intentional: `--surface-border` is WHITE at :root, and the default light
   *    theme (sunrise) plus warm-night never override it, so a nested border
   *    built from that token would be invisible against the white `.surface`
   *    card these boxes sit inside. The black/white pairing stays visible on
   *    all 18 themes.
   *
   * Neutral text keeps the `slate-* / dark:slate-*` pairing used by every
   * skin-agnostic page (guide, privacy, terms), which reads correctly on both
   * the light and dark theme bases.
   *
   * Data + rating ID come from $lib/ratings — the SAME module the PWA manifest's
   * `iarc_rating_id` is generated from, so this page can never advertise a
   * different certificate than the one the app stores read.
   */
  import { BadgeCheck, Info } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { AGE_RATINGS, IARC_RATING_ID, IARC_VERSION, sourceKey } from '$lib/ratings';

  // Additional-data rows, mirroring the store listing's "Additional Data" table.
  // $derived so labels/values follow a language switch (same pattern as the
  // privacy page's orgVars). The ID and version are literals, not translated.
  let extra = $derived([
    { label: $tr('rating_id_label'), value: IARC_RATING_ID, mono: true },
    { label: $tr('rating_type_label'), value: $tr('rating_type_iarc'), mono: false },
    { label: $tr('rating_version_label'), value: IARC_VERSION, mono: false }
  ]);
</script>

<section class="surface mt-8 p-5">
  <h2 class="flex items-center gap-2 text-base font-black text-slate-900 dark:text-white">
    <BadgeCheck class="h-5 w-5" style="color: rgb(var(--accent));" aria-hidden="true" />
    {$tr('guide_ratings_h')}
  </h2>
  <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{$tr('guide_ratings_p')}</p>

  <!-- One card per rating system, in the order the store listing shows them. -->
  <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each AGE_RATINGS as r (r.id)}
      <div class="flex gap-3 rounded-xl border border-black/10 p-3 dark:border-white/10">
        <!-- The rating mark, drawn like a certificate stamp in the theme accent. -->
        <span
          class="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-black leading-none"
          style="background: rgb(var(--accent) / 0.14); color: rgb(var(--accent)); border: 1px solid rgb(var(--accent) / 0.35);"
          aria-hidden="true"
        >
          {r.mark}
        </span>
        <div class="min-w-0">
          <h3 class="truncate text-sm font-black text-slate-900 dark:text-white">
            {r.system}
            <span class="sr-only"> — {$tr(r.descKey)}</span>
          </h3>
          <p class="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{$tr(r.bodyKey)}</p>
          <p class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{$tr(r.regionKey)}</p>
          <p class="mt-1 text-xs font-bold" style="color: rgb(var(--accent));">{$tr(r.descKey)}</p>
          <p class="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {$tr('rating_col_source')}: {$tr(sourceKey(r.source))}
          </p>
        </div>
      </div>
    {/each}
  </div>

  <!-- Additional data (certificate metadata), matching the store listing. -->
  <h3
    class="mt-5 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400"
  >
    <Info class="h-4 w-4" style="color: rgb(var(--accent));" aria-hidden="true" />
    {$tr('guide_ratings_extra_h')}
  </h3>
  <dl
    class="mt-2 divide-y divide-black/10 overflow-hidden rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10"
  >
    {#each extra as row}
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
        <dt class="text-xs font-semibold text-slate-500 dark:text-slate-400">{row.label}</dt>
        <dd
          class="min-w-0 break-all text-right text-xs font-bold text-slate-800 dark:text-slate-100 {row.mono
            ? 'font-mono'
            : ''}"
        >
          {row.value}
        </dd>
      </div>
    {/each}
  </dl>

  <p class="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{$tr('guide_ratings_note')}</p>
</section>
