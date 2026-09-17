// The sitemap, generated from src/lib/seo.ts at build time (audit PR-42).
//
// `static/sitemap.xml` was hand-maintained and had drifted to 8 of the 12 public routes:
// /decade, /donate, /guide and /verify were absent, so four pages of the portal were never
// offered to a crawler at all. A hand-written sitemap sitting next to a routes directory always
// drifts eventually; generating it from the same table the canonical tags come from means the two
// cannot disagree, and a test asserts the table matches the routes on disk.
//
// Prerendered, so this stays a fully static site with no server at runtime.
import { config } from '$lib/config';
import { sitemapXml } from '$lib/seo';

export const prerender = true;

export function GET() {
  return new Response(sitemapXml(config.siteUrl), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // A sitemap is cheap and read rarely; an hour keeps a crawler from re-fetching it on
      // every URL it visits without pinning a stale copy for a day.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
