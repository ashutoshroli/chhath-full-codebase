import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import App from './App.jsx';
import ConsentPage from './views/ConsentPage.jsx';
import AnnouncePage from './views/AnnouncePage.jsx';
import { api } from './api.js';
import '../styles.css';

// Catches pure frontend JS errors (not just failed API calls, which api.js's
// call() already logs) — e.g. a render crash or a bug with no backend involved.
window.addEventListener('error', (e) => {
  api.logError('frontend', window.location.pathname, e.message, e.error && e.error.stack).catch(() => {});
});
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  api.logError('frontend', window.location.pathname, (err && err.message) || String(err), err && err.stack).catch(() => {});
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
      <Routes>
        {/* Public — no login. Opened via WhatsApp consent links. */}
        <Route path="/consent/:token" element={<ConsentPage />} />
        {/* Public — no login. Standalone full-screen view, PIN-gated. */}
        <Route path="/announce/:token" element={<AnnouncePage />} />
        {/* Everything else is the normal authenticated portal. */}
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
