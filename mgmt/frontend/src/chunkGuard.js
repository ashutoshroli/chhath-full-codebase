
const RELOAD_FLAG = 'cpm_chunk_reloaded_at';
const RELOAD_COOLDOWN_MS = 60000;

const CHUNK_ERROR_RE = /Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically/i;

export function isChunkLoadError(err) {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : (err.message || '');
  return CHUNK_ERROR_RE.test(msg);
}

export function reloadOnceForChunkError(err) {
  if (!isChunkLoadError(err)) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch (e) {
  }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_v', String(Date.now()).slice(-6));
    window.location.replace(url.toString());
  } catch (e) {
    window.location.reload();
  }
  return true;
}

export async function safeImport(importFn, label) {
  try {
    return await importFn();
  } catch (err) {
    if (reloadOnceForChunkError(err)) {
      await new Promise(() => {});
    }
    throw new Error(
      `${label || 'Module'} failed to load${err && err.message ? ': ' + err.message : ''}. ` +
      'Please refresh the page and try again.'
    );
  }
}
