/**
 * Keeping the portal's data fresh in the background.
 *
 * Three mechanisms, deliberately layered from "works everywhere" to
 * "best-effort on one engine":
 *
 *  1. RECONNECT REFRESH (all browsers). The portal is read-only, so there is no
 *     queue of offline user actions to replay — what actually matters is that
 *     stale data is refreshed the moment connectivity returns. A plain `online`
 *     listener does that in every browser, including Safari/iOS and Firefox,
 *     which is why it is the primary mechanism rather than Background Sync.
 *     A `visibilitychange` refresh covers the common "phone was asleep in a
 *     pocket, user reopens the tab" case, which `online` alone misses.
 *
 *  2. BACKGROUND SYNC (Chromium only). Registered opportunistically so the
 *     service worker also gets a wake-up when connectivity returns, even if no
 *     tab is in the foreground. Not supported by Safari/iOS or Firefox.
 *
 *  3. PERIODIC SYNC (Chromium only, best-effort). Requires an INSTALLED PWA,
 *     a granted `periodic-background-sync` permission and site engagement; the
 *     browser decides the real cadence (in practice around 12 hours, NOT the
 *     interval we ask for) and may never fire at all. It is therefore a bonus,
 *     never something the UI depends on.
 *
 * Everything here is guarded and silent: an unsupported or rejected API must
 * never surface an error to the visitor.
 */
import { refreshPortal } from '$lib/stores/portal';

/** Tag shared with static/push-sw.js. */
const SYNC_TAG = 'chhath-refresh';
const PERIODIC_TAG = 'chhath-periodic-refresh';
/** Ask for ~6h; the browser will clamp this upward (typically to ~12h). */
const PERIODIC_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Don't hammer the API if connectivity flaps or the tab is toggled quickly. */
const MIN_REFRESH_GAP_MS = 30_000;
let lastRefresh = 0;

function refreshIfDue(): void {
  const now = Date.now();
  if (now - lastRefresh < MIN_REFRESH_GAP_MS) return;
  lastRefresh = now;
  void refreshPortal().catch(() => {});
}

/**
 * Wire up the reconnect/foreground refresh. Returns a cleanup function so the
 * caller (the root layout) can detach on unmount.
 */
export function startSync(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onOnline = () => refreshIfDue();
  const onVisible = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) refreshIfDue();
  };

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  // Register the service-worker-side sync mechanisms. Both are optional.
  void registerBackgroundSync();
  void registerPeriodicSync();

  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/**
 * Background Sync — one-shot wake-up when connectivity returns. Chromium only;
 * resolves quietly on every other engine.
 */
export async function registerBackgroundSync(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    if (!reg.sync) return false; // Safari/iOS, Firefox
    await reg.sync.register(SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

/**
 * Periodic Background Sync — best-effort. Needs an installed PWA plus the
 * `periodic-background-sync` permission; we only ask when it has ALREADY been
 * granted, so this never triggers a permission prompt.
 */
export async function registerPeriodicSync(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;

    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      periodicSync?: {
        register: (tag: string, opts: { minInterval: number }) => Promise<void>;
        getTags?: () => Promise<string[]>;
      };
    };
    if (!reg.periodicSync) return false; // not Chromium, or not installed

    // Only proceed on an already-granted permission — never prompt for this.
    const perms = navigator.permissions as
      | { query?: (d: { name: string }) => Promise<{ state: string }> }
      | undefined;
    if (perms && typeof perms.query === 'function') {
      try {
        const status = await perms.query({ name: 'periodic-background-sync' as PermissionName });
        if (status.state !== 'granted') return false;
      } catch {
        // Permission name unknown to this browser — treat as unsupported.
        return false;
      }
    }

    // Don't re-register an existing tag.
    if (typeof reg.periodicSync.getTags === 'function') {
      const tags = await reg.periodicSync.getTags();
      if (tags && tags.includes(PERIODIC_TAG)) return true;
    }

    await reg.periodicSync.register(PERIODIC_TAG, { minInterval: PERIODIC_MIN_INTERVAL_MS });
    return true;
  } catch {
    // Chromium rejects this when the app is not installed / lacks engagement.
    return false;
  }
}
