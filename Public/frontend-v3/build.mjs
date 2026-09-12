
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SEO_API_BASE =
  process.env.SEO_API_BASE || 'https://chhath-public-worker.shaharpura.com';
const SITE_URL = process.env.SITE_URL || 'https://chhath.shaharpura.com';
const FETCH_TIMEOUT_MS = 8000;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonStr(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

async function fetchSeo() {
  const url = `${SEO_API_BASE}/?action=publicGetSeo`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || data.status === false || !data.seo) return null;
    return data.seo;
  } catch (err) {
    console.warn(`[build] SEO fetch skipped (${err.message}); keeping HTML defaults.`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function renderSeoBlock(seo) {
  const title =
    seo.title || 'Navyuvak Chhath Puja Samiti Shaharpura | Chhath Puja Transparency Portal';
  const ogTitle = seo.ogTitle || seo.title || 'Navyuvak Chhath Puja Samiti Shaharpura';
  const description =
    seo.description ||
    'Official transparency portal of Navyuvak Chhath Puja Samiti, Shaharpura & Gardih (Giridih, Jharkhand). View Chhath Puja collections, expenses, loans and committee details with full public transparency.';
  const keywords = seo.keywords || '';
  const image = seo.image || `${SITE_URL}/preview.jpg`;

  return `<!--SEO:START-->
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="keywords" content="${esc(keywords)}">
  <link rel="canonical" href="${esc(SITE_URL)}/">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#F97316">

  <!-- Geo signals -->
  <meta name="geo.region" content="IN-JH">
  <meta name="geo.placename" content="Shaharpura, Gardih, Giridih, Jharkhand">
  <meta name="geo.position" content="24.18;86.30">
  <meta name="ICBM" content="24.18, 86.30">

  <!-- Open Graph (WhatsApp / Facebook / LinkedIn) -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Navyuvak Chhath Puja Samiti Shaharpura">
  <meta property="og:title" content="${esc(ogTitle)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(SITE_URL)}/">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="en_IN">
  <meta property="og:locale:alternate" content="hi_IN">

  <!-- Twitter / X card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(ogTitle)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">

  <!-- Structured data: helps search engines show a rich organisation result -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": ${jsonStr(ogTitle)},
    "alternateName": "नवयुवक छठ पूजा समिति शहरपुरा",
    "url": "${SITE_URL}/",
    "logo": ${jsonStr(image)},
    "description": ${jsonStr(description)},
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Shaharpura, Gardih, Post Siyatand, Via Bengabad",
      "addressLocality": "Jamua",
      "addressRegion": "Jharkhand",
      "postalCode": "815312",
      "addressCountry": "IN"
    }
  }
  </script>
  <!--SEO:END-->`;
}

async function injectIntoHtml(seo) {
  const htmlPath = join(__dirname, 'index.html');
  const html = await readFile(htmlPath, 'utf8');
  const startMarker = '<!--SEO:START-->';
  const endMarker = '<!--SEO:END-->';
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1) {
    console.warn('[build] SEO markers not found in index.html; leaving it unchanged.');
    return;
  }
  const before = html.slice(0, start);
  const after = html.slice(end + endMarker.length);
  const next = before + renderSeoBlock(seo) + after;
  await writeFile(htmlPath, next, 'utf8');
  console.log('[build] Injected SEO settings into index.html.');
}

async function refreshSitemap() {
  const path = join(__dirname, 'sitemap.xml');
  const lastmod = new Date().toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
  await writeFile(path, xml, 'utf8');
  console.log(`[build] Refreshed sitemap.xml (lastmod ${lastmod}).`);
}

async function main() {
  const seo = await fetchSeo();
  if (seo) await injectIntoHtml(seo);
  else console.log('[build] Using hardcoded SEO defaults in index.html.');
  await refreshSitemap();
  console.log('[build] Done.');
}

main().catch((err) => {
  console.warn(`[build] Non-fatal build.mjs error: ${err.message}`);
  process.exit(0);
});
