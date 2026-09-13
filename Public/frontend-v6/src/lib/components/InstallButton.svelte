<script lang="ts">
  /**
   * "Install app" button for the guide. On Chromium browsers that fire the
   * `beforeinstallprompt` event, tapping it triggers the native install prompt.
   * On browsers without programmatic install (iOS Safari, or when already
   * installed), the button is hidden and the guide's step-by-step instructions
   * are the fallback path.
   */
  import { onMount } from 'svelte';
  import { Download, Check } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';

  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  let deferred = $state<BeforeInstallPromptEvent | null>(null);
  let installed = $state(false);
  let busy = $state(false);

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
    };
    const onInstalled = () => {
      installed = true;
      deferred = null;
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

  async function install() {
    if (!deferred || busy) return;
    busy = true;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* user dismissed / not available */
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
{:else if deferred}
  <button
    type="button"
    onclick={install}
    disabled={busy}
    class="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600 active:scale-95 disabled:opacity-60"
  >
    <Download class="h-4 w-4" aria-hidden="true" />
    {$tr('guide_install_btn')}
  </button>
{/if}
