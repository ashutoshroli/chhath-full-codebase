import { useEffect, useRef } from 'react';

// ============ VISIBILITY-AWARE POLLING (audit P-8) ============
//
// Four screens poll the API on a timer: QueueStatus (10s), QueueMonitor (10s),
// WhatsApp (12s) and AnnouncePage (15s). None of them stopped when the tab was
// hidden, so a forgotten background tab kept issuing requests indefinitely — every
// one a Worker request against the free tier's 100,000/day, each running D1 queries
// behind it.
//
// During the festival several committee members will have the portal open on a phone
// all day, and the announce operator's device is open for hours. One tab left in the
// background overnight is ~8,600 wasted requests; a few devices across four screens
// is a meaningful slice of the daily budget spent on data nobody is looking at.
//
// The behaviour is deliberately split into a plain, framework-free function
// (createVisibilityPoller) and a thin React wrapper. The interesting logic — skip a
// tick while hidden, refresh once on becoming visible, clean up — is then directly
// unit-testable with a fake document and fake timers, instead of being trapped inside
// a hook that needs a DOM and a renderer to exercise.

/**
 * Starts an interval that only fires while the document is visible, and performs one
 * immediate catch-up run whenever the document becomes visible again (so the operator
 * never returns to stale data — which is what makes a naive "just stop the timer"
 * version unpleasant to use).
 *
 * @param run        the poll function. Never allowed to throw out of here.
 * @param intervalMs poll period. 0 / falsy disables polling entirely.
 * @param doc        injectable document, for tests.
 * @param timers     injectable { setInterval, clearInterval }, for tests.
 * @returns a stop() function that clears the timer and removes the listener.
 */
export function createVisibilityPoller(run, intervalMs, doc, timers) {
  const d = doc;
  const setI = (timers && timers.setInterval) || setInterval;
  const clearI = (timers && timers.clearInterval) || clearInterval;

  // With no document (SSR/tests) treat the page as visible so behaviour degrades to
  // a plain interval rather than silently never polling.
  const isVisible = () => !d || d.visibilityState === 'visible';
  const safeRun = () => { try { run(); } catch (e) { /* a poll must never throw */ } };

  safeRun(); // initial load

  if (!intervalMs) return () => {};

  const id = setI(() => { if (isVisible()) safeRun(); }, intervalMs);

  const onVisibility = () => { if (isVisible()) safeRun(); };
  if (d && d.addEventListener) d.addEventListener('visibilitychange', onVisibility);

  return () => {
    clearI(id);
    if (d && d.removeEventListener) d.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * React wrapper. `fn` is held in a ref so a caller can pass an inline arrow without
 * restarting the interval on every render.
 */
export function usePolling(fn, intervalMs, deps = []) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    return createVisibilityPoller(
      () => fnRef.current(),
      intervalMs,
      typeof document === 'undefined' ? null : document
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
