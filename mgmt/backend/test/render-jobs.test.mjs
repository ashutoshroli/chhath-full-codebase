// ============ Render offload — job orchestration (Worker side) ============
//
// Exercises renderJobs.js against the real render_jobs schema (+ migration) with
// SQLite/Map stubs and a stubbed globalThis.fetch for the Worker->Render POST.
// Covers: create+dispatch (success + failure), the shared-secret webhook verify,
// idempotent callback handling, reconciliation of stuck jobs, references-only
// payload, and Superadmin-only status read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import {
  createAndDispatchJob, handleRenderCallback, reconcileStuckJobs,
  getRenderJobStatus, verifyRenderWebhookSecret,
} from '../src/renderJobs.js';

// misc.sql already contains render_jobs; the migration is idempotent, so applying
// it on top is a no-op — we just build from the committed schema.
function miscSchema() {
  return schemaFor('misc.sql');
}

function makeEnv(extra = {}) {
  return {
    DB_MISC: makeD1(miscSchema()),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    KV_SESSIONS: makeKV(),
    RENDER_SERVICE_URL: 'https://render.example.test',
    RENDER_API_KEY: 'render-api-key-abc',
    RENDER_WEBHOOK_SECRET: 'render-webhook-secret-xyz',
    ...extra,
  };
}

// Stub globalThis.fetch for the Worker->Render POST. `mode`: 'ok' | 'fail' | 'throw'.
function stubRenderFetch(mode = 'ok') {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, headers: opts && opts.headers, body: opts && opts.body });
    if (mode === 'throw') throw new Error('network down');
    if (mode === 'fail') return { ok: false, status: 500, text: async () => 'render error' };
    return { ok: true, status: 202, json: async () => ({ renderJobId: 'render-123' }) };
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

function rowFor(env, jobId) {
  // renderJobs stores under job_id; read it back through the D1 stub.
  return env.DB_MISC.prepare('SELECT * FROM render_jobs WHERE job_id = ?').bind(jobId).first();
}

const SUPER = { name: 'USER0001', role: 'Superadmin', th: 'x' };

test('createAndDispatchJob: inserts a row, POSTs to Render with X-Render-Api-Key, marks dispatched', async () => {
  const env = makeEnv();
  const { calls, restore } = stubRenderFetch('ok');
  try {
    const res = await createAndDispatchJob(env, 'ai_fix_generate', { errorId: 'ERR9' }, { refId: 'FIX9', createdBy: 'USER0001' });
    assert.equal(res.success, true);
    assert.equal(res.status, 'dispatched');
    assert.match(res.jobId, /^RJOB/);

    // One POST to <url>/jobs with the shared secret header.
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/jobs$/);
    assert.equal(calls[0].headers['X-Render-Api-Key'], 'render-api-key-abc');
    // Payload carries the jobId + kind + references only (no big blobs).
    const sent = JSON.parse(calls[0].body);
    assert.equal(sent.jobId, res.jobId);
    assert.equal(sent.kind, 'ai_fix_generate');
    assert.deepEqual(sent.payload, { errorId: 'ERR9' });

    const row = await rowFor(env, res.jobId);
    assert.equal(row.status, 'dispatched');
    assert.equal(row.ref_id, 'FIX9');
    assert.equal(Number(row.attempts), 1);
    assert.equal(row.render_job_id, 'render-123');
  } finally { restore(); }
});

test('createAndDispatchJob: a Render POST failure parks the job as failed', async () => {
  const env = makeEnv();
  const { restore } = stubRenderFetch('fail');
  try {
    const res = await createAndDispatchJob(env, 'ai_pr_create', { fixId: 'FIX9' }, {});
    assert.equal(res.success, false);
    assert.equal(res.status, 'failed');
    const row = await rowFor(env, res.jobId);
    assert.equal(row.status, 'failed');
    assert.match(row.error || '', /HTTP 500/);
  } finally { restore(); }
});

test('createAndDispatchJob: a network throw is caught and parks the job failed (never throws)', async () => {
  const env = makeEnv();
  const { restore } = stubRenderFetch('throw');
  try {
    const res = await createAndDispatchJob(env, 'ai_fix_generate', { errorId: 'ERR1' }, {});
    assert.equal(res.success, false);
    const row = await rowFor(env, res.jobId);
    assert.equal(row.status, 'failed');
  } finally { restore(); }
});

test('createAndDispatchJob: missing RENDER_SERVICE_URL parks failed without a fetch', async () => {
  const env = makeEnv({ RENDER_SERVICE_URL: '' });
  const { calls, restore } = stubRenderFetch('ok');
  try {
    const res = await createAndDispatchJob(env, 'ai_fix_generate', { errorId: 'ERR1' }, {});
    assert.equal(res.success, false);
    assert.equal(calls.length, 0, 'no POST attempted without a URL');
    const row = await rowFor(env, res.jobId);
    assert.match(row.error || '', /RENDER_SERVICE_URL/);
  } finally { restore(); }
});

