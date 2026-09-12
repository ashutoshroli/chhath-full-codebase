
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_URL =
  process.env.SEO_API_URL || process.env.VITE_API_URL || '';
const SITE_URL = process.env.MGMT_SITE_URL || 'https://mgmt-chhath.shaharpura.com';
const FETCH_TIMEOUT_MS = 8000;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchSeo() {
  if (!API_URL) {
    console.warn('[build] No API URL set (VITE_API_URL/SEO_API_URL); keeping HTML defaults.');
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'publicGetSeo', portal: 'mgmt' }),
      signal: controller.signal,
    });
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
  const title = seo.title || 'Chhath Puja Management Portal';
  const description =
    seo.description ||
    'Private management portal for Navyuvak Chhath Puja Samiti Shaharpura. Authorised committee members only.';
  const image = seo.image || `${SITE_URL}/preview.jpg`;

  return `<!--SEO:START-->
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#F97316">

  <!-- Open Graph (WhatsApp / Facebook) -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Chhath Puja Management Portal">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(SITE_URL)}/">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <!-- Twitter / X card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">
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
  const next = html.slice(0, start) + renderSeoBlock(seo) + html.slice(end + endMarker.length);
  await writeFile(htmlPath, next, 'utf8');
  console.log('[build] Injected SEO settings into index.html.');
}

async function main() {
  const seo = await fetchSeo();
  if (seo) await injectIntoHtml(seo);
  else console.log('[build] Using hardcoded SEO defaults in index.html.');
  console.log('[build] Done.');
}

main().catch((err) => {
  console.warn(`[build] Non-fatal build-seo.mjs error: ${err.message}`);
  process.exit(0);
});
