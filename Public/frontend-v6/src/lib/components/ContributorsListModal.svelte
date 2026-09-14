<script lang="ts">
  import { Crown } from '@lucide/svelte';
  import Modal from './Modal.svelte';
  import { portalState, year } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { rankedContributors, resoldItemsForYear, contributorTags, ALL_YEARS } from '$lib/api/derive';
  import { fmt, initials, avatarGradient } from '$lib/utils/format';
  import { SvelteSet } from 'svelte/reactivity';

  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();

  let ranked = $derived(rankedContributors($portalState.data, $year));
  let resold = $derived(resoldItemsForYear($portalState.data, $year));
  let yearLabel = $derived($year === ALL_YEARS ? $tr('all_years') : String($year));
  const nameOf = (c: { name: string; nameHindi: string }) =>
    $lang === 'hi' && c.nameHindi ? c.nameHindi : c.name;

  type Tab = 'contributors' | 'resold';
  let tab = $state<Tab>('contributors');
  const tagLabel = (k: 'material' | 'service') => (k === 'material' ? $tr('material') : $tr('service'));

  // Photos that failed to load — those rows fall back to the initials avatar
  // instead of hiding the image and leaving a blank gap.
  let failedPhotos = $state(new SvelteSet<string>());
</script>

<Modal {open} {onclose} title={$tr('contributors_live_scroll', { year: yearLabel })}>
  <!-- Tabs -->
  <div class="mb-3 flex gap-1 rounded-xl bg-black/[.04] p-1 dark:bg-white/[.06]">
    <button
      type="button"
      onclick={() => (tab = 'contributors')}
      class="flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition
        {tab === 'contributors' ? 'bg-white text-brand-600 shadow-sm dark:bg-white/10 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'}"
      aria-pressed={tab === 'contributors'}
    >
      {$tr('tab_contributors')} · {ranked.length}
    </button>
    <button
      type="button"
      onclick={() => (tab = 'resold')}
      class="flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition
        {tab === 'resold' ? 'bg-white text-brand-600 shadow-sm dark:bg-white/10 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'}"
      aria-pressed={tab === 'resold'}
    >
      {$tr('tab_resold')} · {resold.length}
    </button>
  </div>

  {#if tab === 'contributors'}
    {#if ranked.length === 0}
      <p class="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{$tr('no_records_found')}</p>
    {:else}
      <ul class="space-y-2">
        {#each ranked as entry (entry.item.key)}
          {@const grad = avatarGradient(entry.item.key)}
          {@const tags = contributorTags(entry.item)}
          <li
            class="flex items-center gap-3 rounded-xl border p-2.5
              {entry.isTop
                ? 'border-gold/60 bg-gold/10'
                : 'border-black/5 bg-black/[.02] dark:border-white/10 dark:bg-white/[.03]'}"
          >
            <span class="relative">
              {#if entry.item.photo && !failedPhotos.has(entry.item.key)}
                <img
                  src={entry.item.photo}
                  alt={nameOf(entry.item)}
                  loading="lazy"
                  class="h-10 w-10 rounded-full object-cover"
                  onerror={() => failedPhotos.add(entry.item.key)}
                />
              {:else}
                <span
                  class="grid h-10 w-10 place-items-center rounded-full text-sm font-black text-white"
                  style="background-image: linear-gradient(135deg, {grad[0]}, {grad[1]})"
                >
                  {initials(nameOf(entry.item))}
                </span>
              {/if}
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
              <span class="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                {#if entry.item.village}<span class="truncate">{entry.item.village}</span>{/if}
                {#if entry.item.count > 1}
                  <span class="rounded bg-black/5 px-1 font-semibold dark:bg-white/10">{$tr('times_contributed', { count: entry.item.count })}</span>
                {/if}
              </span>
            </span>
            <!-- Amount + all non-money tags (money+material shows BOTH). -->
            <span class="flex shrink-0 flex-col items-end gap-1">
              {#if entry.item.hasMoney}
                <span class="text-sm font-black text-brand-600 dark:text-brand-300">{fmt(entry.item.amount)}</span>
              {/if}
              {#if tags.includes('material') || tags.includes('service')}
                <span class="flex gap-1">
                  {#if tags.includes('material')}
                    <span class="rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-bold text-info">{tagLabel('material')}</span>
                  {/if}
                  {#if tags.includes('service')}
                    <span class="rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-bold text-info">{tagLabel('service')}</span>
                  {/if}
                </span>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if resold.length === 0}
    <p class="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{$tr('no_resold_items')}</p>
  {:else}
    <ul class="space-y-2">
      {#each resold as item (item.key)}
        <li class="flex items-center gap-3 rounded-xl border border-black/5 bg-black/[.02] p-2.5 dark:border-white/10 dark:bg-white/[.03]">
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-bold">{item.name || $tr('resold_item')}</span>
            <span class="block text-[11px] text-slate-500 dark:text-slate-400">{$tr('resell')}</span>
          </span>
          <span class="shrink-0 text-sm font-black text-emerald-600 dark:text-emerald-400">{fmt(item.amount)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</Modal>
