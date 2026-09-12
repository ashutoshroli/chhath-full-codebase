// Unit tests for the framework-free analytics-id resolver.
// Runs under plain `node --test` — imports ONLY src/lib/analytics.js (no Astro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGtmId, DEFAULT_GTM_ID } from '../src/lib/analytics.js';

test('resolveGtmId falls back to the production default when unset', () => {
  assert.equal(resolveGtmId({}), DEFAULT_GTM_ID);
  assert.equal(resolveGtmId(undefined), DEFAULT_GTM_ID);
  assert.equal(resolveGtmId({ PUBLIC_GTM_ID: '' }), DEFAULT_GTM_ID);
  assert.equal(resolveGtmId({ PUBLIC_GTM_ID: '   ' }), DEFAULT_GTM_ID);
});

test('resolveGtmId honours an explicit PUBLIC_GTM_ID override (trimmed)', () => {
  const custom = 'GTM-' + 'TEST123';
  assert.equal(resolveGtmId({ PUBLIC_GTM_ID: custom }), custom);
  assert.equal(resolveGtmId({ PUBLIC_GTM_ID: '  ' + custom + '  ' }), custom);
});

test('DEFAULT_GTM_ID matches the ported production container id', () => {
  assert.equal(DEFAULT_GTM_ID, 'GTM-N6BF7NP7');
});
