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
import { runRetentionSweep, shouldSweepNow, SWEEP_MINUTE, SWEEP_WINDOW_MINUTES, RETENTION } from '../src/retention.js';

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
  // rows_read burn — index the queue poll's (status, attempts) predicate so the
  // 3-min cron drain stops full-scanning the fat collection_jobs table.
  '14-collection-jobs-poll-index.sql': 'misc.sql',
  // email channel (Resend): adds email_message_templates + email_messages to the
  // whatsapp-index DB. Applies against the committed whatsapp_index.sql schema
  // (which already contains both tables); the migration is CREATE IF NOT EXISTS
  // so a second run is a no-op.
  '15-email-channel.sql': 'whatsapp_index.sql',
  // loan email templates (Resend): adds loan_email_templates to the
  // loans-expenses DB. CREATE IF NOT EXISTS, so idempotent against the committed
  // loans_expenses.sql schema (which already contains the table).
  '16-loan-email-templates.sql': 'loans_expenses.sql',
  // official mailbox: adds official_emails to the whatsapp-index DB (already in
  // the committed schema); CREATE IF NOT EXISTS so a second run is a no-op.
  '17-official-mailbox.sql': 'whatsapp_index.sql',
  // official_emails.attachments — comment-only (like 10-13): the column is in the
  // committed schema; the live-DB ALTER ships as a documented one-liner. Applies
  // nothing, so it passes the apply-twice idempotency check trivially.
  '18-official-emails-attachments.sql': 'whatsapp_index.sql',
  // popup_slides.duration_ms — comment-only (like 10-13 and 18): the per-slide
  // auto-play duration column is in the committed misc.sql schema; the live-DB
  // ALTER ships as a documented one-liner. Applies nothing, so it passes the
  // apply-twice idempotency check trivially.
  '19-popup-slide-duration.sql': 'misc.sql',
  // ai_fixes table (AI auto-fix feature). CREATE TABLE/INDEX IF NOT EXISTS against
  // the logs DB (schema/logs.sql already defines the table), so it applies cleanly
  // on a fresh schema and a second run is a no-op — like 15/17.
  '20-ai-fixes.sql': 'logs.sql',
  // ai_providers table (AI Management tab). Same idempotent CREATE ... IF NOT
  // EXISTS pattern against the logs DB.
  '21-ai-providers.sql': 'logs.sql',
  // TOTP 2FA — adds five columns to login_users (core DB). Like 09 it is a real
  // ADD COLUMN migration, so it is in SCHEMA_ONLY_MIGRATIONS below (a second run
  // legitimately errors on the duplicate column) and asserted separately.
  '22-login-users-totp.sql': 'core.sql',
  // ai_providers.purpose — a real ADD COLUMN (like 09/22), so it is in
  // SCHEMA_ONLY_MIGRATIONS below and asserted for idempotency-failure separately.
  '24-ai-providers-purpose.sql': 'logs.sql',
  // ai_providers.priority — a real ADD COLUMN (+ a backfill UPDATE), so it is in
  // SCHEMA_ONLY_MIGRATIONS below and asserted for idempotency-failure separately.
  '25-ai-providers-priority.sql': 'logs.sql',
  // render_jobs table (Render offload). CREATE TABLE/INDEX IF NOT EXISTS against
  // the misc DB (schema/misc.sql already defines it), so it applies on a fresh
  // schema and a second run is a no-op — like 15/17/20/21.
  '23-render-jobs.sql': 'misc.sql',
};

// Migrations that legitimately do more than CREATE INDEX. Keep this list as short
// as possible: everything on it opts out of the "cannot drop, delete, update or
// alter" guarantee that makes the rest safe to run unattended.
const SCHEMA_ONLY_MIGRATIONS = new Set(['09-error-log-client-ip.sql', '22-login-users-totp.sql', '24-ai-providers-purpose.sql', '25-ai-providers-priority.sql']);

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

test('rows_read: the queue-drain poll uses idx_collection_jobs_status_attempts, not a full scan', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('misc.sql'));

  // The exact predicate processPendingJobs runs every 3 min / on every retry.
  const POLL = `SELECT id, job_id, status, doc_type, year, record_id, is_new_entry,
                       payload, file_name, created_by, attempts
                  FROM collection_jobs
                 WHERE attempts < ?
                   AND (status = 'pending' OR (status = 'processing' AND (claimed_at IS NULL OR claimed_at < ?)))
                 ORDER BY id ASC LIMIT ?`;

  const planWith = db.prepare(`EXPLAIN QUERY PLAN ${POLL}`).all().map(r => r.detail).join(' | ');
  // The OR is satisfied by an index range on each status branch; the planner must
  // NOT fall back to scanning the (fat, filled_base64-bearing) table.
  assert.match(planWith, /idx_collection_jobs_status_attempts/,
    `the poll must use the composite index, got: ${planWith}`);
  assert.ok(!/SCAN TABLE collection_jobs\b(?!.*USING)/i.test(planWith),
    `the poll must not full-scan collection_jobs, got: ${planWith}`);
  db.close();
});

