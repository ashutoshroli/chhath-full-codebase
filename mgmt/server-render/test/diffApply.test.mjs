// Unit tests for the ported diff applier + GitHub path blocklist. Pure logic, no
// network — mirrors the Worker's own diff/blocklist coverage so the Render copy
// can't silently drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUnifiedDiff, pathsInDiff, parseUnifiedDiff } from '../src/lib/diffApply.js';

test('applies a simple single-hunk edit', () => {
  const diff = [
    'diff --git a/x.js b/x.js',
    '--- a/x.js',
    '+++ b/x.js',
    '@@ -1,3 +1,3 @@',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    ' const c = 4;',
  ].join('\n');
  const res = applyUnifiedDiff(diff, { 'x.js': 'const a = 1;\nconst b = 2;\nconst c = 4;' });
  assert.equal(res.ok, true);
  assert.equal(res.files[0].content, 'const a = 1;\nconst b = 3;\nconst c = 4;');
});

test('a context mismatch fails cleanly (no silent bad patch)', () => {
  const diff = [
    '--- a/x.js', '+++ b/x.js', '@@ -1,2 +1,2 @@',
    ' const a = 1;', '-const b = 2;', '+const b = 3;',
  ].join('\n');
  const res = applyUnifiedDiff(diff, { 'x.js': 'const a = 1;\nconst DIFFERENT = 9;' });
  assert.equal(res.ok, false);
  assert.match(res.reason, /mismatch/);
});

test('a new file (/dev/null) is created from + lines', () => {
  const diff = [
    '--- /dev/null', '+++ b/new.js', '@@ -0,0 +1,2 @@',
    '+export const hi = 1;', '+export const bye = 2;',
  ].join('\n');
  const res = applyUnifiedDiff(diff, {});
  assert.equal(res.ok, true);
  assert.equal(res.files[0].isNew, true);
  assert.match(res.files[0].content, /export const hi = 1;/);
});

test('pathsInDiff lists every touched path', () => {
  const diff = [
    'diff --git a/one.js b/one.js', '--- a/one.js', '+++ b/one.js', '@@ -1 +1 @@', '-x', '+y',
    'diff --git a/two.js b/two.js', '--- a/two.js', '+++ b/two.js', '@@ -1 +1 @@', '-p', '+q',
  ].join('\n');
  assert.deepEqual(pathsInDiff(diff).sort(), ['one.js', 'two.js']);
});

test('parseUnifiedDiff returns empty for junk', () => {
  assert.deepEqual(parseUnifiedDiff('not a diff'), []);
});
