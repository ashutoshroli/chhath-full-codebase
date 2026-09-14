/**
 * PWA install state, shared by every InstallButton instance.
 *
 * WHY THIS EXISTS (it is a timing fix, not a refactor for its own sake):
 * `beforeinstallprompt` is fired by the browser ONCE, shortly after page load,
 * and the event object is not replayed for listeners that attach later. The
 * listener used to live inside InstallButton's own onMount, which was fine while
 * the only button sat on the /guide page (mounted with the page). But the button
 * is now also rendered inside the "More" bottom sheet, and that sheet is behind
 * `{#if open}` — it mounts only when the visitor taps More, long after the event
 * has already fired. That instance would therefore never hold a prompt and would
 * fall back to the manual hint, i.e. the native install prompt would silently
 * stop working exactly where it matters most (mobile).
 *
 * Registering the listeners HERE, at module evaluation, fixes that: the module
 * is pulled in at app bootstrap (the skins' nav imports InstallButton), so the
 * event is captured early and any button — mounted now or later — reads the same
 * captured prompt. It also keeps the buttons in sync: install from one and the
 * other immediately shows "App installed".
 *
 * Guarded by `browser` so SSR / prerender never touch window.
 */
import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** The captured prompt, or null when the browser has not offered one. */
const deferred = writable<BeforeInstallPromptEvent | null>(null);

const installedState = writable(false);

/** True once the app is running standalone, or after `appinstalled` fires. */
export const installed = { subscribe: installedState.subscribe };

/** True while a real native install prompt is available to open. */
export const canPrompt = derived(deferred, (d) => d !== null);

if (browser) {
  // Already running as an installed app? Then never offer install.
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) installedState.set(true);

  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the browser's own mini-infobar away; we drive the prompt from the button.
    e.preventDefault();
    deferred.set(e as BeforeInstallPromptEvent);
  });

  window.addEventListener('appinstalled', () => {
    installedState.set(true);
    deferred.set(null);
  });
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/**
 * Open the native install prompt. Returns 'unavailable' when the browser never
 * offered one (iOS Safari, Firefox, or a prompt already used), so the caller can
 * show the manual per-platform hint instead.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const ev = get(deferred);
  if (!ev) return 'unavailable';
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'dismissed';
  } finally {
    // A used prompt cannot be re-shown for this page load.
    deferred.set(null);
  }
}