test('rows_read: the poll query never SELECTs the fat filled_base64 blob', () => {
  // Guard the code, not just the DB: the whole point is that the per-tick poll
  // stays cheap. If someone reintroduces SELECT * or adds filled_base64 to the
  // poll column list, this fails.
  const src = readFileSync(new URL('../src/collectionQueue.js', import.meta.url), 'utf8');
  const poll = src.slice(src.indexOf('WHERE attempts < ?'));
  const pollSelect = src.slice(0, src.indexOf('WHERE attempts < ?')).lastIndexOf('SELECT');
  const pollBlock = src.slice(pollSelect, src.indexOf('WHERE attempts < ?'));
  assert.ok(!/SELECT\s+\*/i.test(pollBlock), 'the queue-drain poll must not use SELECT *');
  assert.ok(!/filled_base64/i.test(pollBlock), 'the queue-drain poll must not select filled_base64');
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
  // Email queue: one old delivered email (prune) + one never-sent (keep).
  env.DB_WHATSAPP_INDEX.prepare('INSERT INTO email_messages (message_id, to_email, status, created_at, sent_at) VALUES (?,?,?,?,?)')
    .bind('em-old', 'a@b.com', 'sent', isoAgo(400), isoAgo(RETENTION.emailDays + 5)).run();
  env.DB_WHATSAPP_INDEX.prepare('INSERT INTO email_messages (message_id, to_email, status, created_at, sent_at) VALUES (?,?,?,?,?)')
    .bind('em-pending', 'a@b.com', 'pending', isoAgo(400), null).run();

  const report = await runRetentionSweep(env);
  assert.equal(report.errorLogDeleted, 1);
  assert.equal(report.activityLogDeleted, 1);
  assert.equal(report.loginAttemptsDeleted, 1);
  assert.equal(report.expiredSessionsDeleted, 1);
  assert.equal(report.person_messagesDeleted, 1);
  assert.equal(report.group_messagesDeleted, 1);
  assert.equal(report.email_messagesDeleted, 1, 'an old delivered email is pruned');
  // A never-sent email must survive (getStuckEmails / resendEmail need it).
  const pendEmail = await env.DB_WHATSAPP_INDEX.prepare("SELECT message_id FROM email_messages WHERE status = 'pending'").first();
  assert.equal(pendEmail.message_id, 'em-pending');

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

test('M-38: the sweep runs EXACTLY once per hour on the real */3 cron cadence', () => {
  // The cron runs every 3 minutes (see wrangler.toml): ticks at minute 0,3,6,...,57.
  // Simulate ONLY those ticks (not all 60 minutes) and assert the window function
  // fires exactly once per hour — never skipped, never doubled.
  const CRON_STEP = 3;
  for (let h = 0; h < 24; h++) {
    let sweepsThisHour = 0;
    for (let m = 0; m < 60; m += CRON_STEP) {
      if (shouldSweepNow(new Date(Date.UTC(2026, 9, 25, h, m)))) sweepsThisHour++;
    }
    assert.equal(sweepsThisHour, 1, `hour ${h}: sweep must fire exactly once on the */3 cadence`);
  }
});

test('M-38: the sweep window catches SWEEP_MINUTE and is bounded (< 1 hour so it cannot double-fire)', () => {
  // The window [SWEEP_MINUTE, SWEEP_MINUTE + SWEEP_WINDOW_MINUTES) includes the
  // configured minute...
  assert.ok(shouldSweepNow(new Date(Date.UTC(2026, 9, 25, 3, SWEEP_MINUTE))));
  // ...and excludes the minute just before it.
  assert.ok(!shouldSweepNow(new Date(Date.UTC(2026, 9, 25, 3, SWEEP_MINUTE - 1))));
  // The window must be far shorter than an hour, otherwise it could match twice in
  // one hour. (This is what guarantees once-per-hour independent of the cron step.)
  assert.ok(SWEEP_WINDOW_MINUTES < 30, 'window must be well under an hour');

  // Worst-case daily write cost must stay well inside D1's 100,000/day even if the
  // sweep somehow ran on several ticks per hour.
  const statements = 9; // blank + 8 deletes (incl. email_messages)
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
    // UPDATE is permitted, but must be a bounded backfill of a column this same
    // migration just ADDED — never an arbitrary column of existing data.
    const addedCols = [...sql.matchAll(/ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+(\w+)/gi)].map(x => x[1]);
    for (const m of sql.matchAll(/UPDATE\s+(\w+)\s+SET\s+(\w+)/gi)) {
      assert.ok(addedCols.includes(m[2]), `${file}: the backfill may only write a column this migration ADDED, saw "${m[2]}"`);
      assert.match(sql.slice(sql.indexOf(m[0])), /WHERE/i, `${file}: an UPDATE must be bounded by a WHERE`);
    }
  }
});
