// ai_fix_generate forwards the Worker's developer guidance (payload.extraContext)
// into the model prompt. fetch is stubbed; the errorRow has no file paths, so no
// GitHub calls happen and the only request is the model call — we assert its user
// message carries the guidance.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.RENDER_API_KEY ||= 'k';
process.env.RENDER_WEBHOOK_SECRET ||= 'k';
process.env.WORKER_WEBHOOK_URL ||= 'https://w.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'gh';
process.env.GITHUB_REPO ||= 'o/r';
process.env.ANTHROPIC_API_KEY ||= 'a';

const { runAiFixGenerate } = await import('../src/jobs/aiFixGenerate.js');

const PROVIDER = { type: 'openai-compatible', apiKey: 'key', baseUrl: 'https://model.test/v1', model: 'm' };
const DIFF_JSON = JSON.stringify({ reasoning: 'ok', diff: 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n' });

function stubModel() {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: DIFF_JSON } }] }), text: async () => DIFF_JSON };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const userMsgOf = (calls) => {
  const modelCall = calls.find(c => c.url.includes('/chat/completions'));
  return modelCall.body.messages.find(m => m.role === 'user').content;
};

test('guidance in payload.extraContext reaches the model prompt', async () => {
  const { calls, restore } = stubModel();
  try {
    await runAiFixGenerate({
      provider: PROVIDER,
      errorRow: { message: 'boom', stack: '(no file paths here)', context: '' },
      extraContext: 'DEVELOPER GUIDANCE for this fix attempt (follow it):\nRead VITE_API_URL, do not hardcode the domain.',
    });
  } finally { restore(); }

  const userMsg = userMsgOf(calls);
  assert.match(userMsg, /ADDITIONAL CONTEXT/);
  assert.match(userMsg, /DEVELOPER GUIDANCE/);
  assert.match(userMsg, /Read VITE_API_URL/);
});

test('without extraContext the prompt has no ADDITIONAL CONTEXT block', async () => {
  const { calls, restore } = stubModel();
  try {
    await runAiFixGenerate({
      provider: PROVIDER,
      errorRow: { message: 'boom', stack: '(no file paths)', context: '' },
    });
  } finally { restore(); }
  assert.doesNotMatch(userMsgOf(calls), /ADDITIONAL CONTEXT/);
});
