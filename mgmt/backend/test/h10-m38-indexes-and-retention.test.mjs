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
  // ai_providers.data_mode: a plain ADD COLUMN with NO backfill, so it is in
  // SCHEMA_ONLY_MIGRATIONS below and asserted for idempotency-failure separately.
  '26-ai-providers-data-mode.sql': 'logs.sql',
  // render_jobs table (Render offload). CREATE TABLE/INDEX IF NOT EXISTS against
  // the misc DB (schema/misc.sql already defines it), so it applies on a fresh
  // schema and a second run is a no-op — like 15/17/20/21.
  '23-render-jobs.sql': 'misc.sql',
  // users.photo — a real ADD COLUMN (like 09/22/24/25/26), so it is in
  // SCHEMA_ONLY_MIGRATIONS below and asserted for idempotency-failure separately.
  '27-users-photo.sql': 'core.sql',
  // journey_entries table + tagline seed (core DB). CREATE TABLE/INDEX IF NOT
  // EXISTS + every seed INSERT guarded by WHERE NOT EXISTS, so it applies on a
  // fresh schema and a second run is a no-op — NOT schema-only (fully idempotent),
  // like 15/17/20/21/23.
  '28-journey-content.sql': 'core.sql',
  // journey page-text seed (core DB): two portal_settings JSON rows, each INSERT
  // guarded by WHERE NOT EXISTS — applies on a fresh schema and a second run is a
  // no-op. Fully idempotent (no ALTER), like 28.
  '29-journey-page-text.sql': 'core.sql',
  // donation settings seed (core DB): seven portal_settings key/value rows, each
  // INSERT guarded by WHERE NOT EXISTS — applies on a fresh schema and a second
  // run is a no-op. Fully idempotent (no ALTER), like 28/29.
  '30-donation-settings.sql': 'core.sql',
  // push_subscriptions table (core DB): CREATE TABLE/INDEX IF NOT EXISTS only, so
  // it applies on a fresh schema and a second run is a no-op. Fully idempotent
  // (no ALTER), like 28/29/30.
  '31-push-subscriptions.sql': 'core.sql',
  // C14 — consent declined/rejected notification templates. The only migration in this
  // folder that SEEDS ROWS: each INSERT is guarded by NOT EXISTS on its `type`, so a
  // re-run changes nothing and cannot overwrite text the committee has since edited.
  '32-consent-decline-templates.sql': 'loans_expenses.sql',
  // C12 — clear the visitor IP addresses already written to error_log. The only
  // migration in this folder that UPDATEs existing rows (see PREREQ_MIGRATIONS below
  // for the other thing that makes it unusual).
  '33-scrub-visitor-ips.sql': 'logs.sql',
  // PR-34 — the constraints migrations 07/08/10 shipped as commented recipes, now
  // executable because PR-33's report proved every precondition is zero. One file per
  // database, per the audit's "per-DB" requirement.
  '34-core-unique-id-code.sql': 'core.sql',
  '35-collections-unique-receipt-no.sql': 'collections.sql',
  '36-loans-keys-and-relations.sql': 'loans_expenses.sql',
  // PR-35 — the migration ledger. It is applied to EVERY database, so it must not
  // assume anything about the schema it lands in; pr35-migration-ledger.test.mjs
  // applies it against two unrelated schemas for exactly that reason. Mapped to
  // core.sql here only because this harness wants one schema per file.
  '37-schema-migrations-ledger.sql': 'core.sql',
};

// A FOURTH category: migrations that ADD A CONSTRAINT — a unique index or a trigger.
//
// These could not go in any existing list. They are not index-only (a trigger is not
// an index), they are not schema-changing in the ADD-COLUMN sense, and they are not
// scrubs. And they trip the index-only rule for a reason that is pure false positive:
// a `BEFORE UPDATE OF loan_id` trigger contains the word UPDATE, while writing nothing.
//
// So the rule here is written against what actually matters — a constraint migration
// must be ADDITIVE. It may create guarded indexes and triggers; it may not write,
// move or delete a single row. The UPDATE check is narrowed to a real update
// STATEMENT (`UPDATE <table> SET`) rather than the keyword, which is the distinction
// the index-only test could not make.
const CONSTRAINT_MIGRATIONS = new Set([
  '34-core-unique-id-code.sql',
  '35-collections-unique-receipt-no.sql',
  '36-loans-keys-and-relations.sql',
]);

// THE FIRST MIGRATION THAT DEPENDS ON ANOTHER ONE.
//
// 33 clears `error_log.client_ip`, but that column is not in the committed
// logs.sql — it is added on top by migration 09 (the same pattern as users.photo and
// the TOTP columns). So 33 cannot be applied to the committed schema alone: it fails
// to parse, because the column it names does not exist yet.
//
// That ordering was previously the kind of thing you were expected to know. Writing
// it down here makes it TESTED instead: the harness applies the prerequisites first,
// so if somebody reorders or removes 09 this fails immediately rather than at
// `wrangler d1 execute` time against a live database. It is also exactly the
// information PR-35's migration ledger/runner needs in order to apply migrations in
// a defensible order.
const PREREQ_MIGRATIONS = {
  '33-scrub-visitor-ips.sql': ['09-error-log-client-ip.sql'],
};

