// Ported verbatim from mgmt/frontend/src/visibilityPoller.js — runs immediately,
// then on an interval but only while the document is visible; returns a cleanup.
type Timers = { setInterval?: typeof setInterval; clearInterval?: typeof clearInterval };

export function createVisibilityPoller(
  run: () => void,
  intervalMs: number,
  doc: Document | null,
  timers?: Timers
): () => void {
  const d = doc;
  const setI = (timers && timers.setInterval) || setInterval;
  const clearI = (timers && timers.clearInterval) || clearInterval;

  const isVisible = () => !d || d.visibilityState === 'visible';
  const safeRun = () => {
    try {
      run();
    } catch {
      /* ignore */
    }
  };

  safeRun();

  if (!intervalMs) return () => {};

  const id = setI(() => {
    if (isVisible()) safeRun();
  }, intervalMs);

  const onVisibility = () => {
    if (isVisible()) safeRun();
  };
  if (d && d.addEventListener) d.addEventListener('visibilitychange', onVisibility);

  return () => {
    clearI(id);
    if (d && d.removeEventListener) d.removeEventListener('visibilitychange', onVisibility);
  };
}
