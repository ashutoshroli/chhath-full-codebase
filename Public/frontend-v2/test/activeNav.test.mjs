// Unit tests for the shared active-nav computation — framework-free.
// Runs under plain `node --test` — imports ONLY the pure lib module (no Astro).
//
// normalizePath + isActivePath are the ONE unit-testable piece behind the
// header's active-tab fix: they must match trailing-slash variants and be exact
// (not prefix) matches, mirroring the server's isActive predicate so the
// client-side updater (Header.astro) can never disagree with the server render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePath, isActivePath } from '../src/lib/activeNav.js';

test('normalizePath strips a trailing slash except on root', () => {
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('/loans'), '/loans');
  assert.equal(normalizePath('/loans/'), '/loans');
  assert.equal(normalizePath('/expenses/'), '/expenses');
});

test('normalizePath treats empty/undefined as root', () => {
  assert.equal(normalizePath(''), '/');
  assert.equal(normalizePath(undefined), '/');
  assert.equal(normalizePath(null), '/');
});

test('isActivePath matches a route regardless of trailing slash', () => {
  assert.equal(isActivePath('/loans', '/loans'), true);
  assert.equal(isActivePath('/loans/', '/loans'), true);
  assert.equal(isActivePath('/loans', '/loans/'), true);
  assert.equal(isActivePath('/loans/', '/loans/'), true);
});

test('isActivePath matches the root only for root', () => {
  assert.equal(isActivePath('/', '/'), true);
  assert.equal(isActivePath('/loans', '/'), false);
  assert.equal(isActivePath('/', '/loans'), false);
});

test('isActivePath is exact, not a prefix match', () => {
  // A longer path that merely starts with a nav route must NOT match it.
  assert.equal(isActivePath('/loans/summary', '/loans'), false);
  assert.equal(isActivePath('/expenses-archive', '/expenses'), false);
});

test('isActivePath only lights up the one true route', () => {
  const routes = ['/', '/expenses', '/loans', '/committee', '/downloads'];
  const active = routes.filter((href) => isActivePath('/loans/', href));
  assert.deepEqual(active, ['/loans']);
});
