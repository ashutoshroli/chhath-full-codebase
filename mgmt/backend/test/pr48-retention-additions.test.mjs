// audit PR-48 — the tables the M-38 retention sweep did not cover.
//
// The sweep already pruned logs, sessions, login attempts, WhatsApp and email history.
// Four tables had no retention at all, and one had HALF of one — which is the
// interesting case:
//
//   `boundedBlank` cleared `filled_base64` only for `status = 'done'`. A job that
//   FAILED kept its complete base64 .docx for ever — and failed jobs are precisely the
//   ones that accumulate. The sweep was written because that column is "the fastest
//   route to the 5 GB free-tier storage limit", and it was leaking through the half it
//   did not cover.
//
// Every case below is planted into the COMMITTED schema, so what is being tested is the
// real statement against the real column names, not a fixture agreeing with itself.
//
// Run: node --test mgmt/backend/test/pr48-retention-additions.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { runRetentionSweep, RETENTION } from '../src/retention.js';

const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

function env() {
  return {
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
  };
}
const exec = (e, binding, sql) => e[binding]._db.exec(sql);
const rows = (e, binding, sql) => e[binding]._db.prepare(sql).all();

describe('the failed-job payload leak', () => {
  test("a failed job's bytes are cleared after their window, a done job's after one day", async () => {
    const e = env();
    const job = (id, status, finishedDaysAgo) =>
      exec(e, 'DB_MISC', `INSERT INTO collection_jobs (job_id, status, filled_base64, finished_at, attempts)
        VALUES ('${id}', '${status}', 'BASE64BYTES', '${daysAgo(finishedDaysAgo)}', 3);`);

    job('done-old', 'done', 5);                                  // past jobPayloadDays (1)
    job('done-fresh', 'done', 0);                                // today — keep
    job('failed-ancient', 'failed', RETENTION.failedJobPayloadDays + 5);  // past its window
    job('failed-recent', 'failed', 3);                           // still retryable — KEEP
    job('pending', 'pending', 0);

    await runRetentionSweep(e);

    const got = {};
    for (const r of rows(e, 'DB_MISC', 'SELECT job_id, filled_base64 FROM collection_jobs')) {
      got[r.job_id] = r.filled_base64;
    }
    assert.equal(got['done-old'], '', 'a finished job past one day should be blanked');
    assert.equal(got['failed-ancient'], '', 'THE LEAK: a long-failed job was never blanked');
    // The reason the two windows differ: retryQueueJob regenerates from these bytes, so
    // a recently-failed job must still be retryable.
    assert.equal(got['failed-recent'], 'BASE64BYTES', 'a recent failure is still retryable');
    assert.equal(got['done-fresh'], 'BASE64BYTES');
    assert.equal(got['pending'], 'BASE64BYTES', 'a pending job has not run yet');
  });

  test('the two windows really are different, and failed is the longer one', () => {
    // If these ever became equal, the trade documented in retention.js would have been
    // silently dropped and manual retry would break a day after a failure.
    assert.ok(
      RETENTION.failedJobPayloadDays > RETENTION.jobPayloadDays,
      'a failed job must keep its retry bytes longer than a finished job keeps dead ones'
    );
  });
});

describe('render_jobs — only terminal rows', () => {
  test('completed and failed are pruned; pending and dispatched are not', async () => {
    const e = env();
    const rj = (id, status, finishedDaysAgo) =>
      exec(e, 'DB_MISC', `INSERT INTO render_jobs (job_id, kind, status, created_at, dispatched_at, finished_at)
        VALUES ('${id}', 'ai_fix', '${status}', '${daysAgo(90)}', '${daysAgo(90)}',
                ${finishedDaysAgo === null ? 'NULL' : `'${daysAgo(finishedDaysAgo)}'`});`);

    rj('done-old', 'completed', RETENTION.renderJobDays + 5);
    rj('failed-old', 'failed', RETENTION.renderJobDays + 5);
    rj('done-recent', 'completed', 1);
    // A 'dispatched' row is what the reconciliation cron scans for. Pruning it would
    // hide a stuck job instead of cleaning up a finished one — so age must not be
    // enough on its own.
    rj('stuck', 'dispatched', null);
    rj('waiting', 'pending', null);

    await runRetentionSweep(e);

    const left = rows(e, 'DB_MISC', 'SELECT job_id FROM render_jobs ORDER BY job_id').map((r) => r.job_id);
    assert.deepEqual(left, ['done-recent', 'stuck', 'waiting']);
  });
});

