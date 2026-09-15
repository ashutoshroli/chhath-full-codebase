// ====== AUDIT P0-07 — "Full Backup" must actually be full ======
//
// BACKUP_MAP was an old 8-database list while the deployment binds NINE, and it
// omitted 12 tables added since. Anything missing from it is never exported and
// therefore CANNOT be restored — while the UI called the download a "Full Backup"
// and the reset runbook offered it as an alternative to the CLI export.
//
// The first test here is the one that stops it happening again: it parses the
// committed schemas and fails if the schema and BACKUP_MAP disagree in either
// direction. The rest pin the v2 manifest and the restore semantics it enables.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, makeKV, schemaFor } from './helpers/stubs.mjs';
import { exportBackup, restoreBackup, _backupCoverage, SCHEMA_FILE_FOR_BINDING } from '../src/backup.js';

const SUPERADMIN = { name: 'USER0001', role: 'Superadmin' };
const { map: BACKUP_MAP, excludedColumns: EXCLUDED_COLUMNS } = _backupCoverage();

// Tables declared in a schema file. Handles both `CREATE TABLE x (` and the
// `CREATE TABLE IF NOT EXISTS\nx (` shape used in some of these files.
function schemaTables(file) {
  const sql = readFileSync(new URL(`../../db/schema/${file}`, import.meta.url), 'utf8');
  const names = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([a-z][a-z0-9_]*)["'`]?\s*\(/gis;
  let m;
  while ((m = re.exec(sql)) !== null) names.add(m[1].toLowerCase());
  return names;
}

// ============================== 1. THE GUARD THAT STOPS THE DRIFT

test('P0-07: every table in every committed schema is in BACKUP_MAP', () => {
  const missing = [];
  for (const [binding, file] of Object.entries(SCHEMA_FILE_FOR_BINDING)) {
    const declared = schemaTables(file);
    const backed = new Set(BACKUP_MAP[binding] || []);
    assert.ok(declared.size > 0, `${file} should declare at least one table`);
    for (const table of declared) {
      if (!backed.has(table)) missing.push(`${binding}.${table} (schema/${file})`);
    }
  }
  assert.deepEqual(missing, [],
    'these tables would be silently absent from every backup — add them to BACKUP_MAP');
});

test('P0-07: BACKUP_MAP does not name tables the schema does not have', () => {
  const unknown = [];
  for (const [binding, tables] of Object.entries(BACKUP_MAP)) {
    const file = SCHEMA_FILE_FOR_BINDING[binding];
    assert.ok(file, `${binding} must be mapped to a schema file`);
    const declared = schemaTables(file);
    for (const table of tables) {
      if (!declared.has(table)) unknown.push(`${binding}.${table}`);
    }
  }
  assert.deepEqual(unknown, [], 'these would fail at export/restore time');
});

test('P0-07: all nine D1 bindings are covered, including the audit database', () => {
  assert.equal(Object.keys(BACKUP_MAP).length, 9);
  for (const binding of ['DB_CORE', 'DB_COLLECTIONS', 'DB_LOANS_EXPENSES', 'DB_TEMPLATES',
    'DB_FILE_INDEX', 'DB_WHATSAPP_INDEX', 'DB_LOGS', 'DB_MISC', 'DB_AUDIT']) {
    assert.ok(BACKUP_MAP[binding], `${binding} must be backed up`);
  }
  // The 12 tables the audit found missing.
  const expectations = {
    DB_AUDIT: ['user_sessions', 'login_attempts'],
    DB_CORE: ['journey_entries', 'push_subscriptions'],
    DB_LOANS_EXPENSES: ['loan_email_templates'],
    DB_WHATSAPP_INDEX: ['email_message_templates', 'email_messages', 'official_emails'],
    DB_LOGS: ['ai_fixes', 'ai_providers'],
    DB_MISC: ['collection_jobs', 'render_jobs'],
  };
  for (const [binding, tables] of Object.entries(expectations)) {
    for (const t of tables) {
      assert.ok(BACKUP_MAP[binding].includes(t), `${binding}.${t} must now be backed up`);
    }
  }
});

test('P0-07: the only excluded column is the transient job blob', () => {
  assert.deepEqual(EXCLUDED_COLUMNS, { collection_jobs: ['filled_base64'] });
});

// ============================== 2. THE EXPORT AND ITS MANIFEST

function makeEnv({ omitBinding = null } = {}) {
  const env = {
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
    DB_AUDIT: makeD1(schemaFor('audit.sql')),
    KV_SESSIONS: makeKV(),
  };
  if (omitBinding) delete env[omitBinding];
  return env;
}

test('P0-07: the export now contains the audit database and the other new tables', async () => {
  const env = makeEnv();
  env.DB_AUDIT.prepare(
    'INSERT INTO user_sessions (token_hash, name, role, created_at, expires_at) VALUES (?,?,?,?,?)'
  ).bind('hash-1', 'USER0001', 'Superadmin', '2026-09-01', Date.now() + 60000).run();
  env.DB_CORE.prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?,?,?)')
    .bind('https://push.example/1', 'k', 'a').run();
  env.DB_LOGS.prepare('INSERT INTO ai_providers (provider_id, name, type) VALUES (?,?,?)')
    .bind('AP-1', 'Test', 'anthropic').run();

  const { backup } = await exportBackup(env, SUPERADMIN);

  // On main DB_AUDIT is absent from the file entirely.
  assert.equal(backup.data.DB_AUDIT.user_sessions.length, 1);
  assert.equal(backup.data.DB_CORE.push_subscriptions.length, 1);
  assert.equal(backup.data.DB_LOGS.ai_providers.length, 1);
  assert.equal(backup.formatVersion, 2);
  assert.equal(backup.coverage.bindings, 9);
  assert.ok(backup.coverage.tables >= 40, `expected 40+ tables, got ${backup.coverage.tables}`);
});

