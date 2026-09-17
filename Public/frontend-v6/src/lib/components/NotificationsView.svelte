<script lang="ts">
  /**
   * The "Notifications" view of the Menu bottom sheet.
   *
   * It is rendered INSIDE the sheet's existing container (see MoreMenu.svelte),
   * not as a second overlay — that is what makes it exactly the same size and
   * sit in exactly the same place as the Menu view, and it avoids duplicating the
   * sheet's tricky bits (the portal to <body> and the manual copy of the theme
   * tokens onto the portaled node).
   *
   * THEME-DRIVEN: the back arrow, the bell, the unread dot, the row highlight
   * and every accent surface read the live `--accent` token, so the panel takes
   * on each theme's colour. Structural hairlines use `black/10 dark:white/10`
   * rather than `--surface-border`, because that token is WHITE at :root and the
   * default light theme (sunrise) never overrides it, which would leave the
   * dividers invisible on the sheet's light surface. Neutral text uses the
   * `slate-* / dark:slate-*` pairing the sheet itself already uses.
   */
  import { ArrowLeft, Bell, BellRing, CheckCheck, Trash2 } from '@lucide/svelte';
  import { sameOriginPath } from '$lib/pushTarget.js';
  import { tr } from '$lib/stores/lang';
  import { lang } from '$lib/stores/lang';
  import { t } from '$lib/i18n';
  import { inbox, unreadCount, markAllRead, clearAll } from '$lib/stores/notifications';
  import { safeUrl } from '$lib/utils/format';
  import NotifyButton from './NotifyButton.svelte';

  interface Props {
    /** Go back to the Menu view. */
    onback: () => void;
    /** Close the whole sheet (used after following a notification's link). */
    onclose: () => void;
  }
  let { onback, onclose }: Props = $props();

  /**
   * Relative arrival time. `receivedAt` is stamped by the service worker because
   * the push payload carries no timestamp of its own.
   */
  function ago(ms: number, l: 'en' | 'hi'): string {
    const diff = Math.max(0, Date.now() - (ms || 0));
    const min = Math.floor(diff / 60000);
    if (min < 1) return t(l, 'notif_now');
    if (min < 60) return t(l, 'notif_min_ago', { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t(l, 'notif_hr_ago', { n: hr });
    return t(l, 'notif_day_ago', { n: Math.floor(hr / 24) });
  }

  // audit PR-44: this comment used to sit over `safeUrl()`, which only requires `^https?://` —
  // so it rejected `javascript:` and accepted EVERY cross-origin https URL. The comment described
  // the intent and the code did something else. Now it actually does what it says.
  function target(url: string): string {
    return sameOriginPath(url, typeof location !== 'undefined' ? location.origin : 'https://localhost');
  }
</script>

<!-- Back to Menu — first thing in the view, as requested -->
<div class="flex items-center justify-between gap-2 px-3 pb-1.5">
  <button
    type="button"
    onclick={onback}
    class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-bold transition hover:bg-black/5 dark:hover:bg-white/10"
    style="color: rgb(var(--accent));"
  >
    <ArrowLeft class="h-4 w-4" aria-hidden="true" />
    {$tr('notif_back')}
  </button>

  {#if $inbox.length > 0}
    <div class="flex items-center gap-1">
      {#if $unreadCount > 0}
        <button
          type="button"
          onclick={() => void markAllRead()}
          aria-label={$tr('notif_mark_read')}
          title={$tr('notif_mark_read')}
          class="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <CheckCheck class="h-4 w-4" aria-hidden="true" />
        </button>
      {/if}
      <button
        type="button"
        onclick={() => void clearAll()}
        aria-label={$tr('notif_clear')}
        title={$tr('notif_clear')}
        class="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10"
      >
        <Trash2 class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  {/if}
</div>

<h2 class="flex items-center gap-2 px-5 pb-2 text-base font-black text-slate-900 dark:text-white">
  <BellRing class="h-4 w-4" style="color: rgb(var(--accent));" aria-hidden="true" />
  {$tr('notif_title')}
  {#if $unreadCount > 0}
    <span
      class="rounded-full px-2 py-0.5 text-[11px] font-black"
      style="background: rgb(var(--accent) / 0.16); color: rgb(var(--accent));"
    >
      {$unreadCount}
    </span>
  {/if}
</h2>

<!-- Scrollable list. max-h keeps the sheet the same height as the Menu view
     instead of growing off-screen once a few notifications pile up. -->
<div class="max-h-[46vh] overflow-y-auto px-2 pb-1">
  {#if $inbox.length === 0}
    <div class="px-3 py-6 text-center">
      <span
        class="mx-auto grid h-12 w-12 place-items-center rounded-2xl"
        style="background: rgb(var(--accent) / 0.14); color: rgb(var(--accent));"
      >
        <Bell class="h-6 w-6" aria-hidden="true" />
      </span>
      <p class="mt-3 text-sm font-black text-slate-900 dark:text-white">{$tr('notif_empty_h')}</p>
      <p class="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{$tr('notif_empty_p')}</p>
    </div>
  {:else}
    {#each $inbox as n (n.id)}
      <a
        href={target(n.url)}
        onclick={onclose}
        class="flex gap-3 rounded-xl px-3 py-3 transition hover:bg-black/[0.05] dark:hover:bg-white/5"
      >
        <span
          class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style="background: rgb(var(--accent) / 0.16); color: rgb(var(--accent));"
        >
          <Bell class="h-4 w-4" aria-hidden="true" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex items-baseline gap-2">
            <span class="min-w-0 flex-1 truncate text-sm font-bold text-slate-900 dark:text-white">{n.title}</span>
            <span class="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">{ago(n.receivedAt, $lang)}</span>
            {#if !n.read}
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                style="background: rgb(var(--accent));"
                aria-label="unread"
              ></span>
            {/if}
          </span>
          {#if n.body}
            <span class="mt-0.5 block text-xs leading-relaxed text-slate-600 dark:text-slate-300">{n.body}</span>
          {/if}
        </span>
      </a>
    {/each}
  {/if}
</div>

<!-- On/off toggle. Renders nothing when the browser or deployment cannot do
     push, so it never shows a dead control. -->
<div class="border-t border-black/10 px-5 pb-3 pt-3 dark:border-white/10">
  <NotifyButton />
</div>
