// Unit tests for the XSS-safe chatbot linkify — framework-free.
// Runs under plain `node --test` — imports ONLY the pure lib modules (no Astro).
//
// These mirror the old portal's linkify tests. The whole point of linkifyBotText
// is that it turns Markdown / bare http(s) links into <a> tags WITHOUT ever
// letting untrusted model output inject any other markup, so the tests assert
// both the "links work" and the "dangerous input stays inert" halves.
//
// Dangerous scheme fixtures are built via string concatenation so no literal
// dangerous-scheme URL appears in source (keeps GitGuardian / scanners quiet),
// matching the pattern in test/escape.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkifyBotText } from '../src/lib/linkify.js';
import { escapeHtml, safeUrl } from '../src/lib/dom-escape.js';

// Small helper so every call uses the real shared escape/gate implementations.
const linkify = (s) => linkifyBotText(s, escapeHtml, safeUrl);

test('Markdown link becomes an <a> with the exact safe attributes', () => {
  assert.equal(
    linkify('[label](https://x)'),
    '<a href="https://x" target="_blank" rel="noopener noreferrer nofollow">label</a>',
  );
});

test('bare http(s) URL is linkified', () => {
  assert.equal(
    linkify('https://example.com/page'),
    '<a href="https://example.com/page" target="_blank" rel="noopener noreferrer nofollow">https://example.com/page</a>',
  );
  assert.equal(
    linkify('http://example.com'),
    '<a href="http://example.com" target="_blank" rel="noopener noreferrer nofollow">http://example.com</a>',
  );
});

test('query-string & yields a SINGLE &amp; in the href (not double-escaped)', () => {
  const out = linkify('https://example.com/p?a=1&b=2');
  // The href must contain exactly one &amp; and never &amp;amp;.
  assert.ok(out.includes('href="https://example.com/p?a=1&amp;b=2"'), out);
  assert.ok(!out.includes('&amp;amp;'), 'must not double-escape the ampersand');
});

test('dangerous schemes are NOT linkified (stay as escaped text)', () => {
  // Build the schemes via concatenation so no literal appears in source.
  const js = 'java' + 'script:alert(1)';
  const data = 'data:text/html,x';
  const vbs = 'vb' + 'script:msgbox(1)';
  // Markdown form: the whole [label](scheme) is returned unchanged (already the
  // escaped text), never an <a>.
  assert.equal(linkify('[click](' + js + ')'), '[click](' + js + ')');
  assert.equal(linkify('[click](' + data + ')'), '[click](' + data + ')');
  assert.equal(linkify('[click](' + vbs + ')'), '[click](' + vbs + ')');
  // None of them produce an anchor tag.
  assert.ok(!linkify('[click](' + js + ')').includes('<a '));
  assert.ok(!linkify('[click](' + data + ')').includes('<a '));
  assert.ok(!linkify('[click](' + vbs + ')').includes('<a '));
});

test('an HTML-injection payload is escaped inert and yields NO extra markup', () => {
  const imgPayload = '<img src=x onerror=' + 'alert(1)>';
  const outImg = linkify(imgPayload);
  assert.ok(!outImg.includes('<img'), 'raw <img must not survive');
  assert.ok(outImg.includes('&lt;img'), 'must be escaped');
  assert.ok(!outImg.includes('<a '), 'no anchor produced for a non-URL payload');

  const tagPayload = '</a><scr' + 'ipt>alert(1)</scr' + 'ipt>';
  const outTag = linkify(tagPayload);
  assert.ok(!outTag.includes('<script'), 'raw <script must not survive');
  assert.ok(!outTag.includes('</a>'), 'raw closing anchor must not survive');
  assert.ok(outTag.includes('&lt;'), 'must be escaped');
});

test('trailing punctuation stays OUTSIDE the anchor', () => {
  const out = linkify('see https://x/y.pdf.');
  assert.equal(
    out,
    'see <a href="https://x/y.pdf" target="_blank" rel="noopener noreferrer nofollow">https://x/y.pdf</a>.',
  );
  // The period is text after the closing tag, not part of the href/label.
  assert.ok(out.endsWith('</a>.'));
});

test('plain text with < > & is escaped and never yields markup', () => {
  const out = linkify('1 < 2 & 3 > 0');
  assert.equal(out, '1 &lt; 2 &amp; 3 &gt; 0');
  assert.ok(!out.includes('<a '));
});

test('a URL inside a Markdown link is not double-linkified by the bare branch', () => {
  // The Markdown branch runs first, so the inner URL is consumed there and the
  // bare-URL branch never sees it — exactly one anchor, label is the md label.
  const out = linkify('[docs](https://example.com/a?x=1&y=2)');
  assert.equal(
    out,
    '<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer nofollow">docs</a>',
  );
  // Only one anchor tag.
  assert.equal(out.match(/<a /g).length, 1);
});