test('P0-07: the manifest separates "present and empty" from "not on this deployment"', async () => {
  const env = makeEnv();
  env.DB_COLLECTIONS.prepare('INSERT INTO collections (year, name, amount) VALUES (?,?,?)')
    .bind(2026, 'USER0002', 500).run();

  const { backup } = await exportBackup(env, SUPERADMIN);

  assert.deepEqual(backup.manifest['DB_COLLECTIONS.collections'], { rows: 1, present: true });
  // A table that exists but has nothing in it.
  assert.deepEqual(backup.manifest['DB_MISC.render_jobs'], { rows: 0, present: true });
});

test('P0-07: a missing binding is reported as a real gap, not silently dropped', async () => {
  const env = makeEnv({ omitBinding: 'DB_AUDIT' });

  const res = await exportBackup(env, SUPERADMIN);

  assert.equal(res.backup.manifest['DB_AUDIT.user_sessions'].present, false);
  assert.match(res.backup.manifest['DB_AUDIT.user_sessions'].reason, /binding not configured/);
  assert.deepEqual(res.backup.coverage.missingBindings, ['DB_AUDIT']);
  assert.ok(res.warnings.some(w => /NOT in the backup/.test(w)), 'the operator is warned');
});

test('P0-07: the transient job blob is excluded but the job row is kept', async () => {
  const env = makeEnv();
  env.DB_MISC.prepare(
    'INSERT INTO collection_jobs (job_id, status, doc_type, year, record_id, payload, filled_base64) VALUES (?,?,?,?,?,?,?)'
  ).bind('JOB-1', 'pending', 'receipt', '2026', 'receipt-2026-1', '{}', 'A'.repeat(2000)).run();

  const { backup } = await exportBackup(env, SUPERADMIN);

  const [job] = backup.data.DB_MISC.collection_jobs;
  assert.equal(job.job_id, 'JOB-1');
  assert.equal(job.status, 'pending');
  assert.equal(job.filled_base64, undefined, 'the ~700 KB blob is not in the backup');
  assert.deepEqual(backup.excludedColumns.collection_jobs, ['filled_base64']);
});

// ============================== 3. RESTORE HONOURS THE MANIFEST

const restoreArgs = (backup, binding) => [backup, 'RESTORE', { onlyBinding: binding, snapshotAcknowledged: true }];

