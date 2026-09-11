// ============ Render -> Worker: getPublicChatProvider route ============
//
// The public chatbot runs on Render, but the public_chat provider (with the
// AES-encrypted key) lives in D1 and only the Worker can decrypt it. Render fetches
// it over the ?render-provider route, authenticated by RENDER_WEBHOOK_SECRET in the
// X-Render-Signature header. These drive the REAL worker.fetch over stubs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import worker from '../src/index.js';
import { saveAiProvider, setDefaultAiProvider } from '../src/aiConfig.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };
const SECRET = 'render-webhook-secret-value-123456';

function logsSchemaWithPurpose() {
  const m24 = readFileSync(new URL('../../db/migration/2026-09-05/24-ai-providers-purpose.sql', import.meta.url), 'utf8');
  const m25 = readFileSync(new URL('../../db/migration/2026-09-05/25-ai-providers-priority.sql', import.meta.url), 'utf8');
  const m26 = readFileSync(new URL('../../db/migration/2026-09-05/26-ai-providers-data-mode.sql', import.meta.url), 'utf8');
  return schemaFor('logs.sql') + '\n' + m24 + '\n' + m25 + '\n' + m26;
}
function makeCtx() {
  const pending = [];
  return { ctx: { waitUntil: (p) => pending.push(p) }, settle: () => Promise.all(pending.map(p => Promise.resolve(p).catch(() => {}))) };
}
function makeEnv() {
  return {
    DB_LOGS: makeD1(logsSchemaWithPurpose()),
    KV_SESSIONS: makeKV(),
    AI_CONFIG_SECRET: 'a-very-strong-random-secret-value-000',
    RENDER_WEBHOOK_SECRET: SECRET,
  };
}
const post = (env, ctx, { sig } = {}) => worker.fetch(
  new Request('https://api.test/?render-provider=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(sig ? { 'X-Render-Signature': sig } : {}) },
    body: JSON.stringify({}),
  }),
  env, ctx
);

test('rejects a request with a wrong/missing secret (401)', async () => {
  const env = makeEnv();
  const { ctx } = makeCtx();
  const res = await post(env, ctx, { sig: 'wrong-secret' });
  assert.equal(res.status, 401);
  const res2 = await post(env, ctx, {}); // no signature
  assert.equal(res2.status, 401);
});

test('with the right secret + a configured public_chat default, returns the decrypted provider', async () => {
  const env = makeEnv();
  const { ctx, settle } = makeCtx();
  const p = await saveAiProvider(env, {
    name: 'ChatProv', type: 'openai-compatible', baseUrl: 'https://chat.test/v1', model: 'chat-m',
    apiKey: 'test-chat-key-9999', purpose: 'public_chat',
  }, SUPER);
  await setDefaultAiProvider(env, p.providerId, SUPER);

  const res = await post(env, ctx, { sig: SECRET });
  await settle();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.equal(body.provider.type, 'openai-compatible');
  assert.equal(body.provider.model, 'chat-m');
  assert.equal(body.provider.baseUrl, 'https://chat.test/v1');
  assert.equal(body.provider.apiKey, 'test-chat-key-9999', 'the key is decrypted for Render');
  // The full fallback chain is also returned (Render loops it); provider = chain[0].
  assert.ok(Array.isArray(body.providers) && body.providers.length >= 1, 'a providers[] chain is returned');
  assert.equal(body.providers[0].model, 'chat-m');
  assert.equal(body.providers[0].dataMode, 'summary', 'dataMode is threaded through to Render (default summary)');
});

test('the ?render-provider route threads a "full" data_mode through to Render', async () => {
  const env = makeEnv();
  const { ctx, settle } = makeCtx();
  const p = await saveAiProvider(env, {
    name: 'FullChat', type: 'openai-compatible', baseUrl: 'https://chat.test/v1', model: 'full-m',
    apiKey: 'test-chat-key-8888', purpose: 'public_chat', data_mode: 'full',
  }, SUPER);
  await setDefaultAiProvider(env, p.providerId, SUPER);

  const res = await post(env, ctx, { sig: SECRET });
  await settle();
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.equal(body.provider.dataMode, 'full');
  assert.equal(body.providers[0].dataMode, 'full');
});

test('returns the public_chat providers in priority order (a multi-provider chain)', async () => {
  const env = makeEnv();
  const { ctx } = makeCtx();
  const { saveAiProvider: save, reorderAiProviders: reorder } = await import('../src/aiConfig.js');
  const a = await save(env, { name: 'Groq', type: 'openai-compatible', baseUrl: 'https://groq.test/v1', model: 'groq-m', apiKey: 'test-key-a', purpose: 'public_chat' }, SUPER);
  const b = await save(env, { name: 'NVIDIA', type: 'openai-compatible', baseUrl: 'https://nv.test/v1', model: 'nv-m', apiKey: 'test-key-b', purpose: 'public_chat' }, SUPER);
  await reorder(env, 'public_chat', [b.providerId, a.providerId], SUPER); // NVIDIA first

  const res = await post(env, ctx, { sig: SECRET });
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.deepEqual(body.providers.map(p => p.model), ['nv-m', 'groq-m']);
  assert.equal(body.provider.model, 'nv-m', 'provider = chain[0]');
});

test('with the right secret but NO public_chat provider, returns configured:false (no ANTHROPIC fallback)', async () => {
  const env = makeEnv();
  env.ANTHROPIC_API_KEY = 'sk-should-not-be-used'; // fix-only fallback must not leak to chat
  const { ctx } = makeCtx();
  const res = await post(env, ctx, { sig: SECRET });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.configured, false);
  assert.equal(body.provider, undefined);
});

test('a fix-purpose provider is NOT returned as the public_chat provider', async () => {
  const env = makeEnv();
  const { ctx } = makeCtx();
  const p = await saveAiProvider(env, {
    name: 'FixProv', type: 'openai-compatible', baseUrl: 'https://fix.test/v1', model: 'fix-m',
    apiKey: 'test-fix-key-1111', purpose: 'fix',
  }, SUPER);
  await setDefaultAiProvider(env, p.providerId, SUPER);

  const res = await post(env, ctx, { sig: SECRET });
  const body = await res.json();
  assert.equal(body.configured, false, 'a fix default must not be served to the chatbot');
});
