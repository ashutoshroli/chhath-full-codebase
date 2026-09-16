// ============ THE RENDER CALLBACK CLAIMS BEFORE IT ACTS ============
//
// Three HIGH findings, all in the same handler.
//
// MGMT-BE-02 — the idempotency check was a SELECT, and everything expensive happened between
// it and the write that finalised the row:
//
//     const row = await SELECT ... ;
//     if (row.status === 'completed' || row.status === 'failed') return;   // <- the check
//     await applyResultSideEffect(...);                                   // <- R2, GitHub
//     await UPDATE ... SET status='completed';                             // <- the write
//
// Two callbacks arriving together — Render retrying, a webhook delivered twice, a reconcile
// racing a late reply — both read `dispatched`, both pass, and both run the side effect. For
// `pdf_convert` that writes the PDF to R2 and inserts into `generated_files` twice; for
// `ai_pr_create` it opens a second pull request. Sequential idempotency is not idempotency.
//
// MGMT-BE-03 — reconciliation re-dispatched with the STORED payload, which for
// `pdf_convert_batch` and `provider_test` is metadata only (the base64 documents and the API
// key are deliberately not persisted). The retry cannot succeed; it can only fail slowly, or
// half-run, while the original attempt may still be doing irreversible Drive work.
//
// MGMT-BE-04 — the router bumps the public data version at DISPATCH, but the
// `generated_files` index the public portal reads is written when the CALLBACK arrives,
// minutes later. So the public payload cached against the dispatch-time version does not
// contain the document that was just generated.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { handleRenderCallback, reconcileStuckJobs, getRenderJobStatus } from '../src/renderJobs.js';

function makeEnv(extra = {}) {
  return {
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    KV_SESSIONS: makeKV(),
    RENDER_SERVICE_URL: 'https://render.example.test',
    RENDER_API_KEY: 'k',
    RENDER_WEBHOOK_SECRET: 's',
    ...extra,
  };
}

const jobsDb = (env) => env.DB_MISC;

async function seedJob(env, { jobId, kind, status = 'dispatched', payload = {}, dispatchedAt = new Date().toISOString(), attempts = 1 }) {
  await jobsDb(env).prepare(
    `INSERT INTO render_jobs (job_id, kind, status, payload, ref_id, attempts, max_attempts, created_at, dispatched_at)
     VALUES (?, ?, ?, ?, ?, ?, 3, ?, ?)`
  ).bind(jobId, kind, status, JSON.stringify(payload), 'ref-1', attempts, new Date().toISOString(), dispatchedAt).run();
}

const rowOf = (env, jobId) =>
  jobsDb(env).prepare('SELECT * FROM render_jobs WHERE job_id = ?').bind(jobId).first();