describe('ai_fixes — and the status that must survive', () => {
  test("terminal fixes are pruned but 'needs_manual_review' is kept", async () => {
    const e = env();
    const fix = (id, status, updatedDaysAgo) =>
      exec(e, 'DB_LOGS', `INSERT INTO ai_fixes (fix_id, status, created_at, updated_at)
        VALUES ('${id}', '${status}', '${daysAgo(400)}', '${daysAgo(updatedDaysAgo)}');`);

    const old = RETENTION.aiFixDays + 10;
    fix('merged', 'merged', old);
    fix('failed', 'failed', old);
    fix('ci-failed', 'ci_failed', old);
    // THE ONE THAT MATTERS. `needs_manual_review` is a request for a human. Deleting it
    // because it is old silently drops the request — the fix is still unreviewed, and
    // now nobody knows it exists.
    fix('needs-human', 'needs_manual_review', old);
    fix('running', 'ci_running', old);
    fix('merged-recent', 'merged', 1);

    await runRetentionSweep(e);

    const left = rows(e, 'DB_LOGS', 'SELECT fix_id FROM ai_fixes ORDER BY fix_id').map((r) => r.fix_id);
    assert.deepEqual(left, ['merged-recent', 'needs-human', 'running']);
  });
});

describe('official mail — outbound only', () => {
  test('sent and failed are pruned; RECEIVED mail is never touched', async () => {
    const e = env();
    const mail = (id, status, daysOld) =>
      exec(e, 'DB_WHATSAPP_INDEX', `INSERT INTO official_emails (message_id, status, created_at)
        VALUES ('${id}', '${status}', '${daysAgo(daysOld)}');`);

    const old = RETENTION.officialMailDays + 30;
    mail('we-sent', 'sent', old);
    mail('we-failed', 'failed', old);
    // Deleting inbound mail is deleting correspondence nobody agreed to delete. The
    // filter is an allowlist of outbound states, not "anything old", precisely so a new
    // inbound status cannot start being swept by accident.
    mail('they-sent-us', 'received', old);
    mail('recent', 'sent', 1);

    await runRetentionSweep(e);

    const left = rows(e, 'DB_WHATSAPP_INDEX', 'SELECT message_id FROM official_emails ORDER BY message_id')
      .map((r) => r.message_id);
    assert.deepEqual(left, ['recent', 'they-sent-us']);
  });
});

describe('push subscriptions — dead ones only', () => {
  test('inactive rows are pruned; an old but ACTIVE subscriber is kept', async () => {
    const e = env();
    const sub = (endpoint, active, daysOld) =>
      exec(e, 'DB_CORE', `INSERT INTO push_subscriptions (endpoint, active, created_at, updated_at)
        VALUES ('${endpoint}', ${active}, '${daysAgo(500)}', '${daysAgo(daysOld)}');`);

    const old = RETENTION.inactivePushDays + 10;
    sub('https://fcm/dead-1', 0, old);
    sub('https://fcm/dead-2', 0, old);
    // Keyed on `active`, not on age: somebody who subscribed two years ago and never
    // unsubscribed is a real subscriber, and deleting them silently stops their
    // notifications.
    sub('https://fcm/old-but-real', 1, old);
    sub('https://fcm/recently-off', 0, 1);

    await runRetentionSweep(e);

    const left = rows(e, 'DB_CORE', 'SELECT endpoint FROM push_subscriptions ORDER BY endpoint')
      .map((r) => r.endpoint);
    assert.deepEqual(left, ['https://fcm/old-but-real', 'https://fcm/recently-off']);
  });
});

describe('the sweep as a whole', () => {
  test('it reports every table it touched, and reports nothing it did not', async () => {
    const e = env();
    exec(e, 'DB_MISC', `INSERT INTO render_jobs (job_id, kind, status, finished_at)
      VALUES ('x', 'ai_fix', 'completed', '${daysAgo(RETENTION.renderJobDays + 1)}');`);

    const report = await runRetentionSweep(e);

    assert.equal(report.renderJobsDeleted, 1);
    // A label only appears when it removed something, so a report stays readable and an
    // operator can see at a glance what actually happened.
    assert.equal(report.aiFixesDeleted, undefined);
    assert.equal(report.officialEmailsDeleted, undefined);
    // And nothing errored — a `:error` key would mean a statement referenced a column
    // that does not exist in the committed schema.
    const errors = Object.keys(report).filter((k) => k.endsWith(':error'));
    assert.deepEqual(errors, [], `sweep reported errors: ${JSON.stringify(report)}`);
  });

  test('a missing binding is survived, not thrown', async () => {
    // An older deployment may not have every database bound. The cron must not break.
    const e = env();
    delete e.DB_CORE;
    delete e.DB_LOGS;
    const report = await runRetentionSweep(e);
    assert.equal(typeof report, 'object');
  });
});
