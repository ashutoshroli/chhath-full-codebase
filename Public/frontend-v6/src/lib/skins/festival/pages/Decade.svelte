<script lang="ts">
  import { Trophy, Heart } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { CARD } from '../fest';

  const milestones = ['decade_ms_2017', 'decade_ms_2019', 'decade_ms_2021', 'decade_ms_2023', 'decade_ms_2026'];
  const years = ['2017', '2019', '2021', '2023', '2026'];
</script>

<svelte:head><title>{$tr('decade_title')} — {$tr('app_title')}</title></svelte:head>

<div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#7a1420] to-[#B01E2E] p-6 text-center text-[#ffe9c7] shadow-lg">
  <div class="pointer-events-none absolute inset-0 opacity-30" style="background: radial-gradient(70% 60% at 50% 0%, rgba(245,184,64,.6), transparent 60%);"></div>
  <div class="relative">
    <Trophy class="mx-auto h-8 w-8 text-[#F5B840]" aria-hidden="true" />
    <p class="mt-2 text-xs font-bold text-[#F5B840]">{$tr('decade_years')}</p>
    <h1 class="text-2xl font-black text-[#F5B840]">{$tr('decade_title')}</h1>
    <p class="mt-1 text-sm text-[#ffe9c7]/80">{$tr('decade_sub')}</p>
  </div>
</div>

<div class="{CARD} mt-4 p-5">
  <ol class="relative space-y-3 border-l-2 border-[#F5B840] pl-5">
    {#each milestones as m, i}
      <li class="relative">
        <span class="absolute -left-[27px] grid h-6 w-6 place-items-center rounded-full bg-[#B01E2E] text-[10px] font-black text-[#F5B840]">{i + 1}</span>
        <p class="text-xs font-black text-[#B01E2E]">{years[i]}</p>
        <p class="text-sm text-[#7a1420]">{$tr(m)}</p>
      </li>
    {/each}
  </ol>
</div>

<p class="mt-6 flex items-center justify-center gap-1.5 text-base font-black text-[#B01E2E]">{$tr('seva_line')} <Heart class="h-4 w-4 fill-current text-[#B01E2E]" /></p>
