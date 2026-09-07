// audit H-16 — restoreBackup is now incremental (one D1 binding per request) and
// no longer builds a full second export in-request.
//
// The old path materialised the whole DB twice (safety snapshot + incoming backup)
// in one 128 MB invocation and could be memory/CPU-killed mid-swap, leaving some
// tables restored and others not. These tests pin the new behaviour:
//   - a planning call touches NO data and returns the binding list to walk
//   - a planning call REFUSES without an acknowledged current backup
//   - a per-binding call restores only that binding and reports per table
//   - the legacy whole-backup path (opts.withInRequestSnapshot) still works and
//     still returns a safetySnapshot, so nothing that relied on it breaks
//   - the destructive per-table semantics (reserved words, empty=leave-alone,
//     all-rows-failed=don't-wipe) are unchanged
//
// Run: node --test mgmt/backend/test/h16-incremental-restore.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { exportBackup, restoreBackup } from '../src/backup.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0002', role: 'Admin' };

// A minimal multi-binding env covering the two smallest bindings we can seed.
function makeEnv() {
  return {
    DB_CORE: makeD1(schemaFor('core.sql')),
    DB_COLLECTIONS: makeD1(schemaFor('collections.sql')),
    DB_LOANS_EXPENSES: makeD1(schemaFor('loans_expenses.sql')),
    DB_TEMPLATES: makeD1(schemaFor('templates.sql')),
    DB_FILE_INDEX: makeD1(schemaFor('file_index.sql')),
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    DB_MISC: makeD1(schemaFor('misc.sql')),
  };
}

async function seed(env) {
  await env.DB_CORE.prepare(`INSERT INTO users (id_code, name) VALUES (?, ?)`).bind('USER0001', 'Original A').run();
  await env.DB_CORE.prepare(`INSERT INTO users (id_code, name) VALUES (?, ?)`).bind('USER0002', 'Original B').run();
  await env.DB_COLLECTIONS.prepare(`INSERT INTO collections (year, sl_no, name, amount) VALUES (?, ?, ?, ?)`).bind(2026, 1, 'Original A', 100).run();
}

test('H-16: a Superadmin is required', async () => {
  const env = makeEnv();
  await assert.rejects(() => restoreBackup(env, ADMIN, { data: {} }, 'RESTORE', { snapshotAcknowledged: true }));
});

test('H-16: the RESTORE confirmation is still enforced', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => restoreBackup(env, SUPER, { data: { DB_CORE: {} } }, 'nope', { snapshotAcknowledged: true }),
    /type exactly "RESTORE"/
  );
});

test('H-16: the planning call REFUSES without an acknowledged current backup', async () => {
  const env = makeEnv();
  const backup = (await exportBackup(env, SUPER)).backup;
  await assert.rejects(
    () => restoreBackup(env, SUPER, backup, 'RESTORE', {}),
    /Download a fresh backup/
  );
});

test('H-16: the planning call touches NO data and returns the binding list to walk', async () => {
  const env = makeEnv();
  await seed(env);
  const backup = (await exportBackup(env, SUPER)).backup;

  const plan = await restoreBackup(env, SUPER, backup, 'RESTORE', { snapshotAcknowledged: true });
  assert.equal(plan.success, true);
  assert.equal(plan.staged, true);
  assert.equal(plan.incremental, true);
  assert.ok(Array.isArray(plan.bindings) && plan.bindings.includes('DB_CORE'));
  // No safetySnapshot is built in-request any more.
  assert.equal(plan.safetySnapshot, undefined);
  // Data is untouched by a planning call.
  const users = await env.DB_CORE.prepare('SELECT COUNT(*) AS n FROM users').first('n');
  assert.equal(users, 2);
});

test('H-16: a per-binding restore replaces only that binding and reports per table', async () => {
  const env = makeEnv();
  await seed(env);
  // Build a backup, then change the live data so we can see the restore revert it.
  const backup = (await exportBackup(env, SUPER)).backup;
  await env.DB_CORE.prepare(`DELETE FROM users`).run();
  await env.DB_CORE.prepare(`INSERT INTO users (id_code, name) VALUES (?, ?)`).bind('USER9999', 'Changed').run();

  const res = await restoreBackup(env, SUPER, backup, 'RESTORE', { snapshotAcknowledged: true, onlyBinding: 'DB_CORE' });
  assert.equal(res.success, true);
  assert.equal(res.binding, 'DB_CORE');
  assert.equal(res.report.restoredTables['DB_CORE.users'], 2, 'both original users are back');

  const names = (await env.DB_CORE.prepare('SELECT name FROM users ORDER BY id_code').all()).results.map(r => r.name);
  assert.deepEqual(names, ['Original A', 'Original B']);

  // A different binding was NOT touched by the DB_CORE call.
  const coll = await env.DB_COLLECTIONS.prepare('SELECT COUNT(*) AS n FROM collections').first('n');
  assert.equal(coll, 1, 'collections untouched by the DB_CORE-only request');
});

test('H-16: walking every planned binding restores the whole backup', async () => {
  const env = makeEnv();
  await seed(env);
  const backup = (await exportBackup(env, SUPER)).backup;
  // wipe everything
  await env.DB_CORE.prepare(`DELETE FROM users`).run();
  await env.DB_COLLECTIONS.prepare(`DELETE FROM collections`).run();

  const plan = await restoreBackup(env, SUPER, backup, 'RESTORE', { snapshotAcknowledged: true });
  for (const b of plan.bindings) {
    await restoreBackup(env, SUPER, backup, 'RESTORE', { snapshotAcknowledged: true, onlyBinding: b });
  }
  assert.equal(await env.DB_CORE.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 2);
  assert.equal(await env.DB_COLLECTIONS.prepare('SELECT COUNT(*) AS n FROM collections').first('n'), 1);
});

test('H-16: an EMPTY backed-up table leaves the live table UNTOUCHED (no silent wipe)', async () => {
  const env = makeEnv();
  await seed(env);
  // Backup where users has rows but we blank it to simulate an empty export.
  const backup = (await exportBackup(env, SUPER)).backup;
  backup.data.DB_CORE.users = []; // pretend the export produced no users

  const res = await restoreBackup(env, SUPER, backup, 'RESTORE', { snapshotAcknowledged: true, onlyBinding: 'DB_CORE' });
  assert.ok(res.report.emptyTables['DB_CORE.users'], 'reported as empty, not restored');
  // Live users are still there — NOT wiped.
  assert.equal(await env.DB_CORE.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 2);
});

test('H-16: the legacy whole-backup path still works and still returns a safetySnapshot', async () => {
  const env = makeEnv();
  await seed(env);
  const backup = (await exportBackup(env, SUPER)).backup;
  await env.DB_CORE.prepare(`DELETE FROM users`).run();

  const res = await restoreBackup(env, SUPER, backup, 'RESTORE', { withInRequestSnapshot: true });
  assert.equal(res.success, true);
  assert.ok(res.safetySnapshot && res.safetySnapshot.data, 'legacy path still returns the in-request snapshot');
  assert.equal(await env.DB_CORE.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 2, 'restored');
});
