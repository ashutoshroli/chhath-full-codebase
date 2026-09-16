// provider_test — the AI-provider connectivity/reply test, offloaded from the
// Worker (whose ~30s cap made slow reasoning models fail with HTTP 524). fetch is
// stubbed so no network is needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';

// Provider calls now resolve the base URL host before the API key is sent (audit
// Render/offload #6). These fixtures use `.test` hostnames, and `.test` never resolves — so
// the suite supplies a resolver rather than the policy supplying an escape hatch.
import { installPublicDns } from './helpers/dnsStub.mjs';
installPublicDns();


const { runProviderTest } = await import('../src/jobs/providerTest.js');

function stubFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    let body = null;
    try { body = JSON.parse(opts.body); } catch (e) { body = null; }
    calls.push({ url, opts, body });
    const r = await handler(url, opts, body);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body || '')),
    };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('requires type + apiKey', async () => {
  await assert.rejects(() => runProviderTest({}), /type and payload.apiKey/);
  await assert.rejects(() => runProviderTest({ type: 'anthropic' }), /type and payload.apiKey/);
});

test('openai-compatible: a custom prompt returns the model reply + latency', async () => {
  const { calls, restore } = stubFetch(async () => ({ status: 200, body: { choices: [{ message: { content: 'pong-77' } }] } }));
  let res;
  try {
    res = await runProviderTest({ type: 'openai-compatible', apiKey: 'test-key', baseUrl: 'https://x.test/v1', model: 'm', prompt: 'say pong-77' });
  } finally { restore(); }
  assert.equal(res.ok, true);
  assert.equal(res.reply, 'pong-77');
  assert.ok(typeof res.latencyMs === 'number');
  assert.equal(calls[0].body.messages[0].content, 'say pong-77');
  assert.equal(calls[0].body.max_tokens, 256);
  assert.equal('apiKey' in res, false);
});

test('anthropic: reply is joined from content[]', async () => {
  const { restore } = stubFetch(async () => ({ status: 200, body: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }));
  let res;
  try {
    res = await runProviderTest({ type: 'anthropic', apiKey: 'k', baseUrl: '', model: 'claude', prompt: 'hi' });
  } finally { restore(); }
  assert.equal(res.ok, true);
  assert.equal(res.reply, 'ab');
});

test('the bare ping returns no reply body and uses 8 tokens', async () => {
  const { calls, restore } = stubFetch(async () => ({ status: 200, body: { choices: [{ message: { content: 'hidden' } }] } }));
  let res;
  try {
    res = await runProviderTest({ type: 'openai-compatible', apiKey: 'k', baseUrl: 'https://x.test/v1', model: 'm' });
  } finally { restore(); }
  assert.equal(res.ok, true);
  assert.ok(!res.reply);
  assert.equal(calls[0].body.max_tokens, 8);
  assert.equal(calls[0].body.messages[0].content, 'ping');
});

test('maxTokens is clamped to 1024', async () => {
  const { calls, restore } = stubFetch(async () => ({ status: 200, body: { choices: [{ message: { content: 'x' } }] } }));
  try {
    await runProviderTest({ type: 'openai-compatible', apiKey: 'k', baseUrl: 'https://x.test/v1', model: 'm', prompt: 'hi', maxTokens: 99999 });
  } finally { restore(); }
  assert.equal(calls[0].body.max_tokens, 1024);
});

test('a non-2xx surfaces the status + body (never throws)', async () => {
  const { restore } = stubFetch(async () => ({ status: 524, body: 'error code: 524' }));
  let res;
  try {
    res = await runProviderTest({ type: 'openai-compatible', apiKey: 'k', baseUrl: 'https://x.test/v1', model: 'm', prompt: 'hi' });
  } finally { restore(); }
  assert.equal(res.ok, false);
  assert.equal(res.status, 524);
  assert.match(res.message, /HTTP 524/);
});

test('openai-compatible without a base URL fails cleanly (returns ok:false, no throw)', async () => {
  const res = await runProviderTest({ type: 'openai-compatible', apiKey: 'k', baseUrl: '', model: 'm', prompt: 'hi' });
  assert.equal(res.ok, false);
  assert.match(res.message, /missing a base URL/);
});
