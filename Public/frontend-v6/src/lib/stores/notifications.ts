/**
 * Reactive view of the notification inbox (see $lib/notifications for the
 * IndexedDB layer and why the inbox is per-device).
 *
 * The unread badge on the Menu sheet's bell has to be correct on every page, so
 * the root layout calls `initInbox()` once on mount: it loads the rows and
 * starts listening for the `push-received` message the service worker posts
 * after it writes a new one. That keeps the badge live while the app is open,
 * without any polling.
 */
import { writable, derived } from 'svelte/store';
import { listInbox, markInboxRead, clearInbox, type InboxItem } from '$lib/notifications';

const items = writable<InboxItem[]>([]);

/** Inbox rows, newest first. */
export const inbox = { subscribe: items.subscribe };

/** Number of unread rows — drives the bell badge. */
export const unreadCount = derived(items, (rows) => rows.reduce((n, r) => n + (r.read ? 0 : 1), 0));

export async function refreshInbox(): Promise<void> {
  items.set(await listInbox());
}

export async function markAllRead(): Promise<void> {
  await markInboxRead();
  await refreshInbox();
}

export async function clearAll(): Promise<void> {
  await clearInbox();
  await refreshInbox();
}

/**
 * Load the inbox and keep it in sync with pushes that arrive while the app is
 * open. Returns a teardown function.
 */
export function initInbox(): () => void {
  void refreshInbox();

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};

  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (data && data.type === 'push-received') void refreshInbox();
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}
