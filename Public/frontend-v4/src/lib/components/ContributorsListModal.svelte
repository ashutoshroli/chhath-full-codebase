<script lang="ts">
  import { Crown } from '@lucide/svelte';
  import Modal from './Modal.svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { rankedContributors, ALL_YEARS } from '$lib/api/derive';
  import { fmt, initials, avatarGradient } from '$lib/utils/format';

  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();

  let ranked = $derived(rankedContributors($portalState.data, $year));
  let yearLabel = $derived($year === ALL_YEARS ? $tr('all_years') : String($year));
  const nameOf = (c: { name: string; nameHindi: string }) =>
    $lang === 'hi' && c.nameHindi ? c.nameHindi : c.name;
</script>

<Modal {open} {onclose} title={$tr('contributors_live_scroll', { year: yearLabel })}>
  <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">
    {$tr('total_contributions', { count: ranked.length })}
  </p>

  {#if ranked.length === 0}
    <p class="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{$tr('no_records_found')}</p>
  {:else}
    <ul class="space-y-2">
      {#each ranked as entry (entry.item.key)}
        {@const grad = avatarGradient(entry.item.key)}
        <li
          class="flex items-center gap-3 rounded-xl border p-2.5
            {entry.isTop
              ? 'border-gold/60 bg-gold/10'
              : 'border-black/5 bg-black/[.02] dark:border-white/10 dark:bg-white/[.03]'}"
        >
          <span class="relative">
            <span
              class="grid h-10 w-10 place-items-center rounded-full text-sm font-black text-white"
              style="background-image: linear-gradient(135deg, {grad[0]}, {grad[1]})"
            >
              {initials(nameOf(entry.item))}
            </span>
            {#if entry.isTop}
              <span class="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-gold text-[9px] font-black text-amber-900">
                {entry.rank}
              </span>
            {/if}
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1 truncate text-sm font-bold">
              {nameOf(entry.item)}
              {#if entry.isTop}<Crown class="h-3.5 w-3.5 shrink-0 fill-current text-gold" />{/if}
            </span>
            {#if entry.item.village}
              <span class="block truncate text-[11px] text-slate-500 dark:text-slate-400">{entry.item.village}</span>
            {/if}
          </span>
          <span class="shrink-0 text-sm font-black text-brand-600 dark:text-brand-300">{fmt(entry.item.amount)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</Modal>
