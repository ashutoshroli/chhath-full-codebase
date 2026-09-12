// SEO / social-link-preview metadata builder — framework-free and testable.
//
// WHY THIS EXISTS
// The old plain-static site kept a big block of <head> tags between SEO:START /
// SEO:END markers that build.mjs regenerated at build time. Those tags (title,
// description, keywords, canonical, robots, theme-color, geo signals, Open Graph,
// Twitter card, Organization JSON-LD) are what give the portal a complete link
// preview on WhatsApp/Facebook/X and a rich organisation result in search. Social
// crawlers read only the initial HTML and never run JS, so these MUST be in the
// server-rendered head.
//
// Here we reproduce that block for the Astro site as a PURE builder: given the
// resolved config (config.siteUrl) and optional per-page overrides, it returns a
// plain object of the resolved values + the Organization JSON-LD object. Layout
// (or Seo.astro) turns that into <meta>/<link>/<script> tags. Keeping the
// string-building here (not inline in .astro) means the porting-sensitive
// defaults and the canonical/JSON-LD derivation are node --check-able and
// unit-tested — see test/seo.test.mjs.
//
// FAIL-SAFE PHILOSOPHY (matches build.mjs): every field has a sensible hardcoded
// default ported from the old index.html, and config.siteUrl already falls back
// to the production origin, so a missing env var can NEVER produce empty tags or
// break the build — the site simply ships with the production defaults.

// The exact defaults ported from Public/frontend/index.html's SEO:START block.
// Kept as named constants so the fallbacks are documented and testable.
export const SEO_DEFAULTS = Object.freeze({
  title: 'Navyuvak Chhath Puja Samiti Shaharpura | Chhath Puja Transparency Portal',
  description:
    'Official transparency portal of Navyuvak Chhath Puja Samiti, Shaharpura & Gardih (Giridih, Jharkhand). View Chhath Puja collections, expenses, loans and committee details with full public transparency.',
  keywords:
    'Chhath Puja, छठ पूजा, Chhath, छठ, Navyuvak Chhath Puja Samiti, नवयुवक छठ पूजा समिति, Chhath Puja Samiti, छठ पूजा समिति, Chhath transparency portal, Chhath collection, Chhath chanda, छठ चंदा, Chhath committee, Chhath donation, Chhath expenses, Chhath hisab, छठ हिसाब, Shaharpura, Saharpura, Sahaarpura, Shahpura, Sahpura, शहरपुरा, Gardih, Gardi, गरडीह, गड़ीह, Siyatand, सियाटांड, Bengabad, बेंगाबाद, Jamua, जमुआ, Giridih, गिरिडीह, Jharkhand, झारखंड, India, भारत, 815312, Shaharpura Chhath, शहरपुरा छठ, Chhath Giridih, Chhath Jharkhand',
  // The theme-color the OLD SEO block shipped (#F97316). Layout historically used
  // #F27A1A; we reconcile to the old SEO value here to preserve parity.
  themeColor: '#F97316',
  robots: 'index, follow',
  // Social preview defaults (og/twitter) copied verbatim from the old block.
  ogSiteName: 'Navyuvak Chhath Puja Samiti Shaharpura',
  ogTitle: 'Navyuvak Chhath Puja Samiti Shaharpura',
  ogDescription:
    'Official transparency portal — Chhath Puja collections, expenses, loans and committee details for Shaharpura & Gardih, Giridih, Jharkhand.',
  twitterTitle: 'Navyuvak Chhath Puja Samiti Shaharpura',
  twitterDescription:
    'Official Chhath Puja transparency portal for Shaharpura & Gardih, Giridih, Jharkhand.',
  // Geo signals.
  geoRegion: 'IN-JH',
  geoPlacename: 'Shaharpura, Gardih, Giridih, Jharkhand',
  geoPosition: '24.18;86.30',
  icbm: '24.18, 86.30',
  // Preview image path (joined onto siteUrl at build time).
  previewImagePath: '/preview.jpg',
});

// Join a path onto an origin without producing a double slash. `siteUrl` may or
// may not carry a trailing slash; `path` is expected to start with '/'.
function joinUrl(siteUrl, path) {
  const base = (siteUrl || '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : '/' + path;
  return base + p;
}

// Build the resolved SEO tag values for a page.
//   config   { siteUrl }  — the resolved runtime config (siteUrl always defined).
//   props    optional per-page overrides:
//              { title, description, pathname }
// Anything omitted falls back to SEO_DEFAULTS. The canonical URL is derived from
// siteUrl + the page pathname ('/' when not given).
export function seoTags(config, props) {
  const cfg = config || {};
  const p = props || {};
  const siteUrl = cfg.siteUrl || '';
  const pathname = p.pathname || '/';

  const title = (p.title === undefined || p.title === null || String(p.title).trim() === '')
    ? SEO_DEFAULTS.title : String(p.title);
  const description = (p.description === undefined || p.description === null || String(p.description).trim() === '')
    ? SEO_DEFAULTS.description : String(p.description);

  const canonical = joinUrl(siteUrl, pathname === '/' ? '/' : pathname);
  const image = joinUrl(siteUrl, SEO_DEFAULTS.previewImagePath);

  return {
    title,
    description,
    keywords: SEO_DEFAULTS.keywords,
    canonical,
    robots: SEO_DEFAULTS.robots,
    themeColor: SEO_DEFAULTS.themeColor,
    geoRegion: SEO_DEFAULTS.geoRegion,
    geoPlacename: SEO_DEFAULTS.geoPlacename,
    geoPosition: SEO_DEFAULTS.geoPosition,
    icbm: SEO_DEFAULTS.icbm,
    // Open Graph. og:title/description use the OLD block's fixed values for a
    // consistent social preview across pages; og:url is the page canonical.
    ogType: 'website',
    ogSiteName: SEO_DEFAULTS.ogSiteName,
    ogTitle: SEO_DEFAULTS.ogTitle,
    ogDescription: SEO_DEFAULTS.ogDescription,
    ogUrl: canonical,
    ogImage: image,
    ogImageWidth: '1200',
    ogImageHeight: '630',
    ogLocale: 'en_IN',
    ogLocaleAlternate: 'hi_IN',
    // Twitter card.
    twitterCard: 'summary_large_image',
    twitterTitle: SEO_DEFAULTS.twitterTitle,
    twitterDescription: SEO_DEFAULTS.twitterDescription,
    twitterImage: image,
  };
}

// Build the Organization JSON-LD object, ported field-for-field from the old
// index.html. Emitting a plain object (rather than a pre-serialised string) lets
// the caller JSON.stringify it once via Astro's set:html, so per-page values can
// never break the JSON syntax.
export function organizationJsonLd(config) {
  const cfg = config || {};
  const siteUrl = cfg.siteUrl || '';
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Navyuvak Chhath Puja Samiti Shaharpura',
    alternateName: 'नवयुवक छठ पूजा समिति शहरपुरा',
    url: joinUrl(siteUrl, '/'),
    logo: joinUrl(siteUrl, SEO_DEFAULTS.previewImagePath),
    description:
      'Official transparency portal of Navyuvak Chhath Puja Samiti — Chhath Puja collections, expenses, loans and committee details for Shaharpura & Gardih.',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Shaharpura, Gardih, Post Siyatand, Via Bengabad',
      addressLocality: 'Jamua',
      addressRegion: 'Jharkhand',
      postalCode: '815312',
      addressCountry: 'IN',
    },
  };
}
