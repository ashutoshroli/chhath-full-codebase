// Unit tests for the framework-free announcement-popup pure logic.
// Runs under plain `node --test` — imports ONLY src/lib/popup.js plus the real
// dom-escape/drive helpers (no Astro, no DOM, no timers).
//
// Any Drive file-id fixture is built via string concatenation so no literal
// long-token string appears in source (keeps secret scanners quiet), matching
// the concat pattern used in the other tests. The id here is an obviously-fake
// fixed-length token, not a real credential.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSlideDuration,
  nextIndex,
  prevIndex,
  pickFirstEligiblePopup,
  buildSlideHtml,
} from '../src/lib/popup.js';
import { escapeHtml, safeUrl } from '../src/lib/dom-escape.js';
import { driveImageUrl, driveImageFallbackUrl } from '../src/lib/drive.js';

// The real helpers injected into buildSlideHtml, mirroring the island call site.
const DEPS = { escapeHtml, safeUrl, driveImageUrl, driveImageFallbackUrl };

// A fake 12-char Drive id built via concatenation.
const ID = 'abcDEF' + '123456';

// ---- clampSlideDuration ----------------------------------------------------

test('clampSlideDuration defaults null/0/negative/NaN to 5000', () => {
  assert.equal(clampSlideDuration(null), 5000);
  assert.equal(clampSlideDuration(undefined), 5000);
  assert.equal(clampSlideDuration(0), 5000);
  assert.equal(clampSlideDuration(-100), 5000);
  assert.equal(clampSlideDuration('not-a-number'), 5000);
});

test('clampSlideDuration clamps below 1000 up to 1000', () => {
  assert.equal(clampSlideDuration(1), 1000);
  assert.equal(clampSlideDuration(999), 1000);
});

test('clampSlideDuration clamps above 60000 down to 60000', () => {
  assert.equal(clampSlideDuration(60001), 60000);
  assert.equal(clampSlideDuration(1000000), 60000);
});

test('clampSlideDuration passes a valid in-range value through', () => {
  assert.equal(clampSlideDuration(1000), 1000);
  assert.equal(clampSlideDuration(5000), 5000);
  assert.equal(clampSlideDuration(60000), 60000);
  assert.equal(clampSlideDuration('3000'), 3000); // parseInt of a numeric string
});

// ---- nextIndex / prevIndex -------------------------------------------------

test('nextIndex wraps last -> 0 and advances otherwise', () => {
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(1, 3), 2);
  assert.equal(nextIndex(2, 3), 0); // last wraps to first
});

test('prevIndex wraps 0 -> last and steps back otherwise', () => {
  assert.equal(prevIndex(2, 3), 1);
  assert.equal(prevIndex(1, 3), 0);
  assert.equal(prevIndex(0, 3), 2); // first wraps to last
});

test('nextIndex/prevIndex on a single element stay at 0', () => {
  assert.equal(nextIndex(0, 1), 0);
  assert.equal(prevIndex(0, 1), 0);
});

test('nextIndex/prevIndex guard a non-positive length by returning 0', () => {
  assert.equal(nextIndex(0, 0), 0);
  assert.equal(prevIndex(0, 0), 0);
  assert.equal(nextIndex(3, -1), 0);
  assert.equal(prevIndex(3, -1), 0);
});

// ---- pickFirstEligiblePopup ------------------------------------------------

test('pickFirstEligiblePopup returns null for an empty array', () => {
  assert.equal(pickFirstEligiblePopup([]), null);
});

test('pickFirstEligiblePopup returns null for a non-array', () => {
  assert.equal(pickFirstEligiblePopup(null), null);
  assert.equal(pickFirstEligiblePopup(undefined), null);
  assert.equal(pickFirstEligiblePopup({}), null);
  assert.equal(pickFirstEligiblePopup('nope'), null);
});

test('pickFirstEligiblePopup returns null when popups[0] has no slides', () => {
  assert.equal(pickFirstEligiblePopup([{ slides: [] }]), null);
  assert.equal(pickFirstEligiblePopup([{ slides: null }]), null);
  assert.equal(pickFirstEligiblePopup([{}]), null);
});