// Migrations that legitimately do more than CREATE INDEX. Keep this list as short
// as possible: everything on it opts out of the "cannot drop, delete, update or
// alter" guarantee that makes the rest safe to run unattended.
const SCHEMA_ONLY_MIGRATIONS = new Set(['09-error-log-client-ip.sql', '22-login-users-totp.sql', '24-ai-providers-purpose.sql', '25-ai-providers-priority.sql', '26-ai-providers-data-mode.sql', '27-users-photo.sql']);

// A THIRD category, and the narrowest of the three: a migration whose whole purpose
// is to REMOVE data that should never have been stored.
//
// It could not go in SCHEMA_ONLY_MIGRATIONS. That list permits an UPDATE only as a
// backfill of a column the same migration just ADDED, which is the right rule for a
// schema change and the wrong one here — a scrub necessarily writes columns that
// already exist and that it did not create. Widening that rule to fit would have
// removed the guarantee for the six migrations relying on it.
//
// So this list has its own invariants, asserted below: a scrub may only ever CLEAR a
// field (to '' or via json_remove), never write a value; every UPDATE must be bounded
// by a WHERE; and unlike the schema-changers it must stay fully IDEMPOTENT, so it is
// deliberately NOT excluded from the apply-twice check above.
const DATA_SCRUB_MIGRATIONS = new Set(['33-scrub-visitor-ips.sql']);

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
    for (const prereq of PREREQ_MIGRATIONS[file] || []) {
      assert.ok(
        SCHEMA_FOR_MIGRATION[prereq] === schemaName,
        `${file} declares prerequisite ${prereq}, but they target different databases`
      );
      db.exec(readFileSync(new URL(prereq, MIGRATION_DIR), 'utf8'));
    }
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

// Strip line comments AND single-quoted string literals before scanning for SQL
// keywords, so a seed VALUES('...') that happens to contain a word like "update"
// or "delete" inside prose (e.g. journey page text) is never mistaken for an
// actual DDL/DML statement. '' (an escaped quote inside a literal) is handled.
function sqlWithoutCommentsAndStrings(file) {
  return readFileSync(new URL(file, MIGRATION_DIR), 'utf8')
    .replace(/--.*$/gm, '')            // line comments
    .replace(/'(?:''|[^'])*'/g, "''"); // single-quoted string literals -> empty
}

