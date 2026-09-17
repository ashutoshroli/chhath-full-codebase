import React from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import App from './App.jsx';
import ConsentPage from './views/ConsentPage.jsx';
import AnnouncePage from './views/AnnouncePage.jsx';

// Pushes a GTM pageview whenever the location changes. Extracted from main.jsx so the
// routing behaviour it depends on (useLocation giving pathname + search) can be tested
// without booting ReactDOM.createRoot. Behaviour is unchanged from the inline version.
export function GtmRouteTracker() {
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

// The app's route table, extracted from main.jsx so it can be mounted under a test
// router (MemoryRouter) and asserted directly. The element components are injected with
// defaults so a test can mount the real wiring — the paths, the `:token` param binding
// and the `*` catch-all — with light probe components, instead of the heavy real views.
// The routes themselves are the thing under test and stay identical to production.
export default function AppRoutes({
  consent: Consent = ConsentPage,
  announce: Announce = AnnouncePage,
  fallback: Fallback = App,
} = {}) {
  return (
    <Routes>
      <Route path="/consent/:token" element={<Consent />} />
      <Route path="/announce/:token" element={<Announce />} />
      <Route path="*" element={<Fallback />} />
    </Routes>
  );
}
