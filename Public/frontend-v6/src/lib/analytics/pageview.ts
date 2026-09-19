// SSR-safe Google Tag Manager page-view push.
//
// GA4 and Microsoft Clarity run as tags inside the single GTM container
// (GTM-N6BF7NP7). This app is a SvelteKit SPA, so after the first load the
// browser never issues a fresh document request on navigation — GTM's built-in
// History Change / initial page_view would miss every client-side route change.
// We push our own `page_view` event to the dataLayer so a GTM trigger can fire
// GA4/Clarity page views for SPA navigations.
//
// Guarded to the browser: `window` and `window.dataLayer` must both exist, so
// prerender/SSR (no window) and the pre-GTM window (no dataLayer yet) are no-ops.

interface DataLayerWindow {
  dataLayer?: unknown[];
}

/**
 * Push a `page_view` event to `window.dataLayer` for the given path + title.
 * No-op when running outside the browser or before GTM has created dataLayer.
 */
export function pushPageView(path: string, title: string): void {
  if (typeof window === 'undefined') return;
  const dl = (window as DataLayerWindow).dataLayer;
  if (!Array.isArray(dl)) return;
  dl.push({ event: 'page_view', page_path: path, page_title: title });
}
