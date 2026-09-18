// ============ PR-42 — per-route canonical, metadata, structured data, sitemap ============
//
// Four defects, all provable from the source:
//
//  1. `+layout.svelte` emitted `<link rel="canonical" href={config.siteUrl} />` on EVERY page.
//     A canonical pointing at `/` from `/expenses` tells a crawler that /expenses is a duplicate
//     of the home page, so it is dropped from the index and the home page shown instead. Every
//     inner page of the portal was, in effect, asking not to be found — eleven of the twelve.
//
//  2. Open Graph was hard-coded in app.html, so every share of any page previewed as the home
//     page, and there was no `og:url` at all.
//
//  3. `static/sitemap.xml` was hand-maintained and had drifted to 8 of the 12 routes: /decade,
//     /donate, /guide and /verify were absent. It is generated from `ROUTES` now, and the test
//     below compares that table with the routes actually on disk — which is the only way a
//     sitemap stays complete.
//
//  4. THE PRERENDERED HTML SHOWED A PORTAL WITH NO MONEY IN IT. Every component derives
//     `loading = status === 'loading'`, and the store started at `'idle'`, so the first paint —
//     and the prerendered HTML a crawler indexes — took the READY branch with empty data: ₹0
//     totals and "no records found", on a transparency portal.
//
// Plus: there was no `+error.svelte`, so an unknown path fell through to the SPA fallback and
// rendered the home page under the wrong URL.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  ROUTES, canonicalFor, metaFor, normalisePath, sitemapXml,
  organisationJsonLd, websiteJsonLd,
} from './seo';

const SRC = resolve(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const SITE = 'https://chhath.shaharpura.com';

// ------------------------------------------------ 1. THE TABLE MATCHES THE ROUTES

describe('PR-42: the metadata table covers the routes that exist', () => {
  /** Every routable page path under src/routes, in the '' | '/foo' form. */
  function pathsOnDisk(): string[] {
    const dir = join(SRC, 'routes');
    const out: string[] = [];
    if (existsSync(join(dir, '+page.svelte'))) out.push('');
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (existsSync(join(full, '+page.svelte'))) out.push(`/${entry}`);
    }
    return out.sort();
  }

  it('finds the routes at all (guards against a vacuous pass)', () => {
    expect(pathsOnDisk().length).toBeGreaterThanOrEqual(12);
  });

  it('no route on disk is missing from the table', () => {
    const missing = pathsOnDisk().filter((p) => !ROUTES.some((r) => r.path === p));
    // This is the assertion that would have caught the drifted sitemap: /decade, /donate,
    // /guide and /verify existed as pages and were in no sitemap and had no description.
    expect(missing, 'a page with no entry gets noindex and appears in no sitemap').toEqual([]);
  });

  it('no entry in the table points at a route that does not exist', () => {
    const onDisk = new Set(pathsOnDisk());
    const stale = ROUTES.map((r) => r.path).filter((p) => !onDisk.has(p));
    expect(stale, 'a sitemap that offers a 404 wastes the crawl budget').toEqual([]);
  });
});

// ------------------------------------------------------- 2. CANONICALS ARE PER PATH

