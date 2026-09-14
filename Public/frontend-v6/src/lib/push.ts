/**
 * Push notification opt-in (public portal).
 *
 * Strictly opt-in: nothing here runs on page load and the browser permission
 * prompt is only ever raised from an explicit user click (the button on the
 * guide page). If the deployment has no VAPID key configured, or the browser
 * lacks push support, the UI hides itself instead of failing.
 *
 * The subscription is POSTed to the PUBLIC worker (?action=savePushSubscription),
 * which upserts it. Sending happens later from the mgmt worker.
 */
import { config, apiUrl } from '$lib/config';

export type PushState =
  | 'unsupported' // no SW/Push API, or no VAPID key configured
  | 'denied' // user blocked notifications in the browser
  | 'subscribed'
  | 'default'; // supported, not subscribed yet

/**
 * base64url (VAPID public key) -> ArrayBuffer, as applicationServerKey needs.
 * Returns the ArrayBuffer rather than the view: under newer TS lib types a
 * `Uint8Array<ArrayBufferLike>` is not assignable to `BufferSource`.
 */
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

/** True when this browser + deployment can do push at all. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    !!config.vapidKey
  );
}

/** Current state, without prompting for anything. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return 'subscribed';
  } catch {
    /* fall through */
  }
  return Notification.permission === 'granted' ? 'default' : 'default';
}

/** Persist a subscription with the public worker. Returns true on success. */
export async function saveSubscription(sub: PushSubscription): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('savePushSubscription'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
    return !!(data && data.success);
  } catch {
    return false;
  }
}

/**
 * Ask for permission (must be called from a click) and subscribe.
 * Returns the resulting state so the caller can render it.
 */
export async function subscribe(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'default';

  try {
    const reg = await navigator.serviceWorker.ready;
    // Reuse an existing subscription when there is one; re-saving is harmless
    // because the worker upserts on the endpoint.
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(config.vapidKey)
      }));
    const saved = await saveSubscription(sub);
    return saved ? 'subscribed' : 'default';
  } catch {
    return 'default';
  }
}

/** Turn notifications off on this device (also drops the browser subscription). */
export async function unsubscribe(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();
  } catch {
    /* best effort — the row is pruned server-side on the next 404/410 */
  }
  return 'default';
}

/**
 * The service worker asks open pages to persist a rotated subscription
 * (`pushsubscriptionchange`). Wiring this up is optional but keeps endpoints
 * alive across browser key rotation.
 */
export function listenForSubscriptionChange(): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; subscription?: unknown } | null;
    if (!data || data.type !== 'push-subscription-changed' || !data.subscription) return;
    void fetch(apiUrl('savePushSubscription'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: data.subscription })
    }).catch(() => {});
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}
