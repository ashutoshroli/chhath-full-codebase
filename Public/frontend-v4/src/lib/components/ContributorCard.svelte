<script lang="ts">
  import { Crown } from '@lucide/svelte';
  import type { Ranked } from '$lib/utils/ranking';
  import type { Contributor } from '$lib/api/derive';
  import { fmt, initials, avatarGradient } from '$lib/utils/format';
  import { lang, tr } from '$lib/stores/lang';

  interface Props {
    entry: Ranked<Contributor>;
    /** compact = live-scroll ticker size; false = directory grid size */
    compact?: boolean;
    onclick?: () => void;
  }
  let { entry, compact = true, onclick }: Props = $props();

  let c = $derived(entry.item);
  let displayName = $derived($lang === 'hi' && c.nameHindi ? c.nameHindi : c.name);
  let grad = $derived(avatarGradient(c.key));
</script>

<button
  type="button"
  {onclick}
  class="relative flex flex-col items-center rounded-2xl border p-3 text-center transition
    active:scale-[.97] focus-visible:ring-2
    {entry.isTop
      ? 'border-gold/70 bg-gradient-to-b from-amber-50 to-amber-100 shadow-[0_6px_18px_-8px_rgba(245,184,64,.6)] dark:from-amber-500/15 dark:to-amber-700/10'
      : 'border-black/5 bg-white/70 dark:border-white/10 dark:bg-white/5'}
    {compact ? 'w-[104px] shrink-0 snap-start' : 'w-full'}"
>
  {#if entry.isTop}
    <!-- Top-5 treatment: crown + rank badge + Top 5 tag. Subtle, premium. -->
    <span
      class="absolute -top-2.5 left-1/2 -translate-x-1/2 text-gold drop-shadow"
      aria-hidden="true"
    >
      <Crown class="h-4 w-4 fill-current" />
    </span>
    <span
      class="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-gold
        text-[10px] font-black text-amber-900"
      aria-label="Rank {entry.rank}"
    >
      {entry.rank}
    </span>
  {/if}

  <span
    class="mt-1 grid h-11 w-11 place-items-center rounded-full text-sm font-black text-white"
    style="background-image: linear-gradient(135deg, {grad[0]}, {grad[1]})"
    aria-hidden="true"
  >
    {initials(displayName)}
  </span>

  <span class="mt-2 line-clamp-1 w-full text-[11px] font-bold" title={displayName}>{displayName}</span>
  <span class="mt-0.5 text-sm font-black text-brand-600 dark:text-brand-300">{fmt(c.amount)}</span>

  {#if entry.isTop}
    <span class="mt-1 rounded-full bg-gold/20 px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">
      {$tr('top5')}
    </span>
  {/if}
</button>
