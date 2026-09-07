// ===== AUDIT H-10 (missing indexes) + M-38 (no retention policy at all) =====
//
// H-10: users.id_code — the hottest lookup in the portal — had NO index, despite a
// comment in views.js claiming it did. Every profile open was several full scans of a
// 32,000-row table, against a 5,000,000 rows/day free-tier budget where each read is
// also a subrequest (capped at 50 per invocation on the free plan).
//
// M-38: nothing ever deleted anything. Worst of all, collection_jobs.filled_base64
// stores a complete filled .docx per COLLECTION save and was kept forever — the
// fastest route to the 5 GB storage limit, and pure dead weight once the PDF exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { runRetentionSweep, shouldSweepNow, SWEEP_MINUTE, RETENTION } from '../src/retention.js';

const MIGRATION_DIR = new URL('../../db/migration/2026-09-05/', import.meta.url);
const migrationFiles = () => readdirSync(MIGRATION_DIR).filter(f => f.endsWith('.sql')).sort();

const SCHEMA_FOR_MIGRATION = {
  '01-core-indexes.sql': 'core.sql',
  '02-loans-expenses-indexes.sql': 'loans_expenses.sql',
  '03-misc-indexes.sql': 'misc.sql',
  '04-logs-indexes.sql': 'logs.sql',
  '05-whatsapp-indexes.sql': 'whatsapp_index.sql',
  '06-audit-indexes.sql': 'audit.sql',
  // audit H-9 — one file per database, same as the six above.
  '07-core-id-uniqueness.sql': 'core.sql',
  '08-collections-sl-no-uniqueness.sql': 'collections.sql',
  // 10/11 are comment-only (M-34/M-35): they ship detection queries + ready-to-run
  // trigger/rebuild recipes but apply nothing, so they map to any schema and pass
  // the apply-twice idempotency check trivially. Their recipes are proven to work
  // by m34-m35-constraints.test.mjs.
  '10-loans-referential-integrity.sql': 'loans_expenses.sql',
  '11-domain-check-constraints.sql': 'loans_expenses.sql',
  // audit M-13 — the one migration in this folder that is NOT index-only: it adds a
  // column and backfills it. Listed in SCHEMA_ONLY_MIGRATIONS below so the
  // index-only invariants do not apply to it, and asserted separately instead.
  '09-error-log-client-ip.sql': 'logs.sql',
  // audit M-33 — comment-only rebuild recipes (REAL->INTEGER/TEXT). They apply
  // nothing; proven by m33-column-types.test.mjs.
  '12-column-types-integer.sql': 'collections.sql',
  '13-column-types-text.sql': 'core.sql',
};

// Migrations that legitimately do more than CREATE INDEX. Keep this list as short
// as possible: everything on it opts out of the "cannot drop, delete, update or
// alter" guarantee that makes the rest safe to run unattended.
const SCHEMA_ONLY_MIGRATIONS = new Set(['09-error-log-client-ip.sql']);

const DAY = 86400000;
const isoAgo = (d) => new Date(Date.now() - d * DAY).toISOString();

// ------------------------------------------------------------ H-10 MIGRATIONS

test('H-10: every migration applies against the real schema, and is IDEMPOTENT', () => {
  for (const file of migrationFiles()) {
    const schemaName = SCHEMA_FOR_MIGRATION[file];
    assert.ok(schemaName, `no schema mapped for ${file} — add it to SCHEMA_FOR_MIGRATION`);
    const db = new DatabaseSync(':memory:');
    db.exec(schemaFor(schemaName));
    // migration/2026-09-02/01 adds collection_jobs to chhath-misc; schema/misc.sql
    // already contains it, so nothing extra is needed here.
    const sql = readFileSync(new URL(file, MIGRATION_DIR), 'utf8');
    db.exec(sql);            // first run
    // SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so a migration that
    // adds a column cannot be fully re-runnable. Its own test asserts that the
    // ONLY thing failing on a second run is the duplicate column.
    if (!SCHEMA_ONLY_MIGRATIONS.has(file)) {
      db.exec(sql);          // second run must be a no-op, not an error
    }
    db.close();
  }
});