describe('PR-42: the canonical names the page it is on', () => {
  it('each route gets its own canonical, not the site root', () => {
    for (const r of ROUTES) {
      const c = canonicalFor(SITE, r.path);
      if (r.path === '') {
        expect(c).toBe(`${SITE}/`);
      } else {
        expect(c).toBe(`${SITE}${r.path}`);
        // THE bug: every one of these used to be `${SITE}` regardless of the path.
        expect(c, `${r.path} must not canonicalise to the home page`).not.toBe(SITE);
        expect(c).not.toBe(`${SITE}/`);
      }
    }
  });

  it('canonicals are unique, so no two pages claim to be the same page', () => {
    const all = ROUTES.map((r) => canonicalFor(SITE, r.path));
    expect(new Set(all).size).toBe(all.length);
  });

  it('a trailing slash resolves to the same canonical, not a competing one', () => {
    // `trailingSlash: 'ignore'` means both forms are reachable; two different canonicals for
    // the same content would be a self-inflicted duplicate.
    expect(canonicalFor(SITE, '/expenses/')).toBe(canonicalFor(SITE, '/expenses'));
    expect(canonicalFor(SITE, '/')).toBe(canonicalFor(SITE, ''));
    expect(normalisePath('/decade/')).toBe('/decade');
  });

  it('a site URL with a trailing slash does not produce a doubled slash', () => {
    expect(canonicalFor(`${SITE}/`, '/loans')).toBe(`${SITE}/loans`);
  });

  it('the layout no longer emits a site-root canonical', () => {
    const layout = read('routes/+layout.svelte');
    expect(layout, 'this single line de-indexed eleven pages')
      .not.toMatch(/rel="canonical"\s+href=\{config\.siteUrl\}/);
    expect(layout, 'the per-route component must be rendered instead').toMatch(/<Seo \/>/);
  });

  it('the Seo component emits the tags that were missing entirely', () => {
    const seo = read('lib/components/Seo.svelte');
    for (const tag of ['rel="canonical"', 'og:url', 'og:title', 'og:description', 'twitter:title', 'name="description"']) {
      expect(seo, `${tag} is not emitted`).toContain(tag);
    }
  });

  it('the social image is the wide screenshot, not the square app icon', () => {
    const seo = read('lib/components/Seo.svelte');
    // og:image / twitter:image feed the share card; the 512-square icon fails the
    // >=1200x630 recommendation, so both point at the 1280x720 screenshot instead.
    expect(seo, 'og:image/twitter:image must use the wide screenshot').toMatch(/screenshots\/wide\.png/);
    expect(seo, 'the square app icon is no longer the social image')
      .not.toMatch(/(og:image|twitter:image)[\s\S]*icon-512\.png/);
    expect(existsSync(resolve(process.cwd(), 'static/screenshots/wide.png')),
      'the referenced screenshot must actually exist').toBe(true);
  });

  it('exactly one summary_large_image twitter:card exists across app.html + Seo.svelte', () => {
    const both = read('app.html') + read('lib/components/Seo.svelte');
    const cards = both.match(/name="twitter:card"/g) || [];
    expect(cards.length, 'a single twitter:card is the source of truth').toBe(1);
    expect(both, 'the card must be the large-image variant for the wide screenshot')
      .toMatch(/name="twitter:card"\s+content="summary_large_image"/);
  });

  it('the home social title is the fuller descriptive title, not the bare app_title', () => {
    const seo = read('lib/components/Seo.svelte');
    // og:title/twitter:title for the home route use social_title, a stronger share title
    // than the bare app_title 'Chhath Puja'.
    expect(seo, 'a dedicated social title must drive og:title/twitter:title').toMatch(/socialTitle/);
    expect(seo).toMatch(/social_title/);
  });

  it('app.html no longer hard-codes a competing og:title', () => {
    const html = read('app.html');
    expect(html, 'two og:title tags is worse than one wrong one').not.toMatch(/property="og:title"/);
    expect(html, 'og:type and og:site_name do not vary by route and stay here').toMatch(/property="og:site_name"/);
  });

  it('an unknown path is marked noindex rather than indexed as a copy of the home page', () => {
    expect(metaFor('/not-a-real-page')).toBeUndefined();
    expect(read('lib/components/Seo.svelte')).toMatch(/robots.*noindex/s);
  });
});

// --------------------------------------------------------------- 3. DESCRIPTIONS

describe('PR-42: every page describes itself', () => {
  it('each route has a description that fits a search result', () => {
    for (const r of ROUTES) {
      expect(r.description.length, `${r.path} description is empty`).toBeGreaterThan(40);
      // Google truncates around 155-160 characters; a sentence cut mid-word is worse than a
      // shorter one written to fit.
      expect(r.description.length, `${r.path} description is ${r.description.length} chars`).toBeLessThanOrEqual(165);
    }
  });

  it('no two pages share a description', () => {
    const all = ROUTES.map((r) => r.description);
    expect(new Set(all).size, 'duplicate descriptions read as duplicate pages').toBe(all.length);
  });
});

// ------------------------------------------------------------------- 4. SITEMAP

describe('PR-42: the sitemap is generated, so it cannot drift', () => {
  const xml = sitemapXml(SITE);

  it('lists every route exactly once', () => {
    for (const r of ROUTES) {
      const loc = `<loc>${canonicalFor(SITE, r.path)}</loc>`;
      expect(xml.split(loc).length - 1, `${r.path} appears more than once or not at all`).toBe(1);
    }
    expect((xml.match(/<url>/g) || []).length).toBe(ROUTES.length);
  });

  it('includes the four routes the hand-written file had lost', () => {
    for (const p of ['/decade', '/donate', '/guide', '/verify']) {
      expect(xml, `${p} was missing from static/sitemap.xml`).toContain(`<loc>${SITE}${p}</loc>`);
    }
  });

  it('the hand-maintained static file is gone, so there is one source', () => {
    expect(existsSync(resolve(process.cwd(), 'static/sitemap.xml')),
      'two sitemaps means the stale one wins at the host').toBe(false);
    expect(existsSync(join(SRC, 'routes/sitemap.xml/+server.ts'))).toBe(true);
  });

  it('is prerendered, so the site stays static', () => {
    expect(read('routes/sitemap.xml/+server.ts')).toMatch(/export const prerender = true/);
  });

  it('robots.txt still points at it', () => {
    expect(readFileSync(resolve(process.cwd(), 'static/robots.txt'), 'utf8'))
      .toContain(`${SITE}/sitemap.xml`);
  });
});

// -------------------------------------------------------------- 5. STRUCTURED DATA

