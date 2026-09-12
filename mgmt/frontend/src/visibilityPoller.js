

export function createVisibilityPoller(run, intervalMs, doc, timers) {
  const d = doc;
  const setI = (timers && timers.setInterval) || setInterval;
  const clearI = (timers && timers.clearInterval) || clearInterval;

  const isVisible = () => !d || d.visibilityState === 'visible';
  const safeRun = () => { try { run(); } catch (e) {  } };

  safeRun();

  if (!intervalMs) return () => {};

  const id = setI(() => { if (isVisible()) safeRun(); }, intervalMs);

  const onVisibility = () => { if (isVisible()) safeRun(); };
  if (d && d.addEventListener) d.addEventListener('visibilitychange', onVisibility);

  return () => {
    clearI(id);
    if (d && d.removeEventListener) d.removeEventListener('visibilitychange', onVisibility);
  };
}
