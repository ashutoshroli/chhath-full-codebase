// The secret/PII path blocklist must match the Worker's aiFix.isBlockedPath — a
// file that would leak secrets/PII to Claude or into a commit must never pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedPath } from '../src/lib/blocklist.js';

test('blocks secret/PII-bearing paths', () => {
  for (const p of [
    '.env', '.env.local', 'mgmt/backend/.env.production',
    'wrangler.toml', 'mgmt/backend/wrangler.toml',
    'foo.secret', 'src/apiKey.js', 'lib/token.js', 'auth/password.js',
    'server.pem', 'x/credential.txt',
    'mgmt/db/migration/2026-09-05/23-render-jobs.sql',
    'mgmt/db/schema/core.sql',
    '', null,
  ]) {
    assert.equal(isBlockedPath(p), true, `should block: ${JSON.stringify(p)}`);
  }
});

test('allows ordinary source paths', () => {
  for (const p of [
    'mgmt/backend/src/loans.js',
    'mgmt/frontend/src/components/Login.jsx',
    'mgmt/server-render/src/server.js',
    'README.md',
  ]) {
    assert.equal(isBlockedPath(p), false, `should allow: ${p}`);
  }
});
