import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seoTags, organizationJsonLd, SEO_DEFAULTS } from '../src/lib/seo.js';

const CONFIG = { siteUrl: 'https://chhath.shaharpura.com' };

test('seoTags applies ported defaults when no page props are given', () => {
  const seo = seoTags(CONFIG, {});
  assert.equal(seo.title, SEO_DEFAULTS.title);
  assert.equal(seo.description, SEO_DEFAULTS.description);
  assert.equal(seo.keywords, SEO_DEFAULTS.keywords);
  assert.equal(seo.robots, 'index, follow');
  assert.equal(seo.themeColor, '#F97316');
});

test('seoTags derives canonical + og:url from the passed siteUrl and pathname', () => {
  const seo = seoTags(CONFIG, { pathname: '/expenses' });
  assert.equal(seo.canonical, 'https://chhath.shaharpura.com/expenses');
  assert.equal(seo.ogUrl, 'https://chhath.shaharpura.com/expenses');
});

test('seoTags root pathname yields the origin + / canonical (no double slash)', () => {
  const seo = seoTags({ siteUrl: 'https://chhath.shaharpura.com/' }, { pathname: '/' });
  assert.equal(seo.canonical, 'https://chhath.shaharpura.com/');
  assert.ok(!seo.canonical.includes('//expenses'));
});

test('seoTags builds og/twitter image from siteUrl + /preview.jpg', () => {
  const seo = seoTags(CONFIG, {});
  assert.equal(seo.ogImage, 'https://chhath.shaharpura.com/preview.jpg');
  assert.equal(seo.twitterImage, 'https://chhath.shaharpura.com/preview.jpg');
  assert.equal(seo.ogImageWidth, '1200');
  assert.equal(seo.ogImageHeight, '630');
  assert.equal(seo.ogLocale, 'en_IN');
  assert.equal(seo.ogLocaleAlternate, 'hi_IN');
});

test('seoTags per-page title/description override the defaults', () => {
  const seo = seoTags(CONFIG, { title: 'Expenses Ledger', description: 'All expenses.' });
  assert.equal(seo.title, 'Expenses Ledger');
  assert.equal(seo.description, 'All expenses.');
});

test('seoTags falls back to defaults for blank/undefined page props', () => {
  const seo = seoTags(CONFIG, { title: '   ', description: undefined });
  assert.equal(seo.title, SEO_DEFAULTS.title);
  assert.equal(seo.description, SEO_DEFAULTS.description);
});

test('organizationJsonLd carries the correct address block', () => {
  const org = organizationJsonLd(CONFIG);
  assert.equal(org['@type'], 'Organization');
  assert.equal(org.name, 'Navyuvak Chhath Puja Samiti Shaharpura');
  assert.equal(org.alternateName, 'नवयुवक छठ पूजा समिति शहरपुरा');
  assert.equal(org.url, 'https://chhath.shaharpura.com/');
  assert.equal(org.logo, 'https://chhath.shaharpura.com/preview.jpg');
  assert.equal(org.address['@type'], 'PostalAddress');
  assert.equal(org.address.streetAddress, 'Shaharpura, Gardih, Post Siyatand, Via Bengabad');
  assert.equal(org.address.addressLocality, 'Jamua');
  assert.equal(org.address.addressRegion, 'Jharkhand');
  assert.equal(org.address.postalCode, '815312');
  assert.equal(org.address.addressCountry, 'IN');
});

test('organizationJsonLd serialises to valid JSON', () => {
  const s = JSON.stringify(organizationJsonLd(CONFIG));
  const parsed = JSON.parse(s);
  assert.equal(parsed['@context'], 'https://schema.org');
});