describe('a callback claims the row before doing anything (MGMT-BE-02)', () => {
  test('two callbacks for one job run the side effect ONCE', async () => {
    const env = makeEnv();
    await seedJob(env, { jobId: 'J1', kind: 'ai_fix_generate' });

    // Both callbacks are in flight before either finishes — the exact race.
    const [a, b] = await Promise.all([
      handleRenderCallback(env, { jobId: 'J1', status: 'completed', result: { diff: 'd' } }),
      handleRenderCallback(env, { jobId: 'J1', status: 'completed', result: { diff: 'd' } }),
    ]);

    const applied = [a, b].filter((r) => r.applied);
    assert.equal(applied.length, 1, 'exactly one callback may apply the result');
    const loser = [a, b].find((r) => !r.applied);
    assert.equal(loser.success, true, 'and the loser still acks — a webhook must not be retried forever');
    assert.match(loser.message, /already/);
  });

  test('the claim is the UPDATE, so only one caller can move the row', async () => {
    const env = makeEnv();
    await seedJob(env, { jobId: 'J2', kind: 'ai_fix_generate' });

    const first = await handleRenderCallback(env, { jobId: 'J2', status: 'completed', result: {} });
    assert.equal(first.applied, true);
    assert.equal((await rowOf(env, 'J2')).status, 'completed');

    // A late duplicate after the row is final.
    const late = await handleRenderCallback(env, { jobId: 'J2', status: 'completed', result: {} });
    assert.equal(late.applied, false);
    assert.match(late.message, /already finalized/);
  });

  test('a job that is neither pending nor dispatched cannot be claimed', async () => {
    const env = makeEnv();
    // A row already being applied by someone else.
    await seedJob(env, { jobId: 'J3', kind: 'ai_fix_generate', status: 'applying@2026-09-15T00:00:00.000Z' });
    const res = await handleRenderCallback(env, { jobId: 'J3', status: 'completed', result: {} });
    assert.equal(res.applied, false, 'a concurrent apply must not be duplicated');
    assert.equal(res.success, true);
  });

  test('an unknown job is reported, not claimed', async () => {
    const res = await handleRenderCallback(makeEnv(), { jobId: 'nope', status: 'completed' });
    assert.equal(res.success, false);
    assert.match(res.message, /unknown job/);
  });

  test('the claim marker is not shown to a client as-is', async () => {
    const env = makeEnv();
    await seedJob(env, { jobId: 'J4', kind: 'pdf_convert', status: 'applying@2026-09-15T00:00:00.000Z' });
    const res = await getRenderJobStatus(env, 'J4', { name: 'root', role: 'Superadmin' });
    // The timestamp is server bookkeeping; a client polls until completed/failed, and
    // `applying` is neither, so polling continues correctly.
    assert.equal(res.job.status, 'applying');
    assert.ok(!res.job.status.includes('@'));
  });
});

describe('a claim that died is failed, never retried (MGMT-BE-02)', () => {
  test('a stuck applying row becomes failed with an actionable message', async () => {
    const env = makeEnv();
    const old = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await seedJob(env, { jobId: 'J5', kind: 'pdf_convert', status: `applying@${old}` });

    const out = await reconcileStuckJobs(env);
    assert.ok(out.reconciled >= 1);

    const row = await rowOf(env, 'J5');
    assert.equal(row.status, 'failed');
    // Re-running is exactly the duplicate R2 write / duplicate PR the claim prevents, so the
    // operator is told the work may be half done rather than it being silently repeated.
    assert.match(row.error, /NOT retried automatically/);
    assert.ok(row.finished_at);
  });

  test('a RECENT applying row is left alone', async () => {
    const env = makeEnv();
    await seedJob(env, { jobId: 'J6', kind: 'pdf_convert', status: `applying@${new Date().toISOString()}` });
    await reconcileStuckJobs(env);
    assert.match((await rowOf(env, 'J6')).status, /^applying@/, 'a side effect in progress must not be interrupted');
  });
});

describe('a job whose payload was never stored is not retried (MGMT-BE-03)', () => {
  const stale = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  for (const kind of ['pdf_convert_batch', 'provider_test']) {
    test(`${kind} times out instead of being re-dispatched`, async () => {
      const env = makeEnv();
      let posted = 0;
      const orig = globalThis.fetch;
      globalThis.fetch = async () => { posted++; return { ok: true, json: async () => ({}) }; };
      try {
        // attempts: 1 of 3 — under the old code this had retries left and WOULD be re-sent.
        await seedJob(env, { jobId: `S-${kind}`, kind, status: 'dispatched', dispatchedAt: stale(), attempts: 1, payload: { count: 5 } });
        await reconcileStuckJobs(env);

        const row = await rowOf(env, `S-${kind}`);
        assert.equal(row.status, 'failed');
        assert.match(row.error, /cannot be retried automatically/);
        // The stored payload is metadata only, so a re-dispatch could not have worked — and
        // the original attempt may still be doing irreversible Drive work.
        assert.equal(posted, 0, 'nothing was re-sent to Render');
      } finally { globalThis.fetch = orig; }
    });
  }

  test('a reconstructable kind IS still re-dispatched', async () => {
    const env = makeEnv();
    let posted = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = async () => { posted++; return { ok: true, json: async () => ({ jobId: 'r1' }) }; };
    try {
      await seedJob(env, { jobId: 'S-ai', kind: 'ai_fix_generate', status: 'dispatched', dispatchedAt: stale(), attempts: 1, payload: { errorId: 'E1' } });
      await reconcileStuckJobs(env);
      assert.equal(posted, 1, 'the AI kinds store their full reference payload, so a retry is safe');
      assert.equal((await rowOf(env, 'S-ai')).status, 'dispatched');
    } finally { globalThis.fetch = orig; }
  });
});

