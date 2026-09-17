// The per-route body limits, asserted against the REAL Express app (audit follow-up).
//
// THE DEFECT THIS PINS. Both routers mount at '/', and the body parsers were mounted
// at '/' too — so BOTH ran on every request, in order. The chat parser (a tight 16 KB)
// ran first and rejected any POST /jobs body over 16 KB with a 413 before jobsRouter's
// 11 MB parser ever saw it. It was invisible while jobs carried only small AI references;
// docx_render posts the ~300 KB template bytes and hit it immediately (HTTP 413
// "Payload Too Large"), so no receipt could ever be generated server-side.
//
// This boots the actual app (no port) and drives real HTTP at it, so it fails on the
// bug and passes on the fix — a unit test of the mount code would not have caught it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// config.js validates required env at import time; give it throwaway values so the
// real server module (and its real parser wiring) can load.
process.env.RENDER_API_KEY ||= 'test-key';
process.env.RENDER_WEBHOOK_SECRET ||= 'test-webhook-secret';
process.env.WORKER_WEBHOOK_URL ||= 'https://example.invalid/?render-webhook=1';
process.env.GITHUB_TOKEN ||= 'test-gh-token';
process.env.GITHUB_REPO ||= 'owner/repo';
process.env.ANTHROPIC_API_KEY ||= 'test-anthropic';

const { app } = await import('../src/server.js');

let server, base;
before(async () => {
  server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

// A JSON body whose serialized size is about `kb` kilobytes.
function bodyOfSize(kb, extra = {}) {
  return JSON.stringify({ ...extra, filler: 'A'.repeat(kb * 1024) });
}

async function post(path, body, headers = {}) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return res.status;
}

test('POST /jobs accepts a ~300 KB body (the docx_render template) — not a 413', async () => {
  // ~300 KB is the real docx_render payload size (a 227 KB .docx as base64). The bug
  // returned 413 here. With the fix, the jobs parser (11 MB) accepts the body and the
  // request reaches jobsRouter, which — with no valid X-Render-Api-Key — answers 401.
  // 401 proves the BODY got through; the auth layer is a separate concern.
  const status = await post('/jobs', bodyOfSize(300, { jobId: 'x', kind: 'docx_render' }));
  assert.notEqual(status, 413, 'POST /jobs must not be rejected for body size at 300 KB');
  assert.equal(status, 401, 'reached jobsRouter (unauthenticated) — body accepted');
});

test('POST /jobs still rejects an absurd body (over the 11 MB jobs limit)', async () => {
  const status = await post('/jobs', bodyOfSize(12 * 1024, { jobId: 'x', kind: 'docx_render' }));
  assert.equal(status, 413, 'a body over the jobs limit is still refused');
});

test('POST /public-chat keeps its tight 16 KB limit — a 300 KB body is a 413', async () => {
  // The chat route must NOT inherit the jobs allowance. A 300 KB chat body is refused.
  const status = await post('/public-chat', bodyOfSize(300), { Origin: 'https://chhath.shaharpura.com' });
  assert.equal(status, 413, 'the chat route stays tight');
});

test('POST /public-chat accepts a small body (reaches the router, not a 413)', async () => {
  const status = await post('/public-chat', JSON.stringify({ message: 'hi' }), {
    Origin: 'https://chhath.shaharpura.com',
  });
  assert.notEqual(status, 413, 'a small chat body must not be rejected for size');
});
