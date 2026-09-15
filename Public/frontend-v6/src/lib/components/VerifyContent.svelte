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
  import { ShieldCheck, ShieldX, ShieldQuestion, RefreshCw, ArrowLeft } from '@lucide/svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { portalState, refreshPortal } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { verifyRecord, type VerifyResult } from '$lib/api/derive';
  import { verifyVerdict } from '$lib/api/verifyVerdict';
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

  let result = $derived<VerifyResult | null>(recordId ? verifyRecord($portalState.data, recordId) : null);

  // ---- audit P0-10: "not found" is a claim we must be entitled to make ----
  //
  // This used to be a two-way verdict: `result.verified` or the red "Record Not
  // Found". `verifyRecord()` simply asks whether the id appears in the data we
  // happen to hold — so with the API down on a first visit (empty data) or with an
  // out-of-date snapshot, a perfectly genuine receipt was declared invalid. That
  // is the portal's central trust journey, and the old code also ignored
  // `$portalState.failed` and `$portalState.stale` entirely.
  //
  // The verdict is now split by what we actually know:
  //   checking      still loading (or not started — the prerendered shell)
  //   no-id         opened without ?record=
  //   malformed     the id is not even the right shape (safe to say without data)
  //   unavailable   we hold NO records, so we cannot check at all
  //   verified      found (a hit in a stale snapshot is still a real hit — noted)
  //   inconclusive  not found, but only a possibly-out-of-date copy was searched
  //   not-found     not found in live records — the only authoritative negative
  // The decision itself lives in lib/api/verifyVerdict.ts so it can be unit
  // tested against every combination of loading / failed / stale / found.
  let verdict = $derived(
    verifyVerdict({
      recordId,
      result,
      status: $portalState.status,
      failed: $portalState.failed,
      stale: $portalState.stale
    })
  );

  let refreshing = $state(false);
  async function retry() {
    refreshing = true;
    try {
      await refreshPortal();
    } finally {
      refreshing = false;
    }
  }

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
  {#if verdict === 'no-id'}
    <!-- Opened without a ?record= id -->
    <section class="{surfaceClass} p-5">
      <p class="text-slate-600 dark:text-slate-300">{$tr('verify_no_id')}</p>
    </section>
  {:else if verdict === 'malformed'}
    <section class="{surfaceClass} p-5">
      <p class="text-slate-600 dark:text-slate-300">{$tr('verify_malformed')}</p>
      <p class="mt-2 break-all font-mono text-[11px] text-slate-400 dark:text-slate-500">{recordId}</p>
    </section>
  {:else if verdict === 'checking'}
    <section class="{surfaceClass} p-5" aria-busy="true">
      <p class="sr-only" role="status">{$tr('verify_checking')}</p>
      <div class="skeleton h-6 w-40"></div>
      <div class="skeleton mt-3 h-4 w-full"></div>
      <div class="skeleton mt-2 h-4 w-2/3"></div>
    </section>
  {:else if verdict === 'unavailable' || verdict === 'inconclusive'}
    <!--
      audit P0-10: neither of these is "invalid". We either hold no records at all,
      or only a copy that may predate this document — so we say exactly that and
      offer a retry instead of a red verdict the data does not support.
    -->
    <section class="{surfaceClass} border-l-4 border-warning p-5">
      <div class="flex items-center gap-2">
        <ShieldQuestion class="h-6 w-6 shrink-0 text-amber-700 dark:text-warning" aria-hidden="true" />
        <!-- amber-700 rather than the lighter `warning` token: this is 16px bold
             body text, and #F59E0B on white is ~2.2:1. -->
        <strong class="text-base font-black text-amber-700 dark:text-warning">
          {verdict === 'unavailable' ? $tr('verify_unavailable') : $tr('verify_inconclusive')}
        </strong>
      </div>
      <p class="mt-0.5 break-all font-mono text-[11px] text-slate-400 dark:text-slate-500">{recordId}</p>
      <p class="mt-3 text-slate-600 dark:text-slate-300">
        {verdict === 'unavailable' ? $tr('verify_unavailable_help') : $tr('verify_inconclusive_help')}
      </p>
      <button
        type="button"
        class="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-700 active:scale-95 disabled:opacity-60"
        onclick={retry}
        disabled={refreshing}
      >
        <RefreshCw class="h-4 w-4 {refreshing ? 'animate-spin' : ''}" aria-hidden="true" />
        {$tr('retry')}
      </button>
    </section>
  {:else if result}
    <section class="{surfaceClass} border-l-4 p-5 {verdict === 'verified' ? 'border-success' : 'border-danger'}">
      <!-- Verdict -->
      <div class="flex items-center gap-2">
        {#if verdict === 'verified'}
          <ShieldCheck class="h-6 w-6 shrink-0 text-success" aria-hidden="true" />
          <strong class="text-base font-black text-success">{$tr('verified_record')}</strong>
        {:else}
          <ShieldX class="h-6 w-6 shrink-0 text-danger" aria-hidden="true" />
          <strong class="text-base font-black text-danger">{$tr('record_not_found')}</strong>
        {/if}
      </div>

      {#if verdict === 'verified' && $portalState.stale}
        <!-- A hit in a saved copy IS a real hit, but say where it came from. -->
        <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">{$tr('verify_stale_note')}</p>
      {/if}

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
      {:else if verdict === 'not-found'}
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
