<script lang="ts">
  import { X, MapPin, Crown } from '@lucide/svelte';
  import type { Ranked } from '$lib/utils/ranking';
  import type { Contributor } from '$lib/api/derive';
  import { fmt, initials, avatarGradient } from '$lib/utils/format';
  import { lang, tr } from '$lib/stores/lang';

  interface Props {
    entry: Ranked<Contributor> | null;
    onclose: () => void;
  }
  let { entry, onclose }: Props = $props();

  let c = $derived(entry?.item ?? null);
  let displayName = $derived(c ? ($lang === 'hi' && c.nameHindi ? c.nameHindi : c.name) : '');
  let displayVillage = $derived(c ? ($lang === 'hi' && c.villageHindi ? c.villageHindi : c.village) : '');
  let displayDesignation = $derived(
    c ? ($lang === 'hi' && c.designationHindi ? c.designationHindi : c.designation) : ''
  );
  let displayFather = $derived(c ? ($lang === 'hi' && c.fatherNameHindi ? c.fatherNameHindi : c.fatherName) : '');
  let kindLabel = $derived(
    c && !c.hasMoney ? (c.kinds.has('material') ? $tr('material') : $tr('service')) : ''
  );
  let grad = $derived(avatarGradient(c?.key));

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if entry && c}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    onclick={onclose}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="surface w-full max-w-sm rounded-b-none rounded-t-3xl p-5 sm:rounded-3xl"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={$tr('contributor_detail')}
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-start justify-between">
        <h2 class="text-sm font-bold text-slate-500 dark:text-slate-400">{$tr('contributor_detail')}</h2>
        <button class="chip !h-8 !w-8 !px-0" onclick={onclose} aria-label={$tr('close')}>
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-3 flex flex-col items-center text-center">
        <span
          class="grid h-20 w-20 place-items-center rounded-full text-2xl font-black text-white"
          style="background-image: linear-gradient(135deg, {grad[0]}, {grad[1]})"
          aria-hidden="true"
        >
          {initials(displayName)}
        </span>
        <p class="mt-3 text-lg font-black">{displayName}</p>
        {#if displayDesignation}
          <p class="text-xs font-semibold text-brand-600 dark:text-brand-300">{displayDesignation}</p>
        {/if}
        {#if displayVillage}
          <p class="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <MapPin class="h-3.5 w-3.5" />{displayVillage}
          </p>
        {/if}
        {#if entry.isTop}
          <span class="mt-2 inline-flex items-center gap-1 rounded-full bg-gold/20 px-2.5 py-1 text-[11px] font-black text-amber-700 dark:text-amber-300">
            <Crown class="h-3.5 w-3.5 fill-current" /> {$tr('top5')} · #{entry.rank}
          </span>
        {/if}
      </div>

      <dl class="mt-4 space-y-2 rounded-xl bg-black/[.03] p-3 text-sm dark:bg-white/[.04]">
        <div class="flex justify-between">
          <dt class="text-slate-500 dark:text-slate-400">{$tr('amount')}</dt>
          <dd class="font-extrabold text-brand-600 dark:text-brand-300">
            {#if c.hasMoney}{fmt(c.amount)}{:else}<span class="text-info">{kindLabel}</span>{/if}
          </dd>
        </div>
        {#if displayFather}
          <div class="flex justify-between gap-4">
            <dt class="shrink-0 text-slate-500 dark:text-slate-400">{$tr('father_name')}</dt>
            <dd class="truncate text-right font-semibold">{displayFather}</dd>
          </div>
        {/if}
        {#if c.detail}
          <div class="flex justify-between gap-4">
            <dt class="shrink-0 text-slate-500 dark:text-slate-400">{$tr('detail')}</dt>
            <dd class="truncate text-right font-semibold">{c.detail}</dd>
          </div>
        {/if}
        <div class="flex justify-between">
          <dt class="text-slate-500 dark:text-slate-400">{$tr('contributions_count')}</dt>
          <dd class="font-bold">{c.count}</dd>
        </div>
      </dl>
    </div>
  </div>
{/if}
