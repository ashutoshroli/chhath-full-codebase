<script lang="ts">
  import { Users, PiggyBank, BarChart3, BadgeCheck, ChevronRight } from '@lucide/svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr } from '$lib/stores/lang';
  import { computeSummary } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';
  import CountUp from './CountUp.svelte';

  interface Props {
    /** Opens the current-year contributors list popup (from the Recorded card). */
    onRecordedClick?: () => void;
  }
  let { onRecordedClick }: Props = $props();

  let s = $derived(computeSummary($portalState.data, $year));
  let loading = $derived($portalState.status === 'loading');

  let cards = $derived([
    { icon: Users, grad: 'from-brand-400 to-brand-600', value: s.contributors, fmt: (n: number) => Math.round(n).toString(), label: $tr('summary_contributors'), action: false },
    { icon: PiggyBank, grad: 'from-sky-500 to-sky-700', value: s.totalCollected, fmt, label: $tr('summary_total_collected'), action: false },
    { icon: BarChart3, grad: 'from-violet-500 to-violet-700', value: s.average, fmt, label: $tr('summary_avg'), action: false },
    { icon: BadgeCheck, grad: 'from-emerald-500 to-emerald-700', value: s.recordedPct, fmt: (n: number) => `${Math.round(n)}%`, label: $tr('summary_recorded'), action: true }
  ]);
</script>

{#snippet cardBody(c: (typeof cards)[number])}
  {#if loading}
    <div class="space-y-2">
      <div class="skeleton h-5 w-5 !bg-white/30"></div>
      <div class="skeleton h-6 w-20 !bg-white/30"></div>
      <div class="skeleton h-3 w-16 !bg-white/30"></div>
    </div>
  {:else}
    {@const Icon = c.icon}
    <div class="flex items-start justify-between">
      <Icon class="h-5 w-5 opacity-90" aria-hidden="true" />
      {#if c.action}
        <ChevronRight class="h-4 w-4 opacity-80" aria-hidden="true" />
      {/if}
    </div>
    <p class="mt-2 text-lg font-black leading-tight sm:text-xl">
      <CountUp value={c.value} format={c.fmt} />
    </p>
    <p class="text-[11px] font-semibold opacity-90">{c.label}</p>
  {/if}
{/snippet}

<section class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
  {#each cards as c}
    {#if c.action}
      <button
        type="button"
        onclick={onRecordedClick}
        aria-label={c.label}
        class="relative overflow-hidden rounded-2xl bg-gradient-to-br {c.grad} p-3 text-left text-white shadow-card
          transition-transform active:scale-[.98] cursor-pointer hover:ring-2 hover:ring-white/40"
      >
        {@render cardBody(c)}
      </button>
    {:else}
      <div
        class="relative overflow-hidden rounded-2xl bg-gradient-to-br {c.grad} p-3 text-left text-white shadow-card
          transition-transform active:scale-[.98]"
      >
        {@render cardBody(c)}
      </div>
    {/if}
  {/each}
</section>
