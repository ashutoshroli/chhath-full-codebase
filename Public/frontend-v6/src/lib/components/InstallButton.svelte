<script lang="ts">
  /**
   * "Install app" button for the guide.
   *
   * The button is ALWAYS visible (unless the app is already installed):
   *  - On Chromium browsers that fired `beforeinstallprompt`, tapping it opens
   *    the real native install prompt.
   *  - Otherwise (iOS Safari, Firefox, or Chrome that has not fired the event
   *    yet / already dismissed it) tapping it reveals a short hint pointing at
   *    the per-platform steps below, instead of the button silently not
   *    existing — which is what used to happen.
   */
  import { onMount } from 'svelte';
  import { Download, Check, Info } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';

  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  let deferred = $state<BeforeInstallPromptEvent | null>(null);
  let installed = $state(false);
  let busy = $state(false);
  let showHint = $state(false);

  onMount(() => {
    // Already running as an installed app? Then don't offer install.
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // iOS Safari
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) installed = true;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as BeforeInstallPromptEvent;
      showHint = false;
    };
    const onInstalled = () => {
      installed = true;
      deferred = null;
      showHint = false;
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

  async function install() {
    if (busy) return;
    // No native prompt available → guide the visitor to the manual steps.
    if (!deferred) {
      showHint = true;
      return;
    }
    busy = true;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      // A dismissed prompt cannot be re-shown for this page load; fall back to
      // the manual hint if they change their mind.
      if (choice?.outcome !== 'accepted') showHint = true;
    } catch {
      showHint = true;
    } finally {
      deferred = null;
      busy = false;
    }
  }
</script>

{#if installed}
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