test('verifyRenderWebhookSecret: constant-time match / mismatch / missing', async () => {
  const env = makeEnv();
  assert.equal(await verifyRenderWebhookSecret(env, 'render-webhook-secret-xyz'), true);
  assert.equal(await verifyRenderWebhookSecret(env, 'wrong'), false);
  assert.equal(await verifyRenderWebhookSecret(env, ''), false);
  assert.equal(await verifyRenderWebhookSecret({ RENDER_WEBHOOK_SECRET: '' }, 'anything'), false);
  // The route-marker value from WORKER_WEBHOOK_URL "?render-webhook=1" must NOT be
  // mistaken for the secret — the route checks the header independently (bugfix:
  // a `query || header` short-circuit made "1" win and always 401'd).
  assert.equal(await verifyRenderWebhookSecret(env, '1'), false);
});

test('handleRenderCallback: success saves result + marks completed', async () => {
  const env = makeEnv();
  const { restore } = stubRenderFetch('ok');
  let jobId;
  try {
    const res = await createAndDispatchJob(env, 'ai_fix_generate', { errorId: 'ERR9' }, { refId: 'FIX9' });
    jobId = res.jobId;
  } finally { restore(); }

  const cb = await handleRenderCallback(env, {
    jobId, status: 'completed', result: { diff: 'a diff', reasoning: 'because' },
  });
  assert.equal(cb.success, true);
  assert.equal(cb.applied, true);
  const row = await rowFor(env, jobId);
  assert.equal(row.status, 'completed');
  assert.match(row.result || '', /a diff/);
  assert.ok(row.finished_at);
});

test('handleRenderCallback: is IDEMPOTENT — a duplicate callback is a no-op', async () => {
  const env = makeEnv();
  const { restore } = stubRenderFetch('ok');
  let jobId;
  try {
    const res = await createAndDispatchJob(env, 'ai_fix_generate', { errorId: 'ERR9' }, {});
    jobId = res.jobId;
  } finally { restore(); }

  const first = await handleRenderCallback(env, { jobId, status: 'completed', result: { v: 1 } });
  assert.equal(first.applied, true);
  const second = await handleRenderCallback(env, { jobId, status: 'completed', result: { v: 2 } });
  assert.equal(second.applied, false, 'duplicate callback does not re-apply');
  const row = await rowFor(env, jobId);
  assert.match(row.result || '', /"v":1/, 'first result is retained, not overwritten');
});

test('handleRenderCallback: failure marks failed with the error', async () => {
  const env = makeEnv();
  const { restore } = stubRenderFetch('ok');
  let jobId;
  try {
    const res = await createAndDispatchJob(env, 'ai_pr_create', { fixId: 'FIX9' }, {});
    jobId = res.jobId;
  } finally { restore(); }

  const cb = await handleRenderCallback(env, { jobId, status: 'failed', error: 'Claude refused' });
  assert.equal(cb.success, true);
  const row = await rowFor(env, jobId);
  assert.equal(row.status, 'failed');
  assert.match(row.error || '', /Claude refused/);
});

test('handleRenderCallback: unknown jobId is a safe no-op', async () => {
  const env = makeEnv();
  const cb = await handleRenderCallback(env, { jobId: 'RJOBdoesnotexist', status: 'completed', result: {} });
  assert.equal(cb.applied, false);
});

test('reconcileStuckJobs: a stuck dispatched row with attempts left is re-dispatched', async () => {
  const env = makeEnv();
  // Seed a row that was dispatched 20 minutes ago (past the 10-min timeout), attempts=1.
  const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await env.DB_MISC.prepare(
    `INSERT INTO render_jobs (job_id, kind, status, payload, attempts, max_attempts, created_at, dispatched_at)
     VALUES ('RJOBstuck1','ai_fix_generate','dispatched','{"errorId":"ERR1"}',1,3,?,?)`
  ).bind(old, old).run();

  const { calls, restore } = stubRenderFetch('ok');
  try {
    const r = await reconcileStuckJobs(env);
    assert.equal(r.reconciled, 1);
    assert.equal(calls.length, 1, 're-dispatched via a fresh POST');
    const row = await rowFor(env, 'RJOBstuck1');
    assert.equal(row.status, 'dispatched');
    assert.equal(Number(row.attempts), 2, 'attempt counter advanced');
  } finally { restore(); }
});

