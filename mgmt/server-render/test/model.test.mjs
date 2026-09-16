// callModel must honour the provider the Worker sends (custom / OpenAI-compatible /
// default Anthropic), and fall back to the service's env Anthropic when none is
// given. We stub globalThis.fetch to capture WHICH endpoint + headers were used.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// config needs these at import time.
process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'env-anthropic-key';
process.env.AI_FIX_MODEL ||= 'claude-sonnet-4-5-20250929';

// Provider calls now resolve the base URL host before the API key is sent (audit
// Render/offload #6). These fixtures use `.test` hostnames, and `.test` never resolves — so
// the suite supplies a resolver rather than the policy supplying an escape hatch.
import { installPublicDns } from './helpers/dnsStub.mjs';
installPublicDns();


const { callModel } = await import('../src/lib/model.js');

const GOOD_JSON = JSON.stringify({ reasoning: 'r', diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' });

function stub(kind) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    if (kind === 'anthropic') {
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: GOOD_JSON }], usage: { input_tokens: 5, output_tokens: 6 } }) };
    }
    // openai-compatible
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: GOOD_JSON } }], usage: { prompt_tokens: 7, completion_tokens: 8 } }) };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const ERR = { message: 'boom', stack: '', context: '', source: 's', page: 'p' };

test('custom openai-compatible provider hits <baseUrl>/chat/completions with Bearer', async () => {
  const { calls, restore } = stub('openai');
  try {
    const res = await callModel({
      provider: { type: 'openai-compatible', apiKey: 'sk-custom', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      errorRow: ERR, files: [],
    });
    assert.equal(res.diff.startsWith('diff --git'), true);
    assert.equal(res.model, 'gpt-4o');
    assert.match(calls[0].url, /api\.openai\.com\/v1\/chat\/completions$/);
    assert.equal(calls[0].headers.Authorization, 'Bearer sk-custom');
  } finally { restore(); }
});

test('anthropic provider hits the Anthropic endpoint with x-api-key + its model', async () => {
  const { calls, restore } = stub('anthropic');
  try {
    const res = await callModel({
      provider: { type: 'anthropic', apiKey: 'sk-ant-custom', baseUrl: '', model: 'claude-x' },
      errorRow: ERR, files: [],
    });
    assert.equal(res.model, 'claude-x');
    assert.match(calls[0].url, /api\.anthropic\.com\/v1\/messages$/);
    assert.equal(calls[0].headers['x-api-key'], 'sk-ant-custom');
  } finally { restore(); }
});

test('no provider -> falls back to the service env Anthropic key/model', async () => {
  const { calls, restore } = stub('anthropic');
  try {
    const res = await callModel({ errorRow: ERR, files: [] });
    assert.match(calls[0].url, /api\.anthropic\.com/);
    assert.equal(calls[0].headers['x-api-key'], 'env-anthropic-key');
    assert.equal(res.model, 'claude-sonnet-4-5-20250929');
  } finally { restore(); }
});

test('openai-compatible without a baseUrl fails clearly', async () => {
  const { restore } = stub('openai');
  try {
    await assert.rejects(
      () => callModel({ provider: { type: 'openai-compatible', apiKey: 'k', baseUrl: '', model: 'm' }, errorRow: ERR, files: [] }),
      /missing a base URL/
    );
  } finally { restore(); }
});
