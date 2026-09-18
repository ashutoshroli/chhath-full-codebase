// FEAT-003: frontend defense-in-depth cache-busting for the PDF Export links.
//
// The launch bug: the English Annual Report opened blank because a stale CDN copy of a
// fixed PDF URL was being served. FEAT-002 gave each regeneration a distinct backend URL
// + short Cache-Control. This view adds one more layer: every PDF link it renders (the
// freshly-generated download and each "Already Generated" anchor) carries a ?v=<token>
// cache-buster, so an in-app click can never reuse a previously cached response for that
// exact URL. These tests pin that behaviour on the pure helper AND on the rendered anchor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// PdfExport imports api.js. Mock it so the component renders without a real backend and so
// we control the "Already Generated" list. api.js has no heavy static deps, but mocking
// keeps the test focused on the anchor href.
vi.mock('../api.js', () => ({
  api: {
    getYears: () => Promise.resolve([2026]),
    getGeneratedFilesForYear: (year, docType) => {
      if (docType === 'report_en') {
        return Promise.resolve([
          {
            id: 'report_en-2026',
            doc_type: 'report_en',
            file_name: 'Chhath-Puja-Report-2026.docx',
            public_link: 'https://cdn.example.com/2026/pdf/report_en/Chhath-Puja-Report-2026.pdf',
            generated_at: '2026-01-02T03:04:05.000Z',
          },
        ]);
      }
      return Promise.resolve([]);
    },
  },
  reportClientError: () => {},
}));

import { render, screen, cleanup, waitFor } from '@testing-library/react';
import PdfExport, { withCacheBuster } from './PdfExport.jsx';

describe('withCacheBuster', () => {
  it('appends ?v= to a plain url', () => {
    expect(withCacheBuster('https://cdn.example.com/a.pdf', '123')).toBe(
      'https://cdn.example.com/a.pdf?v=123'
    );
  });

  it('uses & when the url already has a query string', () => {
    expect(withCacheBuster('https://cdn.example.com/a.pdf?x=1', '123')).toBe(
      'https://cdn.example.com/a.pdf?x=1&v=123'
    );
  });

  it('encodes the token so it stays a single well-formed query value', () => {
    expect(withCacheBuster('https://cdn.example.com/a.pdf', '2026-01-02T03:04:05.000Z')).toBe(
      'https://cdn.example.com/a.pdf?v=2026-01-02T03%3A04%3A05.000Z'
    );
    // A token that itself looks like a query is escaped, not injected.
    expect(withCacheBuster('https://cdn.example.com/a.pdf', 'a&b=c')).toBe(
      'https://cdn.example.com/a.pdf?v=a%26b%3Dc'
    );
  });

  it('is a no-op when the token is missing', () => {
    const url = 'https://cdn.example.com/a.pdf';
    expect(withCacheBuster(url, undefined)).toBe(url);
    expect(withCacheBuster(url, null)).toBe(url);
    expect(withCacheBuster(url, '')).toBe(url);
  });

  it('is a no-op / safe for an empty or null url', () => {
    expect(withCacheBuster('', '123')).toBe('');
    expect(withCacheBuster(null, '123')).toBe(null);
    expect(withCacheBuster(undefined, '123')).toBe(undefined);
  });

  it('accepts a numeric token (e.g. Date.now()) and encodes it', () => {
    expect(withCacheBuster('https://cdn.example.com/a.pdf', 1735790645000)).toBe(
      'https://cdn.example.com/a.pdf?v=1735790645000'
    );
  });
});

describe('the "Already Generated" anchor href', () => {
  afterEach(() => cleanup());

  it('carries a ?v=<generated_at> cache-buster on the rendered link', async () => {
    render(<PdfExport />);
    const link = await waitFor(() =>
      screen.getByText(/Chhath-Puja-Report-2026\.docx/).closest('a')
    );
    expect(link).not.toBeNull();
    // Derived from generated_at, URL-encoded, appended with ? since the link has no query.
    expect(link.getAttribute('href')).toBe(
      'https://cdn.example.com/2026/pdf/report_en/Chhath-Puja-Report-2026.pdf?v=2026-01-02T03%3A04%3A05.000Z'
    );
  });
});
