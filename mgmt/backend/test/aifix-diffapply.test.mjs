// ============ AI auto-fix — unified diff applier ============
//
// The commit step applies Claude's diff to real file content. A wrong-but-silent
// patch would push broken code, so the applier is STRICT: exact context match or
// clean failure. These tests pin that behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUnifiedDiff, applyFilePatch, parseUnifiedDiff, pathsInDiff } from '../src/diffApply.js';

const file = [
  'function add(a, b) {',
  '  return a - b;',   // the bug
  '}',
  '',
  'export { add };',
].join('\n');

const goodDiff = [
  'diff --git a/math.js b/math.js',
  '--- a/math.js',
  '+++ b/math.js',
  '@@ -1,3 +1,3 @@',
  ' function add(a, b) {',
  '-  return a - b;',
  '+  return a + b;',
  ' }',
].join('\n');

test('applies a correct single-hunk fix', () => {
  const res = applyUnifiedDiff(goodDiff, { 'math.js': file });
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].path, 'math.js');
  assert.match(res.files[0].content, /return a \+ b;/);
  assert.ok(!/return a - b;/.test(res.files[0].content), 'the buggy line is gone');
  // The rest of the file is preserved.
  assert.match(res.files[0].content, /export \{ add \};/);
});

test('FAILS on context mismatch (does not silently mis-apply)', () => {
  const drifted = file.replace('function add(a, b) {', 'function add( a, b ) {');
  const res = applyUnifiedDiff(goodDiff, { 'math.js': drifted });
  assert.equal(res.ok, false);
  assert.match(res.reason, /mismatch/i);
});

test('FAILS on removal mismatch', () => {
  const changed = file.replace('  return a - b;', '  return a * b;');
  const res = applyUnifiedDiff(goodDiff, { 'math.js': changed });
  assert.equal(res.ok, false);
  assert.match(res.reason, /removal mismatch/i);
});

test('creates a new file from a /dev/null diff', () => {
  const newDiff = [
    'diff --git a/hello.js b/hello.js',
    '--- /dev/null',
    '+++ b/hello.js',
    '@@ -0,0 +1,2 @@',
    "+export const hi = 'hi';",
    '+export default hi;',
  ].join('\n');
  const res = applyUnifiedDiff(newDiff, {});
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.files[0].isNew, true);
  assert.match(res.files[0].content, /export const hi = 'hi';/);
});

test('handles multiple hunks in one file', () => {
  const big = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
  const d = [
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,1 +1,1 @@',
    '-line 1',
    '+LINE 1',
    '@@ -9,1 +9,1 @@',
    '-line 9',
    '+LINE 9',
  ].join('\n');
  const res = applyUnifiedDiff(d, { 'f.txt': big });
  assert.equal(res.ok, true, res.reason);
  assert.match(res.files[0].content, /LINE 1/);
  assert.match(res.files[0].content, /LINE 9/);
  assert.match(res.files[0].content, /line 5/); // untouched middle preserved
});

test('applies a multi-FILE diff', () => {
  const d = [
    'diff --git a/one.js b/one.js',
    '--- a/one.js',
    '+++ b/one.js',
    '@@ -1,1 +1,1 @@',
    '-const a = 1;',
    '+const a = 2;',
    'diff --git a/two.js b/two.js',
    '--- a/two.js',
    '+++ b/two.js',
    '@@ -1,1 +1,1 @@',
    '-const b = 3;',
    '+const b = 4;',
  ].join('\n');
  const res = applyUnifiedDiff(d, { 'one.js': 'const a = 1;', 'two.js': 'const b = 3;' });
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.files.length, 2);
  assert.match(res.files.find(f => f.path === 'one.js').content, /const a = 2;/);
  assert.match(res.files.find(f => f.path === 'two.js').content, /const b = 4;/);
});

test('FAILS cleanly on empty / junk diff', () => {
  assert.equal(applyUnifiedDiff('', {}).ok, false);
  assert.equal(applyUnifiedDiff('not a diff at all', {}).ok, false);
});

test('pathsInDiff lists the touched files', () => {
  assert.deepEqual(pathsInDiff(goodDiff), ['math.js']);
});
