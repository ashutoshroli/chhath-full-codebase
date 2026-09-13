<script lang="ts">
  import { Trophy, Sunrise, HandHeart, Users, ShieldCheck, Sparkles, Heart } from '@lucide/svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import { tr } from '$lib/stores/lang';

  // A tasteful, culture-first milestone timeline (2017 → 2026). No financial
  // figures are invented here — this is the story/values page for the decade.
  const milestones = [
    { year: '2017', icon: Sunrise, key: 'decade_ms_2017' },
    { year: '2019', icon: Users, key: 'decade_ms_2019' },
    { year: '2021', icon: HandHeart, key: 'decade_ms_2021' },
    { year: '2023', icon: ShieldCheck, key: 'decade_ms_2023' },
    { year: '2026', icon: Sparkles, key: 'decade_ms_2026' }
  ];

  const values = [
    { icon: ShieldCheck, tKey: 'decade_val_transparency_t', dKey: 'decade_val_transparency_d' },
    { icon: Users, tKey: 'decade_val_community_t', dKey: 'decade_val_community_d' },
    { icon: Heart, tKey: 'decade_val_service_t', dKey: 'decade_val_service_d' }
  ];
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
    <p class="mx-auto mt-3 max-w-md font-hand text-lg text-brand-800 dark:text-brand-100">
      {$tr('decade_quote')}
    </p>
  </div>
</section>

<!-- Timeline -->
<section class="mt-4">
  <h3 class="mb-3 px-1 text-sm font-extrabold text-slate-600 dark:text-slate-300">{$tr('decade_journey')}</h3>
  <ol class="relative space-y-3 border-l-2 border-brand-500/30 pl-5">
    {#each milestones as m}
      {@const Icon = m.icon}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-white shadow-glow">
          <Icon class="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div class="surface p-3">
          <p class="text-xs font-black text-brand-600 dark:text-brand-300">{m.year}</p>
          <p class="mt-0.5 text-sm font-medium text-slate-700 dark:text-slate-200">{$tr(m.key)}</p>
        </div>
      </li>
    {/each}
  </ol>
</section>

<!-- Values -->
<section class="mt-5">
  <h3 class="mb-3 px-1 text-sm font-extrabold text-slate-600 dark:text-slate-300">{$tr('decade_values')}</h3>
  <div class="grid gap-2.5 sm:grid-cols-3">
    {#each values as v}
      {@const Icon = v.icon}
      <div class="surface p-4">
        <span class="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-300">
          <Icon class="h-5 w-5" aria-hidden="true" />
        </span>
        <p class="mt-2 text-sm font-black">{$tr(v.tKey)}</p>
        <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{$tr(v.dKey)}</p>
      </div>
    {/each}
  </div>
</section>

<p class="mt-6 flex items-center justify-center gap-1.5 font-hand text-lg text-brand-600 dark:text-brand-300">
  {$tr('seva_line')} <Heart class="h-4 w-4 fill-current text-danger" />
</p>
