<script lang="ts">
  /**
   * Shared "Donate Now" page body, used by every skin's pages/Donate.svelte so
   * the (DB-driven) content and layout stay identical across all 18 themes. Each
   * skin passes its own card surface class (e.g. premium `surface`, festival
   * `CARD`) via the `surfaceClass` prop; everything else is theme-agnostic
   * (brand/slate utilities that resolve on every theme, light + dark).
   *
   * All payment details come from the backend (portal_settings donation_*, via
   * donationSettings()); any empty field is hidden. The committee-member list is
   * the CURRENT/live committee (currentCommittee()), independent of the header
   * year dropdown — picking an older year never changes it.
   */
  import { Smartphone, Landmark, Wallet, MessageCircle, MapPin } from '@lucide/svelte';
  import { portalState } from '$lib/stores/portal';
  import { tr, lang } from '$lib/stores/lang';
  import { donationSettings, currentCommittee } from '$lib/api/derive';

  interface Props {
    /** The skin's card surface class (e.g. 'surface' or the festival CARD). */
    surfaceClass?: string;
  }
  let { surfaceClass = 'surface' }: Props = $props();

  let d = $derived(donationSettings($portalState.data));
  let members = $derived(currentCommittee($portalState.data));

  // Any concrete detail present at all? (Used to show a graceful empty note.)
  let hasAny = $derived(
    !!(d.upiId || d.qrUrl || d.bankAccountName || d.bankName || d.accountNumber || d.ifsc || d.whatsapp)
  );

  const nameOf = (m: { name: string; nameHindi: string }) =>
    $lang === 'hi' && m.nameHindi ? m.nameHindi : m.name;
  const villageOf = (m: { village: string; villageHindi: string }) =>
    $lang === 'hi' && m.villageHindi ? m.villageHindi : m.village;
  const orgVars = $derived({ whatsapp: d.whatsapp });
</script>

<div class="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
  <!-- Heading + intro -->
  <div class="text-center">
    <h2 class="text-lg font-black text-brand-600 dark:text-brand-300">{$tr('donate_heading')}</h2>
    <p class="mx-auto mt-2 max-w-xl">{$tr('donate_intro')}</p>
  </div>

  {#if !hasAny && members.length === 0}
    <div class="{surfaceClass} p-6 text-center text-slate-500 dark:text-slate-400">{$tr('donate_empty')}</div>
  {/if}

  <!-- 1. Online (UPI) -->
  {#if d.upiId || d.qrUrl}
    <section class="{surfaceClass} space-y-3 p-5">
      <h3 class="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
        <Smartphone class="h-4 w-4 text-brand-500" aria-hidden="true" /> {$tr('donate_online_h')}
      </h3>
      <p>{$tr('donate_online_p')}</p>
      {#if d.upiId}
        <p class="font-semibold">
          <span class="text-slate-500 dark:text-slate-400">{$tr('donate_upi_label')}:</span>
          <span class="select-all font-black text-brand-600 dark:text-brand-300">{d.upiId}</span>
        </p>
      {/if}
      {#if d.qrUrl}
        <div>
          <p class="mb-2 font-semibold text-slate-500 dark:text-slate-400">{$tr('donate_qr_label')}:</p>
          <img
            src={d.qrUrl}
            alt={$tr('donate_qr_label')}
            loading="lazy"
            class="h-48 w-48 rounded-xl border border-black/10 bg-white object-contain p-2 dark:border-white/10"
          />
        </div>
      {/if}
      {#if d.whatsapp}
        <p>{$tr('donate_online_note')}</p>
        <p class="font-semibold">
          <span class="text-slate-500 dark:text-slate-400">{$tr('donate_whatsapp_label')}:</span>
          <a href="https://wa.me/{d.whatsapp.replace(/[^0-9]/g, '')}" target="_blank" rel="noopener" class="font-black text-emerald-600 hover:underline dark:text-emerald-400">{d.whatsapp}</a>
        </p>
        <p class="text-slate-500 dark:text-slate-400">{$tr('donate_online_verify')}</p>
      {/if}
    </section>
  {/if}

  <!-- 2. Bank Transfer -->
  {#if d.bankAccountName || d.bankName || d.accountNumber || d.ifsc}
    <section class="{surfaceClass} space-y-3 p-5">
      <h3 class="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
        <Landmark class="h-4 w-4 text-brand-500" aria-hidden="true" /> {$tr('donate_bank_h')}
      </h3>
      <p>{$tr('donate_bank_p')}</p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {#if d.bankAccountName}
          <dt class="font-semibold text-slate-500 dark:text-slate-400">{$tr('donate_bank_account_name')}:</dt>
          <dd class="font-bold">{d.bankAccountName}</dd>
        {/if}
        {#if d.bankName}
          <dt class="font-semibold text-slate-500 dark:text-slate-400">{$tr('donate_bank_name')}:</dt>
          <dd class="font-bold">{d.bankName}</dd>
        {/if}
        {#if d.accountNumber}
          <dt class="font-semibold text-slate-500 dark:text-slate-400">{$tr('donate_bank_account_number')}:</dt>
          <dd class="select-all font-black">{d.accountNumber}</dd>
        {/if}
        {#if d.ifsc}
          <dt class="font-semibold text-slate-500 dark:text-slate-400">{$tr('donate_bank_ifsc')}:</dt>
          <dd class="select-all font-black">{d.ifsc}</dd>
        {/if}
      </dl>
      {#if d.whatsapp}
        <p class="text-slate-500 dark:text-slate-400">{$tr('donate_bank_note', orgVars)}</p>
      {/if}
    </section>
  {/if}

  <!-- 3. Cash — live committee members (year-independent) -->
  {#if members.length > 0}
    <section class="{surfaceClass} space-y-3 p-5">
      <h3 class="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
        <Wallet class="h-4 w-4 text-brand-500" aria-hidden="true" /> {$tr('donate_cash_h')}
      </h3>
      <p>{$tr('donate_cash_p')}</p>
      <ul class="space-y-2">
        {#each members as m, i (m.seed + '-' + i)}
          <li class="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] px-3 py-2 dark:bg-white/5">
            <span class="min-w-0">
              <span class="block truncate font-bold">{$tr('donate_cash_member')} {i + 1}: {nameOf(m) || $tr('na')}</span>
              {#if villageOf(m)}<span class="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><MapPin class="h-3 w-3" />{villageOf(m)}</span>{/if}
            </span>
            {#if m.mobile}
              <a href="tel:{m.mobile}" class="inline-flex flex-none items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                <MessageCircle class="h-3.5 w-3.5" aria-hidden="true" />{m.mobile}
              </a>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="text-slate-500 dark:text-slate-400">{$tr('donate_cash_note')}</p>
    </section>
  {/if}

  <!-- Closing -->
  <div class="space-y-1 pt-1 text-center">
    <p class="font-semibold">{$tr('donate_closing')}</p>
    <p class="font-bold text-brand-600 dark:text-brand-300">{$tr('donate_values')}</p>
    <p class="mt-2 font-black">{$tr('org_name')}</p>
    <p class="text-xs text-slate-500 dark:text-slate-400">{$tr('org_location')}</p>
    <p class="mt-1 text-base font-black">{$tr('donate_jai')}</p>
  </div>
</div>
