// ============ testAiProvider — custom prompt + reply, and the safe default ============
//
// A Superadmin can pass a CUSTOM prompt to actually exercise a saved provider and
// read its reply (for debugging a provider that times out / misbehaves). These
// pin the contract:
//   - a custom prompt returns the model's `reply` text (both provider shapes);
//   - the bare no-prompt ping returns NO reply body (only ok + latency);
//   - maxTokens is clamped to the 1024 cap;
//   - a slow provider is aborted with a readable message (the 524 case);
//   - the API key/model are never leaked in the response.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { saveAiProvider, testAiProvider } from '../src/aiConfig.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };

function makeEnv() {
  return {
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    AI_CONFIG_SECRET: 'a-very-strong-random-secret-value-123456',
  };
}

// Stub globalThis.fetch. `handler(url, opts)` returns { status, body } (body is an
// object -> JSON) or throws. Captures the parsed request bodies for assertions.
function stubFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    let parsed = null;
    try { parsed = JSON.parse(opts.body); } catch (e) { parsed = null; }
    calls.push({ url, opts, body: parsed });
    const r = await handler(url, opts, parsed);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body || '')),
    };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

async function addProvider(env, over = {}) {
  const res = await saveAiProvider(env, {
    name: 'NIM', type: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'deepseek-ai/deepseek-v4', apiKey: 'test-key-abcdefg', ...over,
  }, SUPER);
  return res.providerId;
}

test('a custom prompt returns the model reply (openai-compatible shape)', async () => {
  const env = makeEnv();
  const id = await addProvider(env);
  const { calls, restore } = stubFetch(async () => ({
    status: 200, body: { choices: [{ message: { role: 'assistant', content: 'pong-42' } }] },
  }));
  let res;
  try {
    res = await testAiProvider(env, id, SUPER, { prompt: 'say pong-42' });
  } finally { restore(); }

  assert.equal(res.ok, true);
  assert.equal(res.reply, 'pong-42');
  assert.ok(typeof res.latencyMs === 'number');
  // The request carried the custom prompt and a non-trivial token budget.
  assert.equal(calls[0].body.messages[0].content, 'say pong-42');
  assert.equal(calls[0].body.max_tokens, 256);
  // No secret leaks back to the caller.
  assert.equal('apiKey' in res, false);
  assert.equal(res.reply.includes('test-key'), false);
});

test('a custom prompt returns the model reply (anthropic shape)', async () => {
  const env = makeEnv();
  const id = await addProvider(env, { type: 'anthropic', baseUrl: '', model: 'claude-x' });
  const { restore } = stubFetch(async () => ({
    status: 200, body: { content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] },
  }));
  let res;
  try {
    res = await testAiProvider(env, id, SUPER, { prompt: 'greet' });
  } finally { restore(); }

  assert.equal(res.ok, true);
  assert.equal(res.reply, 'hello world');
});

test('the bare no-prompt ping returns NO reply body (only ok + latency)', async () => {
  const env = makeEnv();
  const id = await addProvider(env);
  const { calls, restore } = stubFetch(async () => ({
    status: 200, body: { choices: [{ message: { content: 'should-not-be-returned' } }] },
  }));
  let res;
  try {
    res = await testAiProvider(env, id, SUPER); // no opts
  } finally { restore(); }

  assert.equal(res.ok, true);
  assert.ok(!res.reply, 'a plain ping must not return the model text');
  assert.equal(calls[0].body.messages[0].content, 'ping');
  assert.equal(calls[0].body.max_tokens, 8);
});

test('maxTokens is clamped to the 1024 cap', async () => {
  const env = makeEnv();
  const id = await addProvider(env);
  const { calls, restore } = stubFetch(async () => ({ status: 200, body: { choices: [{ message: { content: 'x' } }] } }));
  try {
    await testAiProvider(env, id, SUPER, { prompt: 'hi', maxTokens: 999999 });
  } finally { restore(); }
  assert.equal(calls[0].body.max_tokens, 1024);
});

test('a non-2xx response surfaces the status + body (with a 524 hint)', async () => {
  const env = makeEnv();
  const id = await addProvider(env);
  const { restore } = stubFetch(async () => ({ status: 524, body: 'error code: 524' }));
  let res;
  try {
    res = await testAiProvider(env, id, SUPER, { prompt: 'hi' });
  } finally { restore(); }
  assert.equal(res.ok, false);
  assert.equal(res.status, 524);
  assert.match(res.message, /HTTP 524/);
  assert.match(res.message, /took too long/i);
});

test('a hanging provider is aborted with a clear timeout message', async () => {
  const env = makeEnv();
  const id = await addProvider(env);
  // Simulate the AbortController firing: throw an AbortError like fetch would.
  const { restore } = stubFetch(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  let res;
  try {
    res = await testAiProvider(env, id, SUPER, { prompt: 'hi' });
  } finally { restore(); }
  assert.equal(res.ok, false);
  assert.match(res.message, /timed out/i);
  assert.match(res.message, /524/);
});

test('an over-long prompt is rejected before any request is made', async () => {
  const env = makeEnv();
  const id = await addProvider(env);
  const { calls, restore } = stubFetch(async () => ({ status: 200, body: {} }));
  try {
    await assert.rejects(
      () => testAiProvider(env, id, SUPER, { prompt: 'x'.repeat(8001) }),
      /too long/i
    );
  } finally { restore(); }
  assert.equal(calls.length, 0, 'no network call for a rejected prompt');
});

test('still Superadmin-only', async () => {
  const env = makeEnv();
  const id = await addProvider(env);
  await assert.rejects(() => testAiProvider(env, id, { name: 'x', role: 'Admin' }, { prompt: 'hi' }), /Superadmin/);
});
