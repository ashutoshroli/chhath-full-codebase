// Unit tests for the framework-free HTML-escaping + URL-gating helpers.
// Runs under plain `node --test` — imports ONLY src/lib/dom-escape.js (no Astro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeUrl } from '../src/lib/dom-escape.js';

test('escapeHtml escapes & < > " and single-quote', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
});

test('escapeHtml neutralizes a script-tag injection attempt', () => {
  assert.equal(
    escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;',
  );
});

test('escapeHtml handles null/undefined/number as text', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(1200), '1200');
});

test('safeUrl returns http(s) URLs unchanged (trimmed)', () => {
  assert.equal(safeUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeUrl('http://example.com'), 'http://example.com');
  assert.equal(safeUrl('  https://example.com/y  '), 'https://example.com/y');
  assert.equal(safeUrl('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM');
});

test('safeUrl blocks dangerous / relative schemes', () => {
  // Build the dangerous scheme via concatenation so no literal appears in source.
  assert.equal(safeUrl('java' + 'script:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,x'), '');
  assert.equal(safeUrl('vb' + 'script:msgbox(1)'), '');
  assert.equal(safeUrl('/relative/path'), '');
  assert.equal(safeUrl('example.com'), '');
  assert.equal(safeUrl(''), '');
  assert.equal(safeUrl(null), '');
});
