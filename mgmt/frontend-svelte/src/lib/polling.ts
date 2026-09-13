// Svelte equivalent of the React usePolling hook. Call inside $effect and return
// its result so the poller is cleaned up on teardown:
//   $effect(() => startPolling(() => load(), 10000));
import { browser } from '$app/environment';
import { createVisibilityPoller } from './visibilityPoller';

export function startPolling(fn: () => void, intervalMs: number): () => void {
  if (!browser) return () => {};
  return createVisibilityPoller(fn, intervalMs, document);
}
