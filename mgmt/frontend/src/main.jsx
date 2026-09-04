// MUST be first: patches Array.prototype.at before any dependency can call it.
import './polyfills.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import App from './App.jsx';
import ConsentPage from './views/ConsentPage.jsx';
import AnnouncePage from './views/AnnouncePage.jsx';
import { reportClientError, isIgnorableClientError } from './api.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { reloadOnceForChunkError } from './chunkGuard.js';
// Vercel Web Analytics — privacy-friendly, cookie-less visitor/pageview counts
// in the Vercel dashboard. Independent of the GTM/GA4 tracking below; because it
// uses a first-party path it is rarely blocked, so the counts are usually more
// complete. It tracks React Router route changes automatically.
import { Analytics } from '@vercel/analytics/react';
import '../styles.css';

// Catches pure frontend JS errors (not just failed API calls, which api.js's
// call() already logs) — e.g. a render crash or a bug with no backend involved.
//
// These use reportClientError() instead of api.logError() because api.logError()
// goes through call(), whose own failure path could recurse; reportClientError is
// a plain fire-and-forget POST that BUFFERS to sessionStorage when the network is
// down. Previously both handlers ended in `.catch(() => {})` — the very last line
// of defence swallowed its own failure.
window.addEventListener('error', (e) => {
  // A stale bundle after a deploy is not a defect — self-heal instead of logging.
  if (reloadOnceForChunkError(e.error || e.message)) return;
  if (isIgnorableClientError(e.message)) return;
  // Vercel Web Analytics (/_vercel/insights/script.js) 404s to an HTML page
  // until Analytics is enabled in the Vercel dashboard, which surfaces as
  // "Unexpected token '<'". It's a third-party, non-app script and must not
  // spam our error log — skip any error originating from that path.
  if ((e.filename || '').includes('/_vercel/insights/')) return;
  // A cross-origin bundle reports every error as a bare "Script error." with no
  // stack (the migrated data has five such useless rows). index.html now sets
  // crossorigin on the module script so real messages come through; if we still
  // get the opaque form, say so explicitly rather than logging a mystery.
  const isOpaque = e.message === 'Script error.' && !e.error;
  reportClientError(
    'window.onerror',
    isOpaque
      ? 'Opaque cross-origin script error (no stack available — check that the bundle is served with CORS + crossorigin on the script tag)'
      : e.message,
    e.error,
    { filename: e.filename || '', lineno: e.lineno || 0, colno: e.colno || 0 }
  );
});
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  // Manual `await import(...)` failures land here, not in the ErrorBoundary.
  if (reloadOnceForChunkError(err)) return;
  const msg = (err && err.message) || String(err);
  if (isIgnorableClientError(msg)) return;
  reportClientError('window.unhandledrejection', msg, err, {});
});

// GTM's default Pageview trigger only fires on a hard page load — this SPA
// never does one after the first load, so GA4/Clarity would otherwise only
// ever see a single pageview no matter how much the person navigates. This
// pushes a `pageview` event to dataLayer on every client-side route change;
// pair it with a GTM Trigger of type "History Change" (or a Custom Event
// trigger on `pageview`) feeding your GA4 Configuration/Event tags.
function GtmRouteTracker() {
  const location = useLocation();
  React.useEffect(() => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'pageview',
      page: location.pathname + location.search,
    });
  }, [location]);
  return null;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <GtmRouteTracker />
      <Analytics />
      {/* Top-level boundary: without one, a crash in ANY of these routes — including
          the two PUBLIC pages that ordinary members open from a WhatsApp link —
          left a blank white screen with no explanation and no recoverable state. */}
      <ErrorBoundary name="root">
        <Routes>
          {/* Public — no login. Opened via WhatsApp consent links. */}
          <Route path="/consent/:token" element={<ConsentPage />} />
          {/* Public — no login. Standalone full-screen view, PIN-gated. */}
          <Route path="/announce/:token" element={<AnnouncePage />} />
          {/* Everything else is the normal authenticated portal. */}
          <Route path="*" element={<App />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