describe('PR-42: structured data is valid and honest', () => {
  it('the organisation node parses and identifies the committee', () => {
    const o = JSON.parse(organisationJsonLd(SITE));
    expect(o['@context']).toBe('https://schema.org');
    expect(o['@type']).toBe('NGO');
    expect(o.name).toBe('Navyuvak Chhath Puja Samiti');
    expect(o.url).toBe(`${SITE}/`);
    expect(o.logo).toBe(`${SITE}/icons/icon-512.png`);
  });

  it('the website node parses and declares both languages', () => {
    const w = JSON.parse(websiteJsonLd(SITE));
    expect(w['@type']).toBe('WebSite');
    expect(w.inLanguage).toEqual(['en', 'hi']);
  });

  it('it publishes no financial figures', () => {
    // Structured data that disagrees with the page is worse than none, and these figures change
    // daily. If someone adds them later, this fails and they have to argue for it.
    const both = (organisationJsonLd(SITE) + websiteJsonLd(SITE)).toLowerCase();
    for (const f of ['amount', 'price', 'totalcollected', 'monetary']) {
      expect(both, `${f} in JSON-LD would go stale within a day`).not.toContain(f);
    }
  });

  it('no doubled slash when the site URL carries one', () => {
    expect(JSON.parse(organisationJsonLd(`${SITE}/`)).url).toBe(`${SITE}/`);
  });
});

// --------------------------------------------- 6. THE ERROR PAGE AND THE ZERO STATE

describe('PR-42: an unknown URL is an error, and the shell is not empty', () => {
  it('there is a real error page, and it refuses to be indexed', () => {
    const err = read('routes/+error.svelte');
    expect(err).toMatch(/name="robots" content="noindex, nofollow"/);
    expect(err, 'it must distinguish 404 from a generic failure').toMatch(/status === 404/);
  });

  it('the prerendered shell reports loading, not zero', () => {
    const store = read('lib/stores/portal.ts');
    expect(store, "'idle' let every component take the ready branch with empty data")
      .toMatch(/status: 'loading',/);
    // Cross-check the reason rather than trusting the change: consumers really do test only for
    // 'loading', so any other initial value renders a zero state.
    const overview = read('lib/components/FinancialOverview.svelte');
    expect(overview).toMatch(/status === 'loading'/);
  });

  it('verifyVerdict still handles idle, because the union keeps it', () => {
    expect(read('lib/api/verifyVerdict.ts')).toMatch(/status === 'loading' \|\| status === 'idle'/);
  });
});

// --------------------------------------- 7. PWA / LIGHTHOUSE FIXES (social title, h1, CSP)

describe('PWA/Lighthouse: the social title key is translatable', () => {
  it('social_title exists in both the en and hi i18n blocks', () => {
    const i18n = read('lib/i18n.ts');
    // A new key must be present in both language blocks or a switch to hi drops it.
    const occurrences = i18n.match(/social_title\s*:/g) || [];
    expect(occurrences.length, 'social_title must be defined in both en and hi').toBe(2);
  });
});

describe('PWA/Lighthouse: every skin home route has exactly one h1', () => {
  const skins = ['aurora', 'classic', 'festival', 'premium', 'slate'];

  it('the default (premium) home route has exactly one h1 (was zero in the audit)', () => {
    const home = read('lib/skins/premium/pages/Home.svelte');
    expect((home.match(/<h1/g) || []).length,
      'premium home rendered no h1 — h1Count:0 in the live audit').toBe(1);
  });

  it('each of the five skins home route has exactly one h1 (no zero, no duplicate)', () => {
    for (const skin of skins) {
      const home = read(`lib/skins/${skin}/pages/Home.svelte`);
      expect((home.match(/<h1/g) || []).length, `${skin} home must have exactly one h1`).toBe(1);
    }
  });
});

describe('PWA/Lighthouse: the CSP allows Cloudflare Web Analytics', () => {
  const vercel = readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8');
  const csp: string = (() => {
    const json = JSON.parse(vercel);
    for (const block of json.headers) {
      const h = (block.headers || []).find((x: { key: string }) => x.key === 'Content-Security-Policy');
      if (h) return h.value as string;
    }
    return '';
  })();

  it('script-src allows the Cloudflare Insights beacon script', () => {
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) || '';
    expect(scriptSrc, 'the beacon script host must be in script-src')
      .toContain('https://static.cloudflareinsights.com');
  });

  it('connect-src allows the Cloudflare Insights beacon endpoint', () => {
    const connectSrc = csp.split(';').find((d) => d.trim().startsWith('connect-src')) || '';
    expect(connectSrc, 'the beacon endpoint must be in connect-src')
      .toContain('https://cloudflareinsights.com');
  });

  it('the hardening directives are still intact and the CSP is one string', () => {
    expect(typeof csp).toBe('string');
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/object-src 'none'/);
    // No non-schema keys crept into vercel.json (a 'comment' key previously broke the schema).
    expect(JSON.parse(vercel)).not.toHaveProperty('comment');
  });
});
