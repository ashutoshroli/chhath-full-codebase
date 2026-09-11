// callModel provider CHAIN fallback: it tries providers in order and falls
// through to the next ONLY on a retryable failure (429/5xx/timeout); a 4xx
// (bad model/key) stops immediately. fetch is stubbed; no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';

const { callModel } = await import('../src/lib/model.js');

const DIFF_JSON = JSON.stringify({ reasoning: 'ok', diff: 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n' });
const oc = (model) => ({ type: 'openai-compatible', apiKey: 'k', baseUrl: 'https://p.test/v1', model });
const errorRow = { message: 'boom', stack: '', context: '' };

// handler(callIndex) -> { status, body }
function stubFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), model: body.model });
    const r = handler(calls.length - 1, body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
const okBody = { choices: [{ message: { content: DIFF_JSON } }], usage: {} };

test('first provider 429 -> falls through to the second which succeeds', async () => {
  const { calls, restore } = stubFetch((i) => (i === 0 ? { status: 429, body: 'rate limited' } : { status: 200, body: okBody }));
  let res;
  try {
    res = await callModel({ providers: [oc('primary'), oc('backup')], errorRow });
  } finally { restore(); }
  assert.ok(res.diff, 'got a diff from the backup');
  assert.equal(res.model, 'backup');
  assert.deepEqual(calls.map(c => c.model), ['primary', 'backup'], 'tried primary then backup');
});

test('first provider 500 also falls through', async () => {
  const { calls, restore } = stubFetch((i) => (i === 0 ? { status: 500, body: 'server error' } : { status: 200, body: okBody }));
  try { await callModel({ providers: [oc('p1'), oc('p2')], errorRow }); } finally { restore(); }
  assert.deepEqual(calls.map(c => c.model), ['p1', 'p2']);
});

test('a 400 (bad model/key) does NOT fall through — stops immediately', async () => {
  const { calls, restore } = stubFetch(() => ({ status: 400, body: 'bad request' }));
  await assert.rejects(async () => {
    try { return await callModel({ providers: [oc('p1'), oc('p2')], errorRow }); } finally { restore(); }
  }, /400/);
  assert.equal(calls.length, 1, 'a non-retryable 400 must not try the second provider');
});

test('all providers rate-limited -> throws the last error', async () => {
  const { calls, restore } = stubFetch(() => ({ status: 429, body: 'rate limited' }));
  await assert.rejects(async () => {
    try { return await callModel({ providers: [oc('p1'), oc('p2')], errorRow }); } finally { restore(); }
  }, /429/);
  assert.equal(calls.length, 2, 'both providers were tried');
});

test('back-compat: a single `provider` still works', async () => {
  const { calls, restore } = stubFetch(() => ({ status: 200, body: okBody }));
  let res;
  try { res = await callModel({ provider: oc('solo'), errorRow }); } finally { restore(); }
  assert.ok(res.diff);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'solo');
});
