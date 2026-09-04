// ============ Follow-up fixes to the 2026-09-04 full audit ============
//
// Three defects the audit named but that were not yet closed:
//
//   1. §6.5 "A collection edited while its PDF job is `processing`": updateRecordByIdx
//      purges the generated_files index, but a collection_job already claimed for
//      that row still holds the PRE-EDIT bytes and re-indexes the stale PDF right
//      after. The same applies on delete (an orphaned PDF for a deleted record).
//      The fix parks any pending/processing job for that row.
//
//   2. §6.5 "rowIndex = 0": UPDATE … WHERE id = 0 matches nothing yet returned
//      {success:true}, so the caller believed a non-existent edit happened.
//
//   3. A regression guard: the six ordinary sheets and normal edits still work.
//
// Run: node --test mgmt/backend/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { updateRecordByIdx, deleteRecordByIdx } from '../src/crud.js';

const ADMIN = { name: 'USER0002', role: 'Admin' };

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const collections = makeD1(schemaFor('collections.sql'));
  const fileIndex = makeD1(schemaFor('file_index.sql'));
  const logs = makeD1(schemaFor('logs.sql'));
  const misc = makeD1(schemaFor('misc.sql'));

  // A committee membership so requireYearAccess lets the Admin touch 2026.
  core.prepare('INSERT INTO committee_members (year, name, view_role) VALUES (?,?,?)')
    .bind(2026, 'USER0002', 'Member').run();

  // One collection row (id = 1) in an unlocked year.
  collections.prepare(
    'INSERT INTO collections (id, year, sl_no, name, amount) VALUES (?,?,?,?,?)')
    .bind(1, 2026, 1, 'Ramesh', 500).run();

  return {
    DB_CORE: core, DB_COLLECTIONS: collections, DB_FILE_INDEX: fileIndex,
    DB_LOGS: logs, DB_MISC: misc,
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
  };
}

// Seed a collection_job for row_index=1 in the given status.
function seedJob(env, status) {
  env.DB_MISC.prepare(
    `INSERT INTO collection_jobs (job_id, status, doc_type, year, row_index, record_id, filled_base64, attempts, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind('JOB1', status, 'receipt', '2026', 1, 'receipt-2026-1', 'BASE64BYTES', 0, '2026-01-01').run();
}

async function jobStatus(env, jobId) {
  const row = await env.DB_MISC.prepare('SELECT status, last_error FROM collection_jobs WHERE job_id = ?')
    .bind(jobId).first();
  return row;
}

// -------------------------------------------------------- THE EDIT RACE (§6.5)

test('editing a collection parks a PENDING job for that row so it cannot re-index the stale PDF', async () => {
  const env = makeEnv();
  seedJob(env, 'pending');
  await updateRecordByIdx(env, 'COLLECTIONS', 1, { Year: 2026, Name: 'Ramesh', Amount: 900 }, ADMIN);
  const job = await jobStatus(env, 'JOB1');
  assert.equal(job.status, 'failed');
  assert.match(job.last_error, /superseded/i);
});

test('editing a collection parks a PROCESSING (in-flight) job too', async () => {
  const env = makeEnv();
  seedJob(env, 'processing');
  await updateRecordByIdx(env, 'COLLECTIONS', 1, { Year: 2026, Name: 'Ramesh', Amount: 900 }, ADMIN);
  const job = await jobStatus(env, 'JOB1');
  assert.equal(job.status, 'failed');
});

test('a job for a DIFFERENT row is left untouched', async () => {
  const env = makeEnv();
  env.DB_MISC.prepare(
    `INSERT INTO collection_jobs (job_id, status, doc_type, year, row_index, record_id, attempts, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind('JOB2', 'pending', 'receipt', '2026', 99, 'receipt-2026-99', 0, '2026-01-01').run();
  await updateRecordByIdx(env, 'COLLECTIONS', 1, { Year: 2026, Name: 'Ramesh', Amount: 900 }, ADMIN);
  const job = await jobStatus(env, 'JOB2');
  assert.equal(job.status, 'pending', 'a job for another row must not be parked');
});

test('an already-done job is NOT reopened or altered by an edit', async () => {
  const env = makeEnv();
  seedJob(env, 'done');
  await updateRecordByIdx(env, 'COLLECTIONS', 1, { Year: 2026, Name: 'Ramesh', Amount: 900 }, ADMIN);
  const job = await jobStatus(env, 'JOB1');
  assert.equal(job.status, 'done', 'a finished job must stay done (its side effects already ran)');
});

test('deleting a collection also parks its pending job (no orphaned PDF re-index)', async () => {
  const env = makeEnv();
  // Only a Superadmin holds the 'delete' permission (see ROLE_WRITE_SHEETS).
  const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
  seedJob(env, 'pending');
  await deleteRecordByIdx(env, 'COLLECTIONS', 1, SUPERADMIN);
  const job = await jobStatus(env, 'JOB1');
  assert.equal(job.status, 'failed');
});

// -------------------------------------------------------- rowIndex GUARD (§6.5)

test('updateRecordByIdx rejects rowIndex = 0 instead of silently reporting success', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => updateRecordByIdx(env, 'COLLECTIONS', 0, { Year: 2026, Name: 'X', Amount: 1 }, ADMIN),
    /valid row index/i
  );
});

test('updateRecordByIdx rejects a negative or non-numeric rowIndex', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => updateRecordByIdx(env, 'COLLECTIONS', -1, { Year: 2026, Name: 'X', Amount: 1 }, ADMIN),
    /valid row index/i
  );
  await assert.rejects(
    () => updateRecordByIdx(env, 'COLLECTIONS', 'abc', { Year: 2026, Name: 'X', Amount: 1 }, ADMIN),
    /valid row index/i
  );
});

// -------------------------------------------------------- REGRESSION GUARDS

test('regression guard: a normal edit of an existing row still succeeds', async () => {
  const env = makeEnv();
  const res = await updateRecordByIdx(env, 'COLLECTIONS', 1, { Year: 2026, Name: 'Ramesh', Amount: 900 }, ADMIN);
  assert.equal(res.success, true);
  const row = await env.DB_COLLECTIONS.prepare('SELECT amount FROM collections WHERE id = 1').first();
  assert.equal(Number(row.amount), 900, 'the edit must actually persist');
});

test('regression guard: the parking is a no-op when there is no matching job', async () => {
  const env = makeEnv();
  // No job seeded — the edit must still succeed and not throw.
  const res = await updateRecordByIdx(env, 'COLLECTIONS', 1, { Year: 2026, Name: 'Ramesh', Amount: 900 }, ADMIN);
  assert.equal(res.success, true);
});
