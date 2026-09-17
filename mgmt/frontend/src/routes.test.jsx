/**
 * Router behaviour for the live mgmt SPA — the app's FIRST tests (carry-over C2).
 *
 * These were written and proven GREEN on react-router-dom@6.30.6 BEFORE the upgrade to
 * 7.18.4, so they are the behavioural baseline the upgrade has to preserve. They assert
 * only what the router does — which path renders which route, that a `:token` segment
 * reaches the rendered component through `useParams`, that `*` catches everything else,
 * and that a location change pushes a GTM pageview — so they stay valid across the
 * v6 -> v7 boundary and do not couple to the heavy real view components.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useParams } from 'react-router-dom';
import AppRoutes, { GtmRouteTracker } from './routes.jsx';

// Light probes stand in for the real views. They exercise the router wiring (the path
// match and the `:token` param binding) without pulling in api.js, docxtemplater, jspdf,
// DOMPurify, etc. The route table under test is the production one from routes.jsx.
function ConsentProbe() {
  const { token } = useParams();
  return <div data-testid="consent">consent token={token}</div>;
}
function AnnounceProbe() {
  const { token } = useParams();
  return <div data-testid="announce">announce token={token}</div>;
}
function FallbackProbe() {
  return <div data-testid="fallback">app</div>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes consent={ConsentProbe} announce={AnnounceProbe} fallback={FallbackProbe} />
    </MemoryRouter>
  );
}

afterEach(() => cleanup());

describe('AppRoutes', () => {
  it('/consent/:token renders the consent route and the token resolves via useParams', () => {
    renderAt('/consent/abc123');
    expect(screen.getByTestId('consent').textContent).toBe('consent token=abc123');
    expect(screen.queryByTestId('announce')).toBeNull();
    expect(screen.queryByTestId('fallback')).toBeNull();
  });

  it('/announce/:token renders the announce route with its token', () => {
    renderAt('/announce/tok-999');
    expect(screen.getByTestId('announce').textContent).toBe('announce token=tok-999');
    expect(screen.queryByTestId('consent')).toBeNull();
    expect(screen.queryByTestId('fallback')).toBeNull();
  });

  it('an unmatched path renders the App fallback via the * route', () => {
    renderAt('/dashboard/anything?tab=loans');
    expect(screen.getByTestId('fallback')).not.toBeNull();
    expect(screen.queryByTestId('consent')).toBeNull();
    expect(screen.queryByTestId('announce')).toBeNull();
  });

  it('the root path also falls through to the App fallback', () => {
    renderAt('/');
    expect(screen.getByTestId('fallback')).not.toBeNull();
  });
});

describe('GtmRouteTracker', () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  it('pushes a pageview with page = pathname + search on navigation', () => {
    render(
      <MemoryRouter initialEntries={['/announce/xyz?year=2026']}>
        <GtmRouteTracker />
      </MemoryRouter>
    );
    expect(window.dataLayer).toContainEqual({
      event: 'pageview',
      page: '/announce/xyz?year=2026',
    });
  });

  it('uses pathname + search (not just pathname) for the pageview page', () => {
    render(
      <MemoryRouter initialEntries={['/consent/t1?a=1&b=2']}>
        <GtmRouteTracker />
      </MemoryRouter>
    );
    const last = window.dataLayer[window.dataLayer.length - 1];
    expect(last).toEqual({ event: 'pageview', page: '/consent/t1?a=1&b=2' });
  });
});
