// ============ AI auto-fix — secret/PII blocklist (spec §5) ============
//
// The single most important safety property of the AI fix feature: a file that
// could contain secrets or PII must NEVER be fetched or sent to Claude as
// context. isBlockedPath() is the one gate that guarantees this, so it is pinned
// here. If someone loosens it, these fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedPath } from '../src/aiFix.js';

test('blocks .env files anywhere in the tree', () => {
  for (const p of [
    '.env', '.env.local', '.env.production',
    'mgmt/frontend/.env', 'Public/backend/.env.production',
  ]) {
    assert.equal(isBlockedPath(p), true, `${p} must be blocked`);
  }
});

test('blocks wrangler.toml anywhere', () => {
  assert.equal(isBlockedPath('wrangler.toml'), true);
  assert.equal(isBlockedPath('mgmt/backend/wrangler.toml'), true);
  assert.equal(isBlockedPath('Public/backend/wrangler.toml'), true);
});

test('blocks *.secret', () => {
  assert.equal(isBlockedPath('deploy.secret'), true);
  assert.equal(isBlockedPath('config/prod.secret'), true);
});

test('blocks DB migration and schema SQL (may carry live PII)', () => {
  assert.equal(isBlockedPath('mgmt/db/migration/2026-09-05/17-official-mailbox.sql'), true);
  assert.equal(isBlockedPath('mgmt/db/schema/core.sql'), true);
});

test('blocks any file whose name hints at a credential', () => {
  for (const p of [
    'src/apiKey.js', 'lib/secretStore.ts', 'auth/token-helper.js',
    'config/password.json', 'utils/credentials.js', 'certs/server.pem',
    'src/AccessToken.jsx',
  ]) {
    assert.equal(isBlockedPath(p), true, `${p} must be blocked`);
  }
});

test('blocks empty / missing paths (fail closed)', () => {
  assert.equal(isBlockedPath(''), true);
  assert.equal(isBlockedPath(null), true);
  assert.equal(isBlockedPath(undefined), true);
});

test('ALLOWS ordinary source files', () => {
  for (const p of [
    'mgmt/backend/src/loans.js',
    'mgmt/frontend/src/views/Home.jsx',
    'Public/frontend/script.js',
    'mgmt/backend/src/collectionQueue.js',
  ]) {
    assert.equal(isBlockedPath(p), false, `${p} must be allowed`);
  }
});