test('H-10: the users.id_code index exists and is actually USED by the hot query', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('core.sql'));

  // Before: the planner must scan.
  const before = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM users WHERE id_code = ?').all()
    .map(r => r.detail).join(' ');
  assert.match(before, /SCAN/i, 'precondition: without the index this is a table scan');

  db.exec(readFileSync(new URL('01-core-indexes.sql', MIGRATION_DIR), 'utf8'));

  const after = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM users WHERE id_code = ?').all()
    .map(r => r.detail).join(' ');
  assert.match(after, /idx_users_id_code/, `the planner must use the new index, got: ${after}`);
  assert.ok(!/SCAN TABLE users/i.test(after), 'and must no longer scan');
  db.close();
});

test('H-10: the consent-flow lookups are index-backed too', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('loans_expenses.sql'));
  db.exec(readFileSync(new URL('02-loans-expenses-indexes.sql', MIGRATION_DIR), 'utf8'));
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(r => r.detail).join(' ');

  assert.match(plan('SELECT * FROM loan_consents WHERE consent_id = ?'), /idx_loan_consents_consent_id/);
  assert.match(plan('SELECT * FROM loan_message_templates WHERE type = ?'), /idx_loan_message_templates_type/);
  db.close();
});

test('H-10: the error_log de-dup query (runs on EVERY log write) is index-backed', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('logs.sql'));
  db.exec(readFileSync(new URL('04-logs-indexes.sql', MIGRATION_DIR), 'utf8'));
  const plan = db.prepare(
    `EXPLAIN QUERY PLAN SELECT error_id FROM error_log
      WHERE source = ? AND page = ? AND message = ? AND created_at >= ?
      ORDER BY created_at DESC LIMIT 1`
  ).all().map(r => r.detail).join(' ');
  assert.match(plan, /idx_error_log_dedup/, `expected the composite index, got: ${plan}`);
  db.close();
});

test('H-10: no INDEX-ONLY migration drops anything or mutates a row', () => {
  for (const file of migrationFiles()) {
    if (SCHEMA_ONLY_MIGRATIONS.has(file)) continue; // asserted explicitly below
    const sql = readFileSync(new URL(file, MIGRATION_DIR), 'utf8')
      .replace(/--.*$/gm, '');   // strip comments; several discuss DELETE/UPDATE
    assert.ok(!/\bDROP\b/i.test(sql), `${file} must not DROP anything`);
    assert.ok(!/\bDELETE\b/i.test(sql), `${file} must not DELETE rows`);
    assert.ok(!/\bUPDATE\b/i.test(sql), `${file} must not UPDATE rows`);
    assert.ok(!/\bALTER\b/i.test(sql), `${file} must not ALTER (not idempotent in SQLite)`);
    // Every CREATE must be guarded.
    for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(IF NOT EXISTS\s+)?/gi)) {
      assert.ok(m[2], `${file} has a CREATE INDEX without IF NOT EXISTS — not idempotent`);
    }
  }
});

// ------------------------------------------------------------- M-38 RETENTION

function makeEnv() {
  return {
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
  };
}

const BIG_PAYLOAD = 'A'.repeat(400 * 1024);

