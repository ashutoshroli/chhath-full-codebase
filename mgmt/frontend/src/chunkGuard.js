// ============ STALE-BUNDLE (CHUNK LOAD) RECOVERY ============
//
// Vite emits content-hashed chunk filenames, so every deploy renames them. Any tab
// that was open across a deploy still holds the OLD index bundle, and the moment it
// lazy-loads a route it requests a filename that no longer exists:
//
//   Failed to fetch dynamically imported module:
//     https://mgmt-chhath.shaharpura.com/assets/DocxTemplates-BJ_KR5NY.js
//
// The production Error Log had 8+ of these across weeks (ReceiptModal-*,
// DownloadCenter-*, DocxTemplates-*) — one of them minutes after a deploy. It is
// not a code defect, it is an unavoidable consequence of hashed filenames, and the
// only real fix is to reload the page so the browser fetches the new index.
//
// Two things were missing before:
//   1. Nothing reloaded automatically — the user just saw a dead screen (or, after
//      the ErrorBoundary was added, a Refresh button they had to notice and tap).
//   2. The ErrorBoundary only sees errors thrown during RENDER. Several places do a
//      manual `await import(...)` inside an event handler (Home's autoGeneratePdf,
//      ConsentPage's PDF download) — those reject as ordinary promises and bypass
//      the boundary entirely.

const RELOAD_FLAG = 'cpm_chunk_reloaded_at';
// Don't retry more than once per minute — if the new bundle is genuinely missing
// (bad deploy), reloading in a loop would make it worse.
const RELOAD_COOLDOWN_MS = 60000;

const CHUNK_ERROR_RE = /Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically/i;

export function isChunkLoadError(err) {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : (err.message || '');
  return CHUNK_ERROR_RE.test(msg);
}

/**
 * Reloads the page once when a stale-bundle error is detected.
 * @returns true if a reload was triggered (caller should stop doing work).
 */
export function reloadOnceForChunkError(err) {
  if (!isChunkLoadError(err)) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false; // already tried
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch (e) {
    // sessionStorage blocked (Safari private mode) — fall through and reload once.
  }
  // location.reload() alone can be served the cached HTML that still references
  // the old chunk names, so bust it with a query param.
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_v', String(Date.now()).slice(-6));
    window.location.replace(url.toString());
  } catch (e) {
    window.location.reload();
  }
  return true;
}

/**
 * Wraps a manual `import()` so a stale-bundle failure self-heals instead of
 * surfacing as a mystery TypeError.
 *
 *   const { fillDocxTemplateFromRow } = await safeImport(() => import('../docxFill.js'), 'docxFill');
 */
export async function safeImport(importFn, label) {
  try {
    return await importFn();
  } catch (err) {
    if (reloadOnceForChunkError(err)) {
      // The page is navigating away; block this promise so the caller's `finally`
      // doesn't flash a spurious error in the moment before the reload.
      await new Promise(() => {});
    }
    throw new Error(
      `${label || 'Module'} failed to load${err && err.message ? ': ' + err.message : ''}. ` +
      'Please refresh the page and try again.'
    );
  }
}
