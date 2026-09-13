<script lang="ts">
  import { Trophy, Heart } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { GLASS } from '../glass';

  const milestones = ['decade_ms_2017', 'decade_ms_2019', 'decade_ms_2021', 'decade_ms_2023', 'decade_ms_2026'];
  const years = ['2017', '2019', '2021', '2023', '2026'];
</script>

<svelte:head><title>{$tr('decade_title')} — {$tr('app_title')}</title></svelte:head>

<div class="{GLASS} p-6 text-center">
  <span class="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-violet-500/20 text-violet-200"><Trophy class="h-6 w-6" aria-hidden="true" /></span>
  <p class="mt-2 text-xs font-bold text-violet-300">{$tr('decade_years')}</p>
  <h1 class="text-2xl font-black text-white">{$tr('decade_title')}</h1>
  <p class="mt-1 text-sm text-slate-300">{$tr('decade_sub')}</p>
</div>

<div class="{GLASS} mt-4 p-5">
  <ol class="relative space-y-3 border-l-2 border-violet-400/30 pl-5">
    {#each milestones as m, i}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-violet-500 text-[10px] font-black text-white">{i + 1}</span>
        <p class="text-xs font-black text-violet-300">{years[i]}</p>
        <p class="text-sm text-slate-200">{$tr(m)}</p>
      </li>
    {/each}
  </ol>
</div>

<p class="mt-6 flex items-center justify-center gap-1.5 text-base font-semibold text-violet-300">{$tr('seva_line')} <Heart class="h-4 w-4 fill-current text-pink-400" /></p>
