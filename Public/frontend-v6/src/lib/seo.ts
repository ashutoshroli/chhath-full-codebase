// ============ ONE SOURCE OF TRUTH FOR ROUTE METADATA (audit PR-42) ============
//
// Three things went wrong because there was no such source:
//
//  1. `+layout.svelte` emitted `<link rel="canonical" href={config.siteUrl} />` on EVERY page.
//     A canonical pointing at `/` from `/expenses` tells Google that /expenses is a duplicate
//     of the home page — so it drops it from the index and shows the home page instead. Every
//     inner page of the portal was, in effect, asking not to be found.
//
//  2. The Open Graph tags in app.html are static, so every share of any page previewed as the
//     home page, and there was no `og:url` at all.
//
//  3. `static/sitemap.xml` was hand-maintained and had drifted: 8 of the 12 public routes.
//     /decade, /donate, /guide and /verify were simply absent. A hand-written sitemap next to a
//     routes directory always drifts, so the sitemap is GENERATED from this table now and a test
//     asserts the table covers the routes on disk.
//
// Descriptions are deliberately in English only, unlike the UI. Crawlers index one canonical
// per URL and the portal serves both languages from the same path, so a language-switched
// description would make the indexed text depend on whichever visitor was crawled. The `<title>`
// stays translated because that is what a human reads in a tab.

export interface RouteMeta {
  /** Path, no trailing slash. '' is the home page. */
  path: string;
  /** i18n key for the human title. The home page uses the site name itself. */
  titleKey: string;
  /** Indexable description, English, <= ~155 chars so it is not truncated mid-sentence. */
  description: string;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: string;
}

export const ROUTES: RouteMeta[] = [
  {
    path: '',
    titleKey: 'app_title',
    description:
      'Every contribution visible, every expense accountable. Live financial transparency for Navyuvak Chhath Puja Samiti, Shaharpura, Gardih.',
    changefreq: 'daily',
    priority: '1.0',
  },
  {
    path: '/contributors',
    titleKey: 'contributors_list',
    description:
      'The full list of contributors to Navyuvak Chhath Puja Samiti, with amounts and years, exactly as recorded in the committee ledger.',
    changefreq: 'daily',
    priority: '0.8',
  },
  {
    path: '/expenses',
    titleKey: 'expenses_ledger',
    description:
      'Every rupee spent by Navyuvak Chhath Puja Samiti, itemised by category and year, open for anyone in the village to check.',
    changefreq: 'weekly',
    priority: '0.7',
  },
  {
    path: '/loans',
    titleKey: 'loan_distribution',
    description:
      'Loans issued from the committee fund: amount, guarantors, status and repayment, published so lending stays accountable.',
    changefreq: 'weekly',
    priority: '0.7',
  },
  {
    path: '/committee',
    titleKey: 'active_committee',
    description:
      'The people responsible for Navyuvak Chhath Puja Samiti this year, with the role each of them holds.',
    changefreq: 'monthly',
    priority: '0.6',
  },
  {
    path: '/decade',
    titleKey: 'decade_title',
    description:
      'Ten years of Chhath Puja at Shaharpura: contributions, spending and participation, year by year.',
    changefreq: 'monthly',
    priority: '0.6',
  },
  {
    path: '/downloads',
    titleKey: 'download_center',
    description:
      'Download receipts, certificates and the committee’s published statements for any year.',
    changefreq: 'weekly',
    priority: '0.6',
  },
  {
    path: '/donate',
    titleKey: 'donate_title',
    description:
      'How to contribute to Navyuvak Chhath Puja Samiti — UPI, bank transfer, or in person with the committee.',
    changefreq: 'monthly',
    priority: '0.6',
  },
  {
    path: '/verify',
    titleKey: 'verify_title',
    description:
      'Check a receipt against the committee ledger and confirm the contribution was recorded.',
    changefreq: 'monthly',
    priority: '0.5',
  },
  {
    path: '/guide',
    titleKey: 'guide_title',
    description:
      'How to use the transparency portal: finding a contribution, reading the ledgers, and installing the app.',
    changefreq: 'monthly',
    priority: '0.4',
  },
  {
    path: '/privacy',
    titleKey: 'privacy_subtitle',
    description:
      'What this portal publishes, what it stores, what it does not collect, and how long anything is kept.',
    changefreq: 'yearly',
    priority: '0.3',
  },
  {
    path: '/terms',
    titleKey: 'terms_subtitle',
    description:
      'Terms for using the Navyuvak Chhath Puja Samiti transparency portal.',
    changefreq: 'yearly',
    priority: '0.3',
  },
];

/** Normalises a URL pathname to the form used as a key above. */
export function normalisePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '');
  return p === '' ? '' : p;
}

export function metaFor(pathname: string): RouteMeta | undefined {
  const key = normalisePath(pathname);
  return ROUTES.find((r) => r.path === key);
}

/** The absolute canonical URL for a path. Always the SAME shape, so it cannot self-conflict. */
export function canonicalFor(siteUrl: string, pathname: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  const key = normalisePath(pathname);
  return key === '' ? `${base}/` : `${base}${key}`;
}

/**
 * The sitemap, built from the table above.
 *
 * `lastmod` is deliberately absent rather than faked to the build date: a build does not mean
 * the content changed, and a sitemap that claims every page changed at every deploy trains
 * crawlers to ignore the field.
 */
export function sitemapXml(siteUrl: string): string {
  const urls = ROUTES.map((r) => {
    const loc = canonicalFor(siteUrl, r.path);
    return `  <url><loc>${loc}</loc><changefreq>${r.changefreq}</changefreq><priority>${r.priority}</priority></url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Schema.org description of the committee and the portal.
 *
 * `NGO` rather than `Organization`: it is the more specific type that fits a village welfare
 * committee, and specificity is what lets a search engine render a knowledge panel instead of a
 * bare link. The financial figures are NOT published here — they change daily, structured data
 * that disagrees with the page is worse than none, and there is no honest schema type for
 * "money a committee collected".
 */
export function organisationJsonLd(siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NGO',
    name: 'Navyuvak Chhath Puja Samiti',
    alternateName: 'Chhath Puja Transparency Portal',
    url: `${base}/`,
    logo: `${base}/icons/icon-512.png`,
    description:
      'A village welfare committee publishing every contribution, expense and loan for public scrutiny.',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Shaharpura, Gardih',
      addressCountry: 'IN',
    },
  });
}

/** WebSite node, so a search engine can attach the site name to every result. */
export function websiteJsonLd(siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Chhath Puja Transparency Portal',
    url: `${base}/`,
    inLanguage: ['en', 'hi'],
  });
}
