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
import { Analytics } from '@vercel/analytics/react';
import '../styles.css';

window.addEventListener('error', (e) => {
  if (reloadOnceForChunkError(e.error || e.message)) return;
  if (isIgnorableClientError(e.message)) return;
  if ((e.filename || '').includes('/_vercel/insights/')) return;
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
  if (reloadOnceForChunkError(err)) return;
  const msg = (err && err.message) || String(err);
  if (isIgnorableClientError(msg)) return;
  reportClientError('window.unhandledrejection', msg, err, {});
});

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
      {
}
      <ErrorBoundary name="root">
        <Routes>
          {}
          <Route path="/consent/:token" element={<ConsentPage />} />
          {}
          <Route path="/announce/:token" element={<AnnouncePage />} />
          {}
          <Route path="*" element={<App />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
