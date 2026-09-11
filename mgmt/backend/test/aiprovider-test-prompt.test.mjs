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
import { readFileSync } from 'node:fs';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { saveAiProvider, testAiProvider } from '../src/aiConfig.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };

// logs.sql defines ai_providers WITHOUT the `purpose` column (that column is added
// by migration 24). saveAiProvider now writes purpose, so bring the test DB up to
// the migrated schema — same pattern the 2FA test uses for the totp columns.
function logsSchemaWithPurpose() {
  const m24 = readFileSync(new URL('../../db/migration/2026-09-05/24-ai-providers-purpose.sql', import.meta.url), 'utf8');
  const m25 = readFileSync(new URL('../../db/migration/2026-09-05/25-ai-providers-priority.sql', import.meta.url), 'utf8');
  const m26 = readFileSync(new URL('../../db/migration/2026-09-05/26-ai-providers-data-mode.sql', import.meta.url), 'utf8');
  return schemaFor('logs.sql') + '\n' + m24 + '\n' + m25 + '\n' + m26;
}

function makeEnv() {
  return {
    DB_LOGS: makeD1(logsSchemaWithPurpose()),
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

// ---- OFFLOAD to Render (slow models exceed the Worker's 30s cap -> HTTP 524) ----

test('when Render is configured, the test is DISPATCHED and returns a jobId', async () => {
  const env = makeEnv();
  // render_jobs lives in DB_MISC; add it + the Render config.
  env.DB_MISC = makeD1(schemaFor('misc.sql'));
  env.RENDER_SERVICE_URL = 'https://render.example.test';
  env.RENDER_API_KEY = 'render-key';
  const id = await addProvider(env);

  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 202, json: async () => ({ renderJobId: 'r1' }) }; };
  let res;
  try {
    res = await testAiProvider(env, id, SUPER, { prompt: 'say hi' });
  } finally { globalThis.fetch = orig; }

  assert.equal(res.dispatched, true);
  assert.ok(res.jobId && res.jobId.startsWith('RJOB'));
  assert.equal(res.via, 'render');
  // The decrypted key WAS sent to Render (in the outbound body)...
  const sent = calls[0].body;
  assert.equal(sent.kind, 'provider_test');
  assert.equal(sent.payload.prompt, 'say hi');
  assert.ok(sent.payload.apiKey, 'the key travels to Render in the request body');
});

test('the decrypted key is NEVER persisted on the render_jobs row', async () => {
  const env = makeEnv();
  env.DB_MISC = makeD1(schemaFor('misc.sql'));
  env.RENDER_SERVICE_URL = 'https://render.example.test';
  env.RENDER_API_KEY = 'render-key';
  const id = await addProvider(env, { apiKey: 'super-secret-key-xyz' });

  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 202, json: async () => ({ renderJobId: 'r1' }) });
  let res;
  try {
    res = await testAiProvider(env, id, SUPER, { prompt: 'hi' });
  } finally { globalThis.fetch = orig; }

  const row = await env.DB_MISC.prepare('SELECT payload FROM render_jobs WHERE job_id = ?').bind(res.jobId).first();
  assert.ok(row, 'the job row exists');
  assert.equal(row.payload.includes('super-secret-key-xyz'), false, 'the decrypted key must NOT be in the stored payload');
  assert.equal(row.payload.includes('apiKey'), false, 'no apiKey field is persisted at all');
});

test('when Render is NOT configured, it still answers synchronously (fallback)', async () => {
  const env = makeEnv(); // no RENDER_SERVICE_URL
  const id = await addProvider(env);
  const { restore } = stubFetch(async () => ({ status: 200, body: { choices: [{ message: { content: 'sync-ok' } }] } }));
  let res;
  try {
    res = await testAiProvider(env, id, SUPER, { prompt: 'hi' });
  } finally { restore(); }
  assert.equal(res.ok, true);
  assert.equal(res.reply, 'sync-ok');
  assert.ok(!res.jobId, 'no dispatch when Render is absent');
});
