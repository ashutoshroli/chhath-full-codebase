<script lang="ts">
  /**
   * "Install app" button. Rendered in two places — the /guide page's install
   * section, and the mobile "More" bottom sheet.
   *
   * The button is ALWAYS visible (unless the app is already installed):
   *  - On Chromium browsers that fired `beforeinstallprompt`, tapping it opens
   *    the real native install prompt.
   *  - Otherwise (iOS Safari, Firefox, or Chrome that has not fired the event
   *    yet / already dismissed it) tapping it reveals a short hint pointing at
   *    the per-platform steps on the guide page, instead of the button silently
   *    not existing — which is what used to happen.
   *
   * The `beforeinstallprompt` / `appinstalled` listeners deliberately live in
   * $lib/stores/install (registered at app bootstrap) rather than in this
   * component's onMount: the More sheet mounts only when it is opened, which is
   * long after the browser fires that event, so a per-instance listener would
   * never receive it. See that module for the full explanation.
   */
  import { Download, Check, Info } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { canPrompt, installed, promptInstall } from '$lib/stores/install';

  let busy = $state(false);
  let showHint = $state(false);

  // If the browser offers a real prompt after the hint was shown, drop the hint.
  $effect(() => {
    if ($canPrompt) showHint = false;
  });

  async function install() {
    if (busy) return;
    // No native prompt available → guide the visitor to the manual steps.
    if (!$canPrompt) {
      showHint = true;
      return;
    }
    busy = true;
    try {
      // A dismissed prompt cannot be re-shown for this page load; fall back to
      // the manual hint if they change their mind.
      if ((await promptInstall()) !== 'accepted') showHint = true;
    } finally {
      busy = false;
    }
  }
</script>

{#if $installed}
  <span class="inline-flex items-center gap-2 rounded-lg bg-success/15 px-4 py-2 text-sm font-bold text-success">
    <Check class="h-4 w-4" aria-hidden="true" />
    {$tr('guide_install_installed')}
  </span>
{:else}
  <button
    type="button"
    onclick={install}
    disabled={busy}
    class="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600 active:scale-95 disabled:opacity-60"
  >
    <Download class="h-4 w-4" aria-hidden="true" />
    {busy ? $tr('guide_install_busy') : $tr('guide_install_btn')}
  </button>

  {#if showHint}
    <p class="mt-2 flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
      <Info class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden="true" />
      <span>{$tr('guide_install_manual_hint')}</span>
    </p>
  {/if}
{/if}
