
export const SEO_DEFAULTS = Object.freeze({
  title: 'Navyuvak Chhath Puja Samiti Shaharpura | Chhath Puja Transparency Portal',
  description:
    'Official transparency portal of Navyuvak Chhath Puja Samiti, Shaharpura & Gardih (Giridih, Jharkhand). View Chhath Puja collections, expenses, loans and committee details with full public transparency.',
  keywords:
    'Chhath Puja, छठ पूजा, Chhath, छठ, Navyuvak Chhath Puja Samiti, नवयुवक छठ पूजा समिति, Chhath Puja Samiti, छठ पूजा समिति, Chhath transparency portal, Chhath collection, Chhath chanda, छठ चंदा, Chhath committee, Chhath donation, Chhath expenses, Chhath hisab, छठ हिसाब, Shaharpura, Saharpura, Sahaarpura, Shahpura, Sahpura, शहरपुरा, Gardih, Gardi, गरडीह, गड़ीह, Siyatand, सियाटांड, Bengabad, बेंगाबाद, Jamua, जमुआ, Giridih, गिरिडीह, Jharkhand, झारखंड, India, भारत, 815312, Shaharpura Chhath, शहरपुरा छठ, Chhath Giridih, Chhath Jharkhand',
  themeColor: '#F97316',
  robots: 'index, follow',
  ogSiteName: 'Navyuvak Chhath Puja Samiti Shaharpura',
  ogTitle: 'Navyuvak Chhath Puja Samiti Shaharpura',
  ogDescription:
    'Official transparency portal — Chhath Puja collections, expenses, loans and committee details for Shaharpura & Gardih, Giridih, Jharkhand.',
  twitterTitle: 'Navyuvak Chhath Puja Samiti Shaharpura',
  twitterDescription:
    'Official Chhath Puja transparency portal for Shaharpura & Gardih, Giridih, Jharkhand.',
  geoRegion: 'IN-JH',
  geoPlacename: 'Shaharpura, Gardih, Giridih, Jharkhand',
  geoPosition: '24.18;86.30',
  icbm: '24.18, 86.30',
  previewImagePath: '/preview.jpg',
});

function joinUrl(siteUrl, path) {
  const base = (siteUrl || '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : '/' + path;
  return base + p;
}

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
    twitterCard: 'summary_large_image',
    twitterTitle: SEO_DEFAULTS.twitterTitle,
    twitterDescription: SEO_DEFAULTS.twitterDescription,
    twitterImage: image,
  };
}

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
