<script lang="ts">
  /**
   * Opt-in button for push notifications, shown on the guide page.
   *
   * Deliberately NOT pushy: it renders nothing at all when the deployment has no
   * VAPID key or the browser cannot do push, and the permission prompt is only
   * raised by an explicit click. Once subscribed it offers turning it back off.
   */
  import { onMount } from 'svelte';
  import { Bell, BellOff, BellRing, Info } from '@lucide/svelte';
  import { tr } from '$lib/stores/lang';
  import { pushSupported, pushState, subscribe, unsubscribe, type PushState } from '$lib/push';

  // NOTE: not named `state` — that shadows the `$state` rune.
  let status = $state<PushState>('unsupported');
  let busy = $state(false);
  let ready = $state(false);

  onMount(async () => {
    if (!pushSupported()) {
      status = 'unsupported';
      ready = true;
      return;
    }
    status = await pushState();
    ready = true;
  });

  async function turnOn() {
    if (busy) return;
    busy = true;
    try {
      status = await subscribe();
    } finally {
      busy = false;
    }
  }

  async function turnOff() {
    if (busy) return;
    busy = true;
    try {
      status = await unsubscribe();
    } finally {
      busy = false;
    }
  }
</script>

{#if ready && status !== 'unsupported'}
  {#if status === 'subscribed'}
    <div class="flex flex-wrap items-center gap-2">
      <span class="inline-flex items-center gap-2 rounded-lg bg-success/15 px-4 py-2 text-sm font-bold text-success">
        <BellRing class="h-4 w-4" aria-hidden="true" />
        {$tr('notify_on')}
      </span>
      <button
        type="button"
        onclick={turnOff}
        disabled={busy}
        class="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-black/5 disabled:opacity-60 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
      >
        <BellOff class="h-3.5 w-3.5" aria-hidden="true" />
        {$tr('notify_turn_off')}
      </button>
    </div>
  {:else if status === 'denied'}
    <p class="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
      <Info class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden="true" />
      <span>{$tr('notify_blocked')}</span>
    </p>
  {:else}
    <button
      type="button"
      onclick={turnOn}
      disabled={busy}
      class="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-600 active:scale-95 disabled:opacity-60"
    >
      <Bell class="h-4 w-4" aria-hidden="true" />
      {busy ? $tr('notify_busy') : $tr('notify_btn')}
    </button>
  {/if}
{/if}
