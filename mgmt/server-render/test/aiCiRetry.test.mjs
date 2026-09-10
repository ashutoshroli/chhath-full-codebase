// Unit test for the ai_ci_retry job's input validation. The full happy path hits
// GitHub + Anthropic (network), so here we only pin the guard that a malformed
// payload fails fast and clearly (no half-done commits). Config env is provided so
// the module's transitive config import doesn't throw at load.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Provide the env config needs BEFORE importing anything that pulls in config.js.
process.env.RENDER_API_KEY ||= 'test-render-api-key';
process.env.RENDER_WEBHOOK_SECRET ||= 'test-render-webhook-secret';
process.env.WORKER_WEBHOOK_URL ||= 'https://worker.test/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'test-gh-token';
process.env.GITHUB_REPO ||= 'ashutoshroli/chhath-full-codebase';
process.env.ANTHROPIC_API_KEY ||= 'test-anthropic-key';

const { runAiCiRetry } = await import('../src/jobs/aiCiRetry.js');

test('ai_ci_retry rejects a payload missing branch/prevDiff', async () => {
  await assert.rejects(() => runAiCiRetry({}), /branch and payload.prevDiff are required/);
  await assert.rejects(() => runAiCiRetry({ branch: 'fix/error-X' }), /prevDiff are required/);
  await assert.rejects(() => runAiCiRetry({ prevDiff: 'd' }), /branch/);
});
