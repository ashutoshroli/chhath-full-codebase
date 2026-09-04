// ============ Follow-up to the 2026-09-04 full audit (§6.5) ============
//
// "A Hindi name in a Drive/R2 filename": safeName used `[^\w.\-]`, and JS `\w`
// is ASCII-only, so a Devanagari filename had EVERY character stripped and
// collapsed to the fallback ('file' / 'popup.jpg'). Two distinct Hindi-named
// uploads therefore shared one R2 key and overwrote each other.
//
// The fix uses a Unicode-aware class (\p{L}\p{N}) so letters/digits of any
// script are preserved, while path separators, spaces and control characters are
// still replaced. Tested through the exported key builders that call safeName.
//
// Run: node --test mgmt/backend/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyForYear, keyForPopup } from '../src/r2.js';

test('a Devanagari filename is preserved, not collapsed to the fallback', () => {
  const key = keyForYear(2026, 'consent', 'रमेश.jpg');
  // The Hindi characters must survive in the key.
  assert.match(key, /रमेश/);
  // And it must NOT have degraded to the fallback.
  assert.ok(!/\/file$/.test(key), `expected the real name, got: ${key}`);
});

test('two different Hindi names produce two different keys (no silent overwrite)', () => {
  const a = keyForPopup('रमेश.jpg');
  const b = keyForPopup('सुरेश.jpg');
  // Strip the timestamp prefix so we compare the name portion.
  const nameA = a.split('_').slice(1).join('_');
  const nameB = b.split('_').slice(1).join('_');
  assert.notEqual(nameA, nameB, 'distinct Hindi names must not map to one key');
});

test('path separators, spaces and control chars are still neutralised', () => {
  const key = keyForYear(2026, 'consent', '../../etc/passwd file\n.jpg');
  // The name segment must contain no "/" — that is what makes traversal
  // impossible, since the key layout (year/subdir/name) relies on "/" as the only
  // separator. (Literal dots are harmless in a flat key that can hold no "/".)
  const nameSegment = key.split('/').slice(2).join('/');
  assert.ok(!nameSegment.includes('/'), 'the name must not introduce a path separator');
  assert.ok(!/\s/.test(key), 'whitespace must be replaced');
  // The layout prefix is intact.
  assert.match(key, /^2026\/consent\//);
});

test('ASCII names are unchanged (no regression)', () => {
  const key = keyForYear(2026, 'pdf', 'receipt-2026-45.pdf', 'receipt');
  assert.equal(key, '2026/pdf/receipt/receipt-2026-45.pdf');
});

test('an empty / unusable name still falls back', () => {
  assert.match(keyForYear(2026, 'consent', '   '), /\/file$/);
});
