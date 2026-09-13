<script lang="ts">
  import { Trophy, ArrowRight } from '@lucide/svelte';
  import { tr, lang } from '$lib/stores/lang';
  import { portalState } from '$lib/stores/portal';
  import { decadeStats, journeyTagline } from '$lib/api/derive';

  // Same live year-range + DB tagline the Decade page uses, so the banner never
  // shows the raw {start}/{end} placeholders or a stale hardcoded tagline.
  let d = $derived(decadeStats($portalState.data));
  let rangeVars = $derived({ start: d.startYear, end: d.endYear });
  let tagline = $derived(journeyTagline($portalState.data));
  let taglineText = $derived(($lang === 'hi' ? tagline.hi : tagline.en) || $tr('decade_sub'));
</script>

<a
  href="/decade"
  aria-label={$tr('decade_title')}
  class="relative block overflow-hidden rounded-2xl p-4 shadow-card transition active:scale-[.99] sm:p-5
    bg-gradient-to-br from-amber-100 to-brand-200
    dark:from-brand-900/60 dark:to-amber-900/40"
>
  <!-- silhouette suggestion via layered gradients (no heavy image) -->
  <div
    class="pointer-events-none absolute inset-0 opacity-40 dark:opacity-30"
    style="background: radial-gradient(120% 80% at 80% 120%, rgba(242,122,26,.5), transparent 60%);"
    aria-hidden="true"
  ></div>

  <div class="relative flex items-center gap-4">
    <span class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/70 text-brand-600 shadow dark:bg-white/10 dark:text-brand-300">
      <Trophy class="h-6 w-6" aria-hidden="true" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="text-xs font-extrabold text-brand-600 dark:text-brand-300">{$tr('decade_years', rangeVars)}</p>
      <h3 class="text-lg font-black leading-tight sm:text-xl">{$tr('decade_title')}</h3>
      <p class="text-xs font-medium text-brand-900/70 dark:text-white/70">{taglineText}</p>
    </div>
    <span class="hidden font-hand text-base text-brand-700 dark:text-brand-200 sm:block">
      {$tr('decade_cta')}
    </span>
    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500 text-white shadow-glow" aria-hidden="true">
      <ArrowRight class="h-5 w-5" />
    </span>
  </div>
</a>
