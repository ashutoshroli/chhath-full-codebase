// @vitest-environment jsdom
// ============ FEAT-001 — pushPageView unit test ======================================
//
// The helper feeds GTM's dataLayer a `page_view` event on every SPA navigation. It must be
// SSR-safe: a no-op when window / window.dataLayer are absent (prerender, or before GTM has
// created dataLayer), and a single well-formed push when dataLayer exists.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pushPageView } from './pageview';

describe('pushPageView', () => {
  afterEach(() => {
    // jsdom provides window; clear any dataLayer we set so tests do not bleed.
    delete (window as { dataLayer?: unknown[] }).dataLayer;
  });

  it('pushes a page_view event with page_path and page_title when dataLayer exists', () => {
    const dl: unknown[] = [];
    (window as { dataLayer?: unknown[] }).dataLayer = dl;

    pushPageView('/expenses?year=2024', 'Expenses — Chhath Puja');

    expect(dl).toHaveLength(1);
    expect(dl[0]).toEqual({
      event: 'page_view',
      page_path: '/expenses?year=2024',
      page_title: 'Expenses — Chhath Puja',
    });
  });

  it('is a no-op (pushes nothing, throws nothing) when dataLayer is absent', () => {
    delete (window as { dataLayer?: unknown[] }).dataLayer;
    expect(() => pushPageView('/', 'Home')).not.toThrow();
    expect((window as { dataLayer?: unknown[] }).dataLayer).toBeUndefined();
  });

  it('is a no-op when dataLayer is not an array', () => {
    (window as unknown as { dataLayer: unknown }).dataLayer = { not: 'an array' };
    expect(() => pushPageView('/', 'Home')).not.toThrow();
    expect((window as unknown as { dataLayer: unknown }).dataLayer).toEqual({ not: 'an array' });
  });
});
