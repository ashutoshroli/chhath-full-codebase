// audit Q-8 — action classification drift guard.
//
// The router in src/index.js decides whether to bump the public data-version with
// a single rule: "action NOT in READ_ONLY_ACTIONS => it's a write => bump". That
// rule is fail-safe (a forgotten action defaults to 'write', a harmless extra
// revalidation), so we deliberately did NOT invert it to a write-allowlist (see the
// long comment on READ_ONLY_ACTIONS).
//
// The real Q-8 risk is a NEW action nobody thought about being silently classified.
// This test removes that risk WITHOUT changing the runtime rule: it extracts every
// handler key the router actually exposes and asserts each one is CONSCIOUSLY listed
// in exactly one of READ_ONLY_ACTIONS / EXPECTED_MUTATING_ACTIONS. Add a handler and
// forget to classify it -> this test fails -> CI catches it before deploy.
//
// Run: node --test mgmt/backend/test/q8-action-classification.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { READ_ONLY_ACTIONS, EXPECTED_MUTATING_ACTIONS } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src', 'index.js');

// Extract the handler action names from the `const handlers = { ... }` block.
// Handler keys are indented exactly 6 spaces (two levels inside fetch) and look
// like `name:` or `name: () => ...`. This mirrors how index.js is formatted; if
// the indentation ever changes, this test's own sanity assertion (count > 100)
// fires first and tells you to update the extractor rather than silently passing.
function routerActionKeys() {
  const src = readFileSync(SRC, 'utf8');
  const start = src.indexOf('const handlers = {');
  assert.ok(start !== -1, 'could not find `const handlers = {` in index.js');
  // The handlers object ends at the dispatch that follows it; scan until the first
  // line that closes the object at the handler indentation level.
  const after = src.slice(start);
  const lines = after.split('\n');
  const keys = new Set();
  // Skip the opening line; walk until we leave the object (a line `    };` at 4
  // spaces closes `const handlers = {`).
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {4}};/.test(line)) break; // end of the handlers object
    const m = /^ {6}([a-zA-Z0-9_]+):/.exec(line);
    if (m) keys.add(m[1]);
  }
  return keys;
}

test('the handler block is found and looks complete', () => {
  const keys = routerActionKeys();
  // There are ~150 actions; a much smaller number means the extractor broke.
  assert.ok(keys.size > 100, `expected >100 handler keys, got ${keys.size} — the extractor or index.js formatting changed`);
});

test('READ_ONLY_ACTIONS and EXPECTED_MUTATING_ACTIONS never overlap', () => {
  const overlap = [...READ_ONLY_ACTIONS].filter((a) => EXPECTED_MUTATING_ACTIONS.has(a));
  assert.deepEqual(overlap, [], `these actions are in BOTH sets: ${overlap.join(', ')}`);
});

test('every router action is consciously classified as read or write', () => {
  const keys = routerActionKeys();
  const unclassified = [...keys].filter(
    (a) => !READ_ONLY_ACTIONS.has(a) && !EXPECTED_MUTATING_ACTIONS.has(a)
  );
  assert.deepEqual(
    unclassified,
    [],
    `these router actions are not listed in READ_ONLY_ACTIONS or EXPECTED_MUTATING_ACTIONS ` +
      `(add each to exactly one — see the Q-8 note in index.js): ${unclassified.join(', ')}`
  );
});

test('no listed action is stale (present in a set but no longer a handler)', () => {
  const keys = routerActionKeys();
  const stale = [...READ_ONLY_ACTIONS, ...EXPECTED_MUTATING_ACTIONS].filter((a) => !keys.has(a));
  assert.deepEqual(
    stale,
    [],
    `these actions are classified but no longer exist as router handlers (remove them): ${stale.join(', ')}`
  );
});