test('P0-07: a table recorded as present-and-empty is CLEARED on restore', async () => {
  const source = makeEnv();
  const { backup } = await exportBackup(source, SUPERADMIN); // collections empty, present

  // The live deployment has rows that were added after the backup.
  const target = makeEnv();
  target.DB_COLLECTIONS.prepare('INSERT INTO collections (year, name, amount) VALUES (?,?,?)')
    .bind(2026, 'USER0002', 500).run();

  const res = await restoreBackup(target, SUPERADMIN, ...restoreArgs(backup, 'DB_COLLECTIONS'));

  assert.equal(res.success, true);
  const n = await target.DB_COLLECTIONS.prepare('SELECT COUNT(*) AS n FROM collections').first('n');
  // On main the empty table is skipped and the row survives, so the restore does
  // NOT reproduce the state the backup captured.
  assert.equal(Number(n), 0, 'the restore reproduces the captured state');
  assert.match(res.report.emptyTables['DB_COLLECTIONS.collections'], /cleared to match/);
});

test('P0-07: an OLD (v1) backup still leaves an empty table untouched', async () => {
  const target = makeEnv();
  target.DB_COLLECTIONS.prepare('INSERT INTO collections (year, name, amount) VALUES (?,?,?)')
    .bind(2026, 'USER0002', 500).run();

  // A v1 file: no manifest, so 0 rows is NOT authoritative.
  const legacy = { formatVersion: 1, data: { DB_COLLECTIONS: { collections: [] } } };
  const res = await restoreBackup(target, SUPERADMIN, ...restoreArgs(legacy, 'DB_COLLECTIONS'));

  assert.equal(res.success, true);
  const n = await target.DB_COLLECTIONS.prepare('SELECT COUNT(*) AS n FROM collections').first('n');
  assert.equal(Number(n), 1, 'a v1 backup must not wipe a table on the strength of an empty array');
  assert.match(res.report.emptyTables['DB_COLLECTIONS.collections'], /older backup format/);
});

test('P0-07: a normal round-trip restores the rows', async () => {
  const source = makeEnv();
  source.DB_AUDIT.prepare(
    'INSERT INTO user_sessions (token_hash, name, role, created_at, expires_at) VALUES (?,?,?,?,?)'
  ).bind('hash-1', 'USER0001', 'Superadmin', '2026-09-01', Date.now() + 60000).run();
  const { backup } = await exportBackup(source, SUPERADMIN);

  const target = makeEnv();
  const res = await restoreBackup(target, SUPERADMIN, ...restoreArgs(backup, 'DB_AUDIT'));

  assert.equal(res.success, true, JSON.stringify(res.report.errors));
  const row = await target.DB_AUDIT.prepare('SELECT name, role FROM user_sessions').first();
  assert.equal(row.name, 'USER0001');
  assert.equal(res.report.restoredTables['DB_AUDIT.user_sessions'], 1);
});

test('P0-07: the planning call lists every binding present in the file', async () => {
  const env = makeEnv();
  const { backup } = await exportBackup(env, SUPERADMIN);

  const plan = await restoreBackup(env, SUPERADMIN, backup, 'RESTORE', { snapshotAcknowledged: true });

  assert.equal(plan.staged, true);
  assert.equal(plan.bindings.length, 9, 'all nine databases are walked, including DB_AUDIT');
  assert.ok(plan.bindings.includes('DB_AUDIT'));
});

test('P0-07: restore still needs the typed confirmation and the acknowledged backup', async () => {
  const env = makeEnv();
  const { backup } = await exportBackup(env, SUPERADMIN);

  await assert.rejects(() => restoreBackup(env, SUPERADMIN, backup, 'yes', { snapshotAcknowledged: true }),
    /type exactly "RESTORE"/);
  await assert.rejects(() => restoreBackup(env, SUPERADMIN, backup, 'RESTORE', {}),
    /Download a fresh backup/);
  await assert.rejects(() => restoreBackup(env, { name: 'USER0002', role: 'Admin' }, backup, 'RESTORE', { snapshotAcknowledged: true }),
    (err) => { assert.equal(err.permission, true); return true; });
});