describe('a generated document reaches the public portal (MGMT-BE-04)', () => {
  async function versionOf(env) {
    const row = await env.DB_CORE.prepare('SELECT value FROM portal_settings WHERE "key" = ?')
      .bind('public_data_version').first();
    return row ? row.value : null;
  }

  test('a completed pdf_convert bumps the public data version', async () => {
    const env = makeEnv();
    await env.DB_CORE.prepare('INSERT INTO portal_settings ("key", value) VALUES (?, ?)')
      .bind('public_data_version', '4').run();
    await seedJob(env, { jobId: 'P1', kind: 'pdf_convert', payload: { docType: 'receipt', year: 2026, recordId: 'receipt-2026-1' } });

    const before = await versionOf(env);
    await handleRenderCallback(env, { jobId: 'P1', status: 'completed', result: {} });

    // The router bumps at DISPATCH; the file index is written HERE, minutes later. Without
    // this bump the public payload cached against the dispatch-time version does not contain
    // the document, and a visitor following its QR code is told it does not exist.
    assert.notEqual(await versionOf(env), before, 'the version must move when the index is written');
  });

  test('a completed ai_fix_generate does NOT bump it', async () => {
    const env = makeEnv();
    await env.DB_CORE.prepare('INSERT INTO portal_settings ("key", value) VALUES (?, ?)')
      .bind('public_data_version', '4').run();
    await seedJob(env, { jobId: 'P2', kind: 'ai_fix_generate' });

    await handleRenderCallback(env, { jobId: 'P2', status: 'completed', result: { diff: 'd' } });
    assert.equal(await versionOf(env), '4', 'an AI fix changes nothing the public portal reads');
  });

  test('a bump failure does not turn a completed job into a failed one', async () => {
    // A version that did not move is a stale portal; a throw here would re-run the side
    // effect on retry, which is the duplicate-write problem again.
    const env = makeEnv();
    env.DB_CORE = {
      prepare() {
        const boom = async () => { throw new Error('D1_ERROR: core unavailable'); };
        const stmt = { bind: () => stmt, all: boom, first: boom, run: boom };
        return stmt;
      },
    };
    await seedJob(env, { jobId: 'P3', kind: 'pdf_convert', payload: { docType: 'receipt', year: 2026 } });

    const res = await handleRenderCallback(env, { jobId: 'P3', status: 'completed', result: {} });
    assert.equal(res.applied, true);
    assert.equal((await rowOf(env, 'P3')).status, 'completed');
  });
});

describe('a reported failure still finalises the row', () => {
  test('status failed is recorded with the reason', async () => {
    const env = makeEnv();
    await seedJob(env, { jobId: 'F1', kind: 'ai_fix_generate' });
    const res = await handleRenderCallback(env, { jobId: 'F1', status: 'failed', error: 'model refused' });
    assert.equal(res.applied, true);
    const row = await rowOf(env, 'F1');
    assert.equal(row.status, 'failed');
    assert.match(row.error, /model refused/);
  });

  test('a duplicate failure callback is a no-op', async () => {
    const env = makeEnv();
    await seedJob(env, { jobId: 'F2', kind: 'ai_fix_generate' });
    await handleRenderCallback(env, { jobId: 'F2', status: 'failed', error: 'x' });
    const again = await handleRenderCallback(env, { jobId: 'F2', status: 'failed', error: 'x' });
    assert.equal(again.applied, false);
  });
});