test('reconcileStuckJobs: a stuck row at max attempts is timed out to failed', async () => {
  const env = makeEnv();
  const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await env.DB_MISC.prepare(
    `INSERT INTO render_jobs (job_id, kind, status, payload, attempts, max_attempts, created_at, dispatched_at)
     VALUES ('RJOBstuck2','ai_pr_create','dispatched','{}',3,3,?,?)`
  ).bind(old, old).run();

  const { calls, restore } = stubRenderFetch('ok');
  try {
    const r = await reconcileStuckJobs(env);
    assert.equal(r.reconciled, 1);
    assert.equal(calls.length, 0, 'no re-dispatch once attempts are exhausted');
    const row = await rowFor(env, 'RJOBstuck2');
    assert.equal(row.status, 'failed');
    assert.match(row.error || '', /timed out/i);
  } finally { restore(); }
});

test('reconcileStuckJobs: a recently dispatched row is left alone', async () => {
  const env = makeEnv();
  const recent = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago (well within the 10-min window)
  await env.DB_MISC.prepare(
    `INSERT INTO render_jobs (job_id, kind, status, payload, attempts, max_attempts, created_at, dispatched_at)
     VALUES ('RJOBfresh','ai_fix_generate','dispatched','{}',1,3,?,?)`
  ).bind(recent, recent).run();

  const { calls, restore } = stubRenderFetch('ok');
  try {
    const r = await reconcileStuckJobs(env);
    assert.equal(r.reconciled, 0);
    assert.equal(calls.length, 0);
    const row = await rowFor(env, 'RJOBfresh');
    assert.equal(row.status, 'dispatched', 'untouched');
  } finally { restore(); }
});

test('getRenderJobStatus: Superadmin-only; returns parsed status', async () => {
  const env = makeEnv();
  const { restore } = stubRenderFetch('ok');
  let jobId;
  try {
    const res = await createAndDispatchJob(env, 'ai_fix_generate', { errorId: 'ERR9' }, { refId: 'FIX9' });
    jobId = res.jobId;
  } finally { restore(); }
  await handleRenderCallback(env, { jobId, status: 'completed', result: { ok: true } });

  const st = await getRenderJobStatus(env, jobId, SUPER);
  assert.equal(st.success, true);
  assert.equal(st.job.status, 'completed');
  assert.equal(st.job.refId, 'FIX9');
  assert.deepEqual(st.job.result, { ok: true });

  // Non-Superadmin is rejected.
  await assert.rejects(() => getRenderJobStatus(env, jobId, { name: 'x', role: 'Admin' }), /Superadmin/);
});

test('createAndDispatchJob accepts the ai_ci_retry kind and dispatches it', async () => {
  const env = makeEnv();
  const { calls, restore } = stubRenderFetch('ok');
  try {
    const res = await createAndDispatchJob(env, 'ai_ci_retry', {
      fixId: 'AIF9', branch: 'fix/error-ERR9', prevDiff: 'diff', checkSuiteId: 123, attempts: 0,
    }, { refId: 'AIF9' });
    assert.equal(res.success, true);
    assert.equal(res.status, 'dispatched');
    const sent = JSON.parse(calls[0].body);
    assert.equal(sent.kind, 'ai_ci_retry');
    assert.equal(sent.payload.branch, 'fix/error-ERR9');
    const row = await rowFor(env, res.jobId);
    assert.equal(row.status, 'dispatched');
    assert.equal(row.ref_id, 'AIF9');
  } finally { restore(); }
});

test('createAndDispatchJob accepts the pdf_convert kind and dispatches it', async () => {
  const env = makeEnv();
  const { calls, restore } = stubRenderFetch('ok');
  try {
    const res = await createAndDispatchJob(env, 'pdf_convert', {
      docType: 'receipt', year: 2026, recordId: 'receipt-2026-45', base64: 'UEsDBfake', fileName: 'r.docx',
    }, { refId: 'receipt-2026-45' });
    assert.equal(res.success, true);
    const sent = JSON.parse(calls[0].body);
    assert.equal(sent.kind, 'pdf_convert');
    assert.equal(sent.payload.recordId, 'receipt-2026-45');
    const row = await rowFor(env, res.jobId);
    assert.equal(row.status, 'dispatched');
  } finally { restore(); }
});

test('applies the migration idempotently on top of the committed schema', () => {
  // The migration is CREATE ... IF NOT EXISTS, so running it against the schema
  // (which already has render_jobs) must be a no-op, not an error.
  const env = makeEnv();
  const migration = readFileSync(
    new URL('../../db/migration/2026-09-05/23-render-jobs.sql', import.meta.url), 'utf8'
  );
  assert.doesNotThrow(() => env.DB_MISC.exec(migration));
  assert.doesNotThrow(() => env.DB_MISC.exec(migration)); // twice
});