test('H-10: no INDEX-ONLY migration drops anything or mutates a row', () => {
  for (const file of migrationFiles()) {
    if (SCHEMA_ONLY_MIGRATIONS.has(file)) continue; // asserted explicitly below
    if (DATA_SCRUB_MIGRATIONS.has(file)) continue;  // ditto, with tighter rules
    if (CONSTRAINT_MIGRATIONS.has(file)) continue;  // ditto — triggers, so "UPDATE" appears
    const sql = sqlWithoutCommentsAndStrings(file);
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

// PR-34 — a constraint migration may add guards, but must not touch a single row.
test('H-10: a constraint migration is purely additive', () => {
  for (const file of CONSTRAINT_MIGRATIONS) {
    const sql = sqlWithoutCommentsAndStrings(file);
    assert.ok(!/\bDROP\b/i.test(sql), `${file} must not DROP anything`);
    // DELETE is left BROAD on purpose, unlike INSERT and UPDATE below. It rejects a
    // `DELETE FROM` statement and also a `BEFORE DELETE` trigger — and this repo has
    // decided against both: migration 36 explains at length why a delete guard on
    // `loans` would abort the application's own batched deletion. If a delete trigger
    // is ever genuinely wanted, narrow this to `DELETE\s+FROM` *deliberately*, having
    // re-read that reasoning.
    assert.ok(!/\bDELETE\b/i.test(sql), `${file} must not DELETE (and see the note: no delete triggers either)`);
    assert.ok(!/\bALTER\b/i.test(sql), `${file} must not ALTER a table`);
    // BOTH of these are narrowed to the STATEMENT, not the keyword, because a trigger
    // declaration necessarily names the verb it fires on: `BEFORE INSERT ON x`,
    // `BEFORE UPDATE OF col ON x`. Matching the bare keyword would make it impossible
    // to write a trigger migration at all — which is exactly what the index-only test
    // could not distinguish, and why this category exists.
    assert.ok(
      !/\bINSERT\s+INTO\b/i.test(sql),
      `${file} must not contain an INSERT INTO statement`
    );
    assert.ok(
      !/\bUPDATE\s+\w+\s+SET\b/i.test(sql),
      `${file} must not contain an UPDATE ... SET statement`
    );
    // Everything it creates has to be re-runnable.
    for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(IF NOT EXISTS\s+)?/gi)) {
      assert.ok(m[1], `${file} has a CREATE INDEX without IF NOT EXISTS`);
    }
    for (const m of sql.matchAll(/CREATE\s+TRIGGER\s+(IF NOT EXISTS\s+)?/gi)) {
      assert.ok(m[1], `${file} has a CREATE TRIGGER without IF NOT EXISTS`);
    }
    // A trigger that does not ABORT is not enforcing anything.
    if (/CREATE\s+TRIGGER/i.test(sql)) {
      assert.match(sql, /RAISE\s*\(\s*ABORT/i, `${file} defines a trigger that never aborts`);
    }
  }
});

// C12 — a data-scrub migration may only ever take data AWAY.
test('H-10: a data-scrub migration only clears fields, and stays idempotent', () => {
  for (const file of DATA_SCRUB_MIGRATIONS) {
    // NOT sqlWithoutCommentsAndStrings() here. That helper blanks every string
    // literal to '', which is fine for the keyword checks it was written for but
    // would make `SET client_ip = 'REDACTED'` indistinguishable from
    // `SET client_ip = ''` — i.e. it would blind the one rule this test exists to
    // enforce. Comments are still stripped, so prose in the header cannot trip it.
    const sql = readFileSync(new URL(file, MIGRATION_DIR), 'utf8').replace(/--.*$/gm, '');
    assert.ok(!/\bDROP\b/i.test(sql), `${file} must not DROP anything`);
    assert.ok(!/\bDELETE\b/i.test(sql), `${file} must not DELETE rows`);
    // A scrub removes a value from a row; it never removes the row, and it never
    // changes the shape of the table.
    assert.ok(!/\bALTER\b/i.test(sql), `${file} must not ALTER a table`);
    assert.ok(!/\bINSERT\b/i.test(sql), `${file} must not INSERT`);

    const updates = [...sql.matchAll(/UPDATE\s+(\w+)\s+SET\s+(\w+)\s*=\s*([^\n]+)/gi)];
    assert.ok(updates.length > 0, `${file} is listed as a scrub but UPDATEs nothing`);
    for (const m of updates) {
      const [, table, column, value] = m;
      // The one rule that makes this category safe to run unattended: the new value
      // must be empty, NULL, or the same column with something removed from it. A
      // scrub that can write an arbitrary value is just an unreviewed data edit.
      assert.ok(
        /^''\s*$/.test(value.trim()) ||
        /^NULL\b/i.test(value.trim()) ||
        new RegExp(`^json_remove\\s*\\(\\s*${column}\\b`, 'i').test(value.trim()),
        `${file}: UPDATE ${table} SET ${column} must clear the field (got "${value.trim()}")`
      );
      assert.match(
        sql.slice(sql.indexOf(m[0])), /WHERE/i,
        `${file}: every UPDATE must be bounded by a WHERE`
      );
    }
  }
});

test('C12: the scrub removes both copies of an address and leaves everything else', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaFor('logs.sql'));
  db.exec(readFileSync(new URL('09-error-log-client-ip.sql', MIGRATION_DIR), 'utf8'));

  const row = (id, ip, ctx) => db.prepare(
    'INSERT INTO error_log (error_id, source, page, message, created_at, reported, client_ip, context) VALUES (?,?,?,?,?,0,?,?)'
  ).run(id, 'public-frontend', '/p', 'boom', new Date().toISOString(), ip, ctx);

  const PSEUDO = 'a'.repeat(32);                 // what the new code writes
  row('E1', '203.0.113.47', '{"edgeIp":"203.0.113.47","screen":"390x844"}'); // IPv4, both copies
  row('E2', '2001:db8::1', '{"edgeIp":"2001:db8::1"}');                     // IPv6
  row('E3', 'unknown', '{}');            // the literal the older code substituted
  row('E4', PSEUDO, '{"screen":"800x600"}');     // already pseudonymised — must survive
  row('E5', '', 'not json at all');              // must not abort the statement

  const sql = readFileSync(new URL('33-scrub-visitor-ips.sql', MIGRATION_DIR), 'utf8');
  db.exec(sql);
  db.exec(sql); // idempotent: a second run must not throw or change anything further

  const all = db.prepare('SELECT error_id, client_ip, context FROM error_log ORDER BY error_id').all();
  const get = (id) => all.find((r) => r.error_id === id);

  // Not one raw address survives, in either column.
  const dump = JSON.stringify(all);
  assert.ok(!dump.includes('203.0.113.47'), `an IPv4 survived the scrub: ${dump}`);
  assert.ok(!dump.includes('2001:db8::1'), `an IPv6 survived the scrub: ${dump}`);
  // 'unknown' is not an address, but it is not a pseudonym either — the condition is
  // "not a pseudonym" precisely so shapes nobody anticipated are still cleared.
  assert.equal(get('E3').client_ip, '');

  // The scrub is a privacy fix, not a data cull: the rest of the context stays.
  assert.equal(JSON.parse(get('E1').context).screen, '390x844');
  assert.equal(JSON.parse(get('E1').context).edgeIp, undefined);
  // A real pseudonym is left alone.
  assert.equal(get('E4').client_ip, PSEUDO);
  assert.equal(JSON.parse(get('E4').context).screen, '800x600');
  // A row whose context was never valid JSON is skipped, not corrupted — and its
  // presence did not abort the UPDATE for the rows above.
  assert.equal(get('E5').context, 'not json at all');

  db.close();
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
