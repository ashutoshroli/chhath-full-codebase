// ====== AUDIT P0-04 — a queued collection job must run exactly once ======
//
// processPendingJobs selected rows that were `pending`, or `processing` but STALE
// (older than STUCK_MINUTES). It then claimed each one with:
//
//     UPDATE collection_jobs SET status = 'processing', claimed_at = ?, attempts = attempts + 1
//      WHERE id = ? AND status IN ('pending', 'processing')
//
// The claim did NOT repeat the staleness cutoff. So a row that a concurrent drain
// had just claimed (status = 'processing', claimed_at = a second ago) still
// matched: both drains saw changes = 1 and both ran the job — a duplicate PDF in
// Drive, a duplicate WhatsApp message and a duplicate email to the contributor,
// double attempts and a racing finalise. The module comment even asserted that
// concurrent drains were safe.
//
// The claim now repeats the exact eligibility (pending, or processing AND stale),
// caps attempts, and writes a unique token into claimed_at which is re-read
// before the job runs — the verifiable-claim pattern whatsapp.js already uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { processPendingJobs, getQueueJobsForSuperadmin } from '../src/collectionQueue.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
const ISO = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

function makeEnv() {
  return {
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    KV_SESSIONS: makeKV(),
  };
}

// A job with no document and no new-entry flag: nothing to convert, nothing to
// send, so runOneJob is a no-op and the test is about the CLAIM only.
async function seedJob(env, over = {}) {
  const row = {
    job_id: 'JOB-1', status: 'pending', doc_type: '', year: '2026', record_id: null,
    is_new_entry: 0, payload: '{}', file_name: '', created_by: 'USER0001',
    attempts: 0, created_at: ISO(), claimed_at: null, ...over,
  };
  await env.DB_MISC.prepare(
    `INSERT INTO collection_jobs (job_id, status, doc_type, year, record_id, is_new_entry,
       payload, file_name, created_by, attempts, created_at, claimed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(row.job_id, row.status, row.doc_type, row.year, row.record_id, row.is_new_entry,
    row.payload, row.file_name, row.created_by, row.attempts, row.created_at, row.claimed_at).run();
  return row.job_id;
}

const job = (env, jobId = 'JOB-1') => env.DB_MISC
  .prepare('SELECT status, attempts, claimed_at, finished_at FROM collection_jobs WHERE job_id = ?')
  .bind(jobId).first();

// ================================================== 1. NO DOUBLE PROCESSING

test('P0-04: a job another drain just claimed is NOT claimed again', async () => {
  const env = makeEnv();
  await seedJob(env);

  // The rival drain claims the row between our SELECT and our UPDATE — a fresh
  // 'processing' claim, i.e. NOT stale.
  const realPrepare = env.DB_MISC.prepare.bind(env.DB_MISC);
  let fired = false;
  env.DB_MISC.prepare = (sql) => {
    if (!fired && /UPDATE collection_jobs\s+SET status = 'processing'/.test(sql)) {
      fired = true;
      realPrepare(
        `UPDATE collection_jobs SET status = 'processing', claimed_at = '${ISO()}#rival', attempts = attempts + 1 WHERE job_id = 'JOB-1'`
      ).bind().run();
    }
    return realPrepare(sql);
  };

  const res = await processPendingJobs(env);

  // On `main` this processes the job a second time (processed: 1) and finalises
  // a row the other drain is still working on.
  assert.equal(res.processed, 0, 'the job belongs to the drain that claimed it first');
  const j = await job(env);
  assert.equal(j.status, 'processing', 'the rival drain still owns it — not finalised here');
  assert.equal(j.attempts, 1, 'attempts moved once, not twice');
  assert.match(j.claimed_at, /#rival$/, "the rival's claim token is intact");
});

test('P0-04: an uncontended pending job is claimed, run and finalised', async () => {
  const env = makeEnv();
  await seedJob(env);

  const res = await processPendingJobs(env);

  assert.equal(res.processed, 1);
  const j = await job(env);
  assert.equal(j.status, 'done');
  assert.equal(j.attempts, 1);
  assert.ok(j.finished_at, 'finished_at is stamped');
});

test('P0-04: a STALE processing job is still reclaimed (crash recovery keeps working)', async () => {
  const env = makeEnv();
  // 11 minutes old, i.e. past STUCK_MINUTES = 10.
  await seedJob(env, { status: 'processing', claimed_at: ISO(11 * 60000) + '#dead-drain' });

  const res = await processPendingJobs(env);

  assert.equal(res.processed, 1, 'a drain that died mid-flight must not strand the job');
  assert.equal((await job(env)).status, 'done');
});

test('P0-04: a FRESH processing job is left alone', async () => {
  const env = makeEnv();
  await seedJob(env, { status: 'processing', claimed_at: ISO(1000) + '#busy-drain' });

  const res = await processPendingJobs(env);

  assert.equal(res.processed, 0, 'someone is working on it');
  const j = await job(env);
  assert.equal(j.status, 'processing');
  assert.equal(j.attempts, 0, 'no attempt was consumed');
});

test('P0-04: the claim token is unique per drain', async () => {
  const env = makeEnv();
  await seedJob(env, { job_id: 'JOB-A' });
  await seedJob(env, { job_id: 'JOB-B' });

  // Capture what each claim wrote.
  const tokens = [];
  const realPrepare = env.DB_MISC.prepare.bind(env.DB_MISC);
  env.DB_MISC.prepare = (sql) => {
    const stmt = realPrepare(sql);
    if (/UPDATE collection_jobs\s+SET status = 'processing'/.test(sql)) {
      const realBind = stmt.bind.bind(stmt);
      stmt.bind = (...args) => { tokens.push(args[0]); return realBind(...args); };
    }
    return stmt;
  };

  await processPendingJobs(env);

  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[0], tokens[1], 'each claim carries its own token');
  for (const t of tokens) assert.match(t, /^\d{4}-\d{2}-\d{2}T.*#[0-9a-f-]{36}$/, 'iso#uuid');
});

// ============================================ 2. ATTEMPT CAP IS PART OF THE CLAIM

test('P0-04: a job at the attempt cap is never claimed', async () => {
  const env = makeEnv();
  await seedJob(env, { attempts: 3 }); // MAX_ATTEMPTS

  const res = await processPendingJobs(env);

  assert.equal(res.processed, 0);
  const j = await job(env);
  assert.equal(j.attempts, 3, 'the cap is not exceeded by a claim');
  assert.equal(j.status, 'pending');
});

// ==================================================== 3. THE MONITOR STAYS CLEAN

test('P0-04: the queue monitor shows a plain timestamp, not the claim token', async () => {
  const env = makeEnv();
  await seedJob(env, { status: 'processing', claimed_at: '2026-09-16T10:00:00.000Z#abc-123' });

  const out = await getQueueJobsForSuperadmin(env, SUPERADMIN, {});
  const row = out.jobs.find(j => j.job_id === 'JOB-1');

  assert.equal(row.claimed_at, '2026-09-16T10:00:00.000Z', 'the token is stripped for display');
});
