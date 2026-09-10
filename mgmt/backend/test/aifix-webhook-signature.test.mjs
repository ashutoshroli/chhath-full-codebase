// ============ AI auto-fix — GitHub webhook signature verification ============
//
// The CI-retry webhook is PUBLIC (no session). Its ONLY authentication is the
// HMAC-SHA256 signature GitHub sends in X-Hub-Signature-256 over the raw body.
// If this check is wrong, anyone could forge a "CI failed" event and drive the
// AI/commit machinery. Pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyGithubSignature } from '../src/aiFixCi.js';

const SECRET = 'test-webhook-secret-123';
const BODY = JSON.stringify({ check_suite: { status: 'completed', conclusion: 'failure', head_branch: 'fix/error-ABC' } });

function sign(body, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

test('accepts a correctly-signed body', async () => {
  const env = { GITHUB_WEBHOOK_SECRET: SECRET };
  const ok = await verifyGithubSignature(env, BODY, sign(BODY, SECRET));
  assert.equal(ok, true);
});

test('rejects a wrong signature', async () => {
  const env = { GITHUB_WEBHOOK_SECRET: SECRET };
  const ok = await verifyGithubSignature(env, BODY, sign(BODY, 'the-wrong-secret'));
  assert.equal(ok, false);
});

test('rejects a tampered body (same secret)', async () => {
  const env = { GITHUB_WEBHOOK_SECRET: SECRET };
  const goodSig = sign(BODY, SECRET);
  const tampered = BODY.replace('failure', 'success');
  const ok = await verifyGithubSignature(env, tampered, goodSig);
  assert.equal(ok, false);
});

test('rejects when no secret is configured (fail closed)', async () => {
  const ok = await verifyGithubSignature({ GITHUB_WEBHOOK_SECRET: '' }, BODY, sign(BODY, SECRET));
  assert.equal(ok, false);
});

test('rejects a missing / empty signature header', async () => {
  const env = { GITHUB_WEBHOOK_SECRET: SECRET };
  assert.equal(await verifyGithubSignature(env, BODY, ''), false);
  assert.equal(await verifyGithubSignature(env, BODY, null), false);
});

test('accepts the sha256= prefixed form exactly as GitHub sends it', async () => {
  const env = { GITHUB_WEBHOOK_SECRET: SECRET };
  const sig = sign(BODY, SECRET);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(await verifyGithubSignature(env, BODY, sig), true);
});