test('pickFirstEligiblePopup returns popups[0] when it has a non-empty slides array', () => {
  const first = { id: 1, slides: [{ text: 'hello' }] };
  assert.equal(pickFirstEligiblePopup([first]), first);
});

test('pickFirstEligiblePopup returns ONLY the first popup when multiple exist', () => {
  const first = { id: 1, slides: [{ text: 'first' }] };
  const second = { id: 2, slides: [{ text: 'second' }] };
  assert.equal(pickFirstEligiblePopup([first, second]), first);
});

// ---- buildSlideHtml: XSS + gating ------------------------------------------

test('buildSlideHtml escapes text (angle brackets and quotes)', () => {
  const html = buildSlideHtml({ text: '<script>alert("x")</' + 'script>' }, DEPS);
  assert.ok(!html.includes('<script>'), 'raw <script> must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'angle brackets must be escaped');
  assert.ok(html.includes('&quot;'), 'double quotes must be escaped');
});

test('buildSlideHtml gates a javascript: link_url (no <a> emitted)', () => {
  const html = buildSlideHtml(
    { text: 'hi', link_url: 'javascript:alert(1)', link_text: 'click' },
    DEPS,
  );
  assert.ok(!html.includes('<a'), 'javascript: link_url must not produce an <a>');
  assert.ok(!html.toLowerCase().includes('javascript:'), 'no javascript: scheme in output');
});

test('buildSlideHtml gates a javascript:/data: image_url (no <img> emitted)', () => {
  const jsImg = buildSlideHtml({ image_url: 'javascript:alert(1)' }, DEPS);
  assert.ok(!jsImg.includes('<img'), 'javascript: image_url must not produce an <img>');
  const dataImg = buildSlideHtml(
    { image_url: 'data:text/html;base64,PHNjcmlwdD4=' },
    DEPS,
  );
  assert.ok(!dataImg.includes('<img'), 'data: image_url must not produce an <img>');
});

test('buildSlideHtml renders an http(s) image and an http(s) link', () => {
  const html = buildSlideHtml(
    {
      image_url: 'https://example.com/pic.png',
      text: 'Announcement',
      link_url: 'https://example.com/more',
      link_text: 'Read more',
    },
    DEPS,
  );
  assert.ok(html.includes('<img'), 'http(s) image renders');
  assert.ok(html.includes('src="https://example.com/pic.png"'), 'image src preserved');
  assert.ok(html.includes('<a'), 'http(s) link renders');
  assert.ok(html.includes('href="https://example.com/more"'), 'link href preserved');
  assert.ok(html.includes('>Read more</a>'), 'link label preserved');
  assert.ok(html.includes('target="_blank"') && html.includes('rel="noreferrer"'), 'link opens safely');
});

test('buildSlideHtml includes the Drive fallback (data-fb + onerror) for a Drive image_url', () => {
  const html = buildSlideHtml(
    { image_url: 'https://drive.google.com/file/d/' + ID + '/view' },
    DEPS,
  );
  assert.ok(html.includes('<img'), 'Drive image renders');
  assert.ok(
    html.includes('src="https://lh3.googleusercontent.com/d/' + ID + '=w1600"'),
    'Drive image rewritten to the lh3 CDN URL',
  );
  assert.ok(
    html.includes('data-fb="https://drive.google.com/thumbnail?id=' + ID + '&amp;sz=w1600"'),
    'Drive fallback thumbnail present in data-fb (ampersand escaped)',
  );
  assert.ok(html.includes('onerror='), 'onerror fallback-then-hide handler present');
});

test('buildSlideHtml defaults an http(s) link with no label to "Learn more"', () => {
  const html = buildSlideHtml({ link_url: 'https://example.com/more' }, DEPS);
  assert.ok(html.includes('>Learn more</a>'), 'missing label defaults to Learn more');
});

test('buildSlideHtml renders nothing for an empty or malformed slide', () => {
  assert.equal(buildSlideHtml({}, DEPS), '');
  assert.equal(buildSlideHtml(null, DEPS), '');
  assert.equal(buildSlideHtml(undefined, DEPS), '');
  // A slide whose only URLs are unsafe produces no elements at all.
  assert.equal(
    buildSlideHtml({ image_url: 'javascript:x', link_url: 'data:y' }, DEPS),
    '',
  );
});
