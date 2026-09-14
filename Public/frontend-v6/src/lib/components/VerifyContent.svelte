<script lang="ts">
  /**
   * Shared "Record Verification" body, used by every skin's pages/Verify.svelte
   * so the logic stays identical across all 18 themes while each skin supplies
   * its own card surface class.
   *
   * The QR printed on every receipt / certificate opens the portal with
   * `?record=<docType>-<year>-<ref>`; verifyRecord() checks that id against the
   * committee's generated_files and resolves the underlying collections row, so
   * the visitor can confirm the paper in their hand is genuine.
   */
  import { ShieldCheck, ShieldX, ArrowLeft } from '@lucide/svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { portalState } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { verifyRecord } from '$lib/api/derive';
  import { fmt } from '$lib/utils/format';

  interface Props {
    /** The skin's card surface class (e.g. 'surface' or the festival CARD). */
    surfaceClass?: string;
  }
  let { surfaceClass = 'surface' }: Props = $props();

  // The whole site is prerendered, and `url.searchParams` cannot be read during
  // prerender — so resolve the id on the client only ($effect never runs on the
  // server). The prerendered shell shows the "no id" state and then hydrates.
  let recordId = $state('');
  $effect(() => {
    if (browser) recordId = $page.url.searchParams.get('record') || '';
  });

  let loading = $derived($portalState.status === 'loading');
  let result = $derived(recordId ? verifyRecord($portalState.data, recordId) : null);

  let docLabel = $derived(
    result ? (result.docLabelKey ? $tr(result.docLabelKey) : result.docType || '—') : ''
  );
  let displayName = $derived(
    result?.details
      ? $lang === 'hi' && result.details.nameHindi
        ? result.details.nameHindi
        : result.details.name
      : ''
  );
  let displayVillage = $derived(
    result?.details
      ? $lang === 'hi' && result.details.villageHindi
        ? result.details.villageHindi
        : result.details.village
      : ''
  );
</script>

<div class="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
  {#if !recordId}
    <!-- Opened without a ?record= id -->
    <section class="{surfaceClass} p-5">
      <p class="text-slate-600 dark:text-slate-300">{$tr('verify_no_id')}</p>
    </section>
  {:else if loading}
    <section class="{surfaceClass} p-5">
      <div class="skeleton h-6 w-40"></div>
      <div class="skeleton mt-3 h-4 w-full"></div>
      <div class="skeleton mt-2 h-4 w-2/3"></div>
    </section>
  {:else if result}
    <section class="{surfaceClass} border-l-4 p-5 {result.verified ? 'border-success' : 'border-danger'}">
      <!-- Verdict -->
      <div class="flex items-center gap-2">
        {#if result.verified}
          <ShieldCheck class="h-6 w-6 shrink-0 text-success" aria-hidden="true" />
          <strong class="text-base font-black text-success">{$tr('verified_record')}</strong>
        {:else}
          <ShieldX class="h-6 w-6 shrink-0 text-danger" aria-hidden="true" />
          <strong class="text-base font-black text-danger">{$tr('record_not_found')}</strong>
        {/if}
      </div>

      <!-- Document + year -->
      <p class="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
        {docLabel} — {$tr('year')} {result.year || '—'}
      </p>
      <p class="mt-0.5 break-all font-mono text-[11px] text-slate-400 dark:text-slate-500">{result.recordId}</p>

      {#if result.verified && result.details}
        <!-- Resolved record details to check against the paper -->
        <div class="mt-4 space-y-1.5 border-t border-black/10 pt-3 dark:border-white/10">
          {#if result.details.isResell}
            <p class="font-bold">♻️ {$tr('resell')}: {result.details.name || '—'}</p>
          {:else}
            <p class="font-bold">
              {displayName || $tr('na')}{#if displayVillage && displayVillage !== '-'} — <span class="font-semibold text-slate-600 dark:text-slate-300">{displayVillage}</span>{/if}
            </p>
          {/if}
          {#if result.details.amount}
            <p><span class="text-slate-500 dark:text-slate-400">{$tr('amount')}:</span> <strong>{fmt(result.details.amount)}</strong></p>
          {/if}
          {#if result.details.detail}
            <p><span class="text-slate-500 dark:text-slate-400">{$tr('detail')}:</span> {result.details.detail}</p>
          {/if}
        </div>
      {:else if !result.verified}
        <p class="mt-3 text-slate-600 dark:text-slate-300">{$tr('verify_help')}</p>
      {/if}
    </section>
  {/if}

  <div class="mt-4 text-center">
    <a
      href="/"
      class="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600 active:scale-95"
    >
      <ArrowLeft class="h-4 w-4" aria-hidden="true" />
      {$tr('back_to_home')}
    </a>
  </div>
</div>
