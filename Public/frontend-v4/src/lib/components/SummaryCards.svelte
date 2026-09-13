<script lang="ts">
  import { Users, PiggyBank, BarChart3, BadgeCheck } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr } from '$lib/stores/lang';
  import { computeSummary } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import CountUp from './CountUp.svelte';

  let s = $derived(computeSummary($portalState.data, $year));
  let loading = $derived($portalState.status === 'loading');

  let cards = $derived([
    { icon: Users, grad: 'from-brand-400 to-brand-600', valueText: null, value: s.contributors, fmt: (n: number) => Math.round(n).toString(), label: $tr('summary_contributors') },
    { icon: PiggyBank, grad: 'from-sky-500 to-sky-700', valueText: null, value: s.totalCollected, fmt, label: $tr('summary_total_collected') },
    { icon: BarChart3, grad: 'from-violet-500 to-violet-700', valueText: null, value: s.average, fmt, label: $tr('summary_avg') },
    { icon: BadgeCheck, grad: 'from-emerald-500 to-emerald-700', valueText: null, value: s.recordedPct, fmt: (n: number) => `${Math.round(n)}%`, label: $tr('summary_recorded') }
  ]);
</script>

<section class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
  {#each cards as c}
    <div
      class="relative overflow-hidden rounded-2xl bg-gradient-to-br {c.grad} p-3 text-white shadow-card
        transition-transform active:scale-[.98]"
    >
      {#if loading}
        <div class="space-y-2">
          <div class="skeleton h-5 w-5 !bg-white/30"></div>
          <div class="skeleton h-6 w-20 !bg-white/30"></div>
          <div class="skeleton h-3 w-16 !bg-white/30"></div>
        </div>
      {:else}
        {@const Icon = c.icon}
        <Icon class="h-5 w-5 opacity-90" aria-hidden="true" />
        <p class="mt-2 text-lg font-black leading-tight sm:text-xl">
          <CountUp value={c.value} format={c.fmt} />
        </p>
        <p class="text-[11px] font-semibold opacity-90">{c.label}</p>
      {/if}
    </div>
  {/each}
</section>