function seedJob(env, { id, status, finishedDaysAgo, payload = BIG_PAYLOAD }) {
  env.DB_MISC.prepare(
    `INSERT INTO collection_jobs (id, job_id, status, doc_type, filled_base64, finished_at, created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(id, `JOB${id}`, status, 'receipt', payload,
    finishedDaysAgo == null ? null : isoAgo(finishedDaysAgo), isoAgo(finishedDaysAgo ?? 0)).run();
}

test('M-38: the storage hog — a finished job\'s filled_base64 is blanked after a day', async () => {
  const env = makeEnv();
  seedJob(env, { id: 1, status: 'done', finishedDaysAgo: 3 });   // must be blanked
  seedJob(env, { id: 2, status: 'done', finishedDaysAgo: 0 });   // too recent
  seedJob(env, { id: 3, status: 'pending', finishedDaysAgo: null }); // never touched
  seedJob(env, { id: 4, status: 'failed', finishedDaysAgo: 10 });    // still retryable

  const report = await runRetentionSweep(env);
  assert.equal(report.jobPayloadsBlanked, 1, 'exactly the one eligible job');

  const rows = await env.DB_MISC.prepare('SELECT id, length(filled_base64) AS len FROM collection_jobs ORDER BY id').all();
  const len = Object.fromEntries(rows.results.map(r => [r.id, r.len]));
  assert.equal(len[1], 0, 'the old done job must be blanked');
  assert.ok(len[2] > 0, 'a job finished today must keep its payload');
  assert.ok(len[3] > 0, 'a PENDING job must keep its payload — it has not run yet');
  assert.ok(len[4] > 0, 'a FAILED job must keep its payload — retryQueueJob needs it');
});

test('M-38: a done job row is deleted after 30 days', async () => {
  const env = makeEnv();
  seedJob(env, { id: 1, status: 'done', finishedDaysAgo: 40, payload: '' });
  seedJob(env, { id: 2, status: 'done', finishedDaysAgo: 5, payload: '' });
  seedJob(env, { id: 3, status: 'failed', finishedDaysAgo: 400, payload: '' });

  const report = await runRetentionSweep(env);
  assert.equal(report.doneJobsDeleted, 1);
  const { results } = await env.DB_MISC.prepare('SELECT id FROM collection_jobs ORDER BY id').all();
  assert.deepEqual(results.map(r => r.id), [2, 3], 'only the old DONE job is removed');
});

test('M-38: logs, attempts, sessions and messages are all trimmed by their own window', async () => {
  const env = makeEnv();
  env.DB_LOGS.prepare('INSERT INTO error_log (error_id, source, page, message, created_at) VALUES (?,?,?,?,?)')
    .bind('E-old', 's', 'p', 'm', isoAgo(RETENTION.errorLogDays + 5)).run();
  env.DB_LOGS.prepare('INSERT INTO error_log (error_id, source, page, message, created_at) VALUES (?,?,?,?,?)')
    .bind('E-new', 's', 'p', 'm', isoAgo(1)).run();
  env.DB_LOGS.prepare('INSERT INTO activity_log (timestamp, name, action) VALUES (?,?,?)')
    .bind(isoAgo(RETENTION.activityLogDays + 5), 'USER0001', 'add').run();
  env.DB_LOGS.prepare('INSERT INTO activity_log (timestamp, name, action) VALUES (?,?,?)')
    .bind(isoAgo(30), 'USER0001', 'add').run();
  env.DB_AUDIT.prepare('INSERT INTO login_attempts (identifier, success, created_at) VALUES (?,?,?)')
    .bind('USER0001', 0, isoAgo(RETENTION.loginAttemptDays + 5)).run();
  env.DB_AUDIT.prepare('INSERT INTO login_attempts (identifier, success, created_at) VALUES (?,?,?)')
    .bind('USER0001', 1, isoAgo(2)).run();
  // expires_at is epoch MILLISECONDS, not ISO — a real trap in this schema.
  env.DB_AUDIT.prepare('INSERT INTO user_sessions (token_hash, name, created_at, expires_at) VALUES (?,?,?,?)')
    .bind('h-old', 'USER0001', isoAgo(90), Date.now() - 60 * DAY).run();
  env.DB_AUDIT.prepare('INSERT INTO user_sessions (token_hash, name, created_at, expires_at) VALUES (?,?,?,?)')
    .bind('h-live', 'USER0001', isoAgo(1), Date.now() + 3600_000).run();
  for (const t of ['person_messages', 'group_messages']) {
    env.DB_WHATSAPP_INDEX.prepare(`INSERT INTO ${t} (message_id, message, status, created_at, sent_at) VALUES (?,?,?,?,?)`)
      .bind(`${t}-old`, 'x', 'sent', isoAgo(400), isoAgo(RETENTION.messageDays + 5)).run();
    env.DB_WHATSAPP_INDEX.prepare(`INSERT INTO ${t} (message_id, message, status, created_at, sent_at) VALUES (?,?,?,?,?)`)
      .bind(`${t}-pending`, 'x', 'pending', isoAgo(400), null).run();
  }

  const report = await runRetentionSweep(env);
  assert.equal(report.errorLogDeleted, 1);
  assert.equal(report.activityLogDeleted, 1);
  assert.equal(report.loginAttemptsDeleted, 1);
  assert.equal(report.expiredSessionsDeleted, 1);
  assert.equal(report.person_messagesDeleted, 1);
  assert.equal(report.group_messagesDeleted, 1);

  // The survivors are the right ones.
  assert.equal((await env.DB_LOGS.prepare('SELECT error_id FROM error_log').first()).error_id, 'E-new');
  assert.equal((await env.DB_AUDIT.prepare('SELECT token_hash FROM user_sessions').first()).token_hash, 'h-live');
  // A never-delivered message must survive: getStuckMessages/resendMessage need it.
  const pend = await env.DB_WHATSAPP_INDEX.prepare("SELECT message_id FROM person_messages WHERE status = 'pending'").first();
  assert.equal(pend.message_id, 'person_messages-pending');
});

test('M-38: the sweep is BOUNDED so it cannot exhaust the 100k/day D1 write budget', async () => {
  const env = makeEnv();
  // A 5,000-row backlog — far more than one tick may touch.
  for (let i = 1; i <= 5000; i++) {
    env.DB_LOGS.prepare('INSERT INTO error_log (error_id, source, page, message, created_at) VALUES (?,?,?,?,?)')
      .bind(`E${i}`, 's', 'p', 'm', isoAgo(300)).run();
  }
  const report = await runRetentionSweep(env);
  assert.ok(report.errorLogDeleted <= 200, `one tick deleted ${report.errorLogDeleted} rows — must be capped`);
  assert.equal(report.errorLogDeleted, 200, 'and should use its full allowance');

  // The backlog drains across ticks rather than in one burst.
  let remaining = (await env.DB_LOGS.prepare('SELECT COUNT(*) n FROM error_log').first()).n;
  assert.equal(remaining, 4800);
  for (let tick = 0; tick < 3; tick++) await runRetentionSweep(env);
  remaining = (await env.DB_LOGS.prepare('SELECT COUNT(*) n FROM error_log').first()).n;
  assert.equal(remaining, 4200, 'each tick removes another bounded slice');
});

test('M-38: the sweep never throws, even with missing bindings or missing tables', async () => {
  // A partially-configured deployment, or an older DB without collection_jobs.
  await assert.doesNotReject(() => runRetentionSweep({}));
  await assert.doesNotReject(() => runRetentionSweep(null));
  const partial = { DB_LOGS: makeD1('CREATE TABLE unrelated (id INTEGER PRIMARY KEY);') };
  const report = await runRetentionSweep(partial);
  // It records the failure rather than throwing or silently claiming success.
  assert.ok(Object.keys(report).some(k => k.endsWith(':error')), 'errors must be reported in the summary');
});

test('M-38: the steady state is silent and cheap', async () => {
  const env = makeEnv();
  seedJob(env, { id: 1, status: 'done', finishedDaysAgo: 0 });
  const report = await runRetentionSweep(env);
  assert.deepEqual(report, {}, 'with nothing to clean, the report must be empty so nothing is logged');
});

test('M-38: the sweep runs once an hour, not on all 1440 cron ticks', () => {
  let sweeps = 0;
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m++) {
      if (shouldSweepNow(new Date(Date.UTC(2026, 9, 25, h, m)))) sweeps++;
    }
  }
  assert.equal(sweeps, 24, 'exactly once per hour');
  assert.ok(shouldSweepNow(new Date(Date.UTC(2026, 9, 25, 3, SWEEP_MINUTE))));
  assert.ok(!shouldSweepNow(new Date(Date.UTC(2026, 9, 25, 3, SWEEP_MINUTE + 1))));

  // Worst-case daily write cost must stay well inside D1's 100,000/day.
  const statements = 8;
  assert.ok(24 * statements * 200 < 100000, 'worst-case sweep writes must fit the budget');
});

// The escape hatch above must not become a blanket exemption: a migration that opts
// out of the index-only guarantees still has to be safe, so state exactly what each
// one is allowed to do.
test('H-10: the schema-changing migrations are still narrowly scoped', () => {
  for (const file of SCHEMA_ONLY_MIGRATIONS) {
    const sql = readFileSync(new URL(file, MIGRATION_DIR), 'utf8').replace(/--.*$/gm, '');
    assert.ok(!/\bDROP\b/i.test(sql), `${file} must still not DROP anything`);
    assert.ok(!/\bDELETE\b/i.test(sql), `${file} must still not DELETE rows`);
    for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(IF NOT EXISTS\s+)?/gi)) {
      assert.ok(m[2], `${file} has a CREATE INDEX without IF NOT EXISTS`);
    }
    // ALTER is permitted, but only to ADD a column — never to rename or drop one.
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+\w+\s+(\w+)/gi)) {
      assert.match(m[1], /^ADD$/i, `${file}: only ALTER TABLE ... ADD COLUMN is allowed, saw "${m[1]}"`);
    }
    // UPDATE is permitted, but must be a bounded backfill of the new column only.
    for (const m of sql.matchAll(/UPDATE\s+(\w+)\s+SET\s+(\w+)/gi)) {
      assert.equal(m[2], 'client_ip', `${file}: the backfill may only write the new column, saw "${m[2]}"`);
      assert.match(sql.slice(sql.indexOf(m[0])), /WHERE/i, `${file}: an UPDATE must be bounded by a WHERE`);
    }
  }
});
