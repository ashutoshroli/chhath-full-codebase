// ============ Manual data cleanup (Superadmin) ============
// Allowlisted targets, modes (all/sent/failed/olderThan), bounded delete,
// preview count, and role gating.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { cleanupData, cleanupPreview } from '../src/cleanup.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0010', role: 'Admin' };

function makeEnv() {
  return {
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
  };
}
const isoAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

function seedPersonMsg(env, status, daysAgo) {
  env.DB_WHATSAPP_INDEX.prepare('INSERT INTO person_messages (message_id, mobileno, message, status, created_at) VALUES (?,?,?,?,?)')
    .bind('M' + Math.random(), '919000000000', 'x', status, isoAgo(daysAgo)).run();
}
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');

test('cleanup rejects an unknown target', async () => {
  const env = makeEnv();
  await assert.rejects(() => cleanupData(env, 'users', 'all', null, SUPER), /Unknown cleanup target/);
});

test('cleanup is Superadmin-only', async () => {
  const env = makeEnv();
  await assert.rejects(() => cleanupData(env, 'error_log', 'all', null, ADMIN));
});

test('mode "all" clears every row in the target (both WhatsApp tables)', async () => {
  const env = makeEnv();
  seedPersonMsg(env, 'sent', 1);
  seedPersonMsg(env, 'failed', 1);
  env.DB_WHATSAPP_INDEX.prepare('INSERT INTO group_messages (message_id, groupid, message, status, created_at) VALUES (?,?,?,?,?)')
    .bind('G1', 'g@g.us', 'x', 'sent', isoAgo(1)).run();
  const res = await cleanupData(env, 'whatsapp_messages', 'all', null, SUPER);
  assert.equal(res.removed, 3);
  assert.equal(await count(env.DB_WHATSAPP_INDEX, 'person_messages'), 0);
  assert.equal(await count(env.DB_WHATSAPP_INDEX, 'group_messages'), 0);
});

test('mode "failed" deletes only failed rows; "sent" only sent', async () => {
  const env = makeEnv();
  seedPersonMsg(env, 'sent', 1);
  seedPersonMsg(env, 'sent', 1);
  seedPersonMsg(env, 'failed', 1);
  const f = await cleanupData(env, 'whatsapp_messages', 'failed', null, SUPER);
  assert.equal(f.removed, 1);
  assert.equal(await count(env.DB_WHATSAPP_INDEX, 'person_messages'), 2, 'the two sent rows remain');
  const s = await cleanupData(env, 'whatsapp_messages', 'sent', null, SUPER);
  assert.equal(s.removed, 2);
  assert.equal(await count(env.DB_WHATSAPP_INDEX, 'person_messages'), 0);
});

test('mode "olderThan" keeps the last N days and deletes older', async () => {
  const env = makeEnv();
  seedPersonMsg(env, 'sent', 40); // old -> delete
  seedPersonMsg(env, 'sent', 5);  // recent -> keep
  const res = await cleanupData(env, 'whatsapp_messages', 'olderThan', 30, SUPER);
  assert.equal(res.removed, 1);
  assert.equal(await count(env.DB_WHATSAPP_INDEX, 'person_messages'), 1);
});

test('logs (no status) reject sent/failed but allow all + olderThan', async () => {
  const env = makeEnv();
  env.DB_LOGS.prepare('INSERT INTO error_log (error_id, source, page, message, created_at) VALUES (?,?,?,?,?)').bind('E1', 's', 'p', 'm', isoAgo(200)).run();
  env.DB_LOGS.prepare('INSERT INTO error_log (error_id, source, page, message, created_at) VALUES (?,?,?,?,?)').bind('E2', 's', 'p', 'm', isoAgo(2)).run();

  await assert.rejects(() => cleanupData(env, 'error_log', 'sent', null, SUPER), /no sent\/failed status/i);

  const res = await cleanupData(env, 'error_log', 'olderThan', 30, SUPER);
  assert.equal(res.removed, 1, 'only the 200-day-old error is removed');
  assert.equal(await count(env.DB_LOGS, 'error_log'), 1);
});

test('activity_log uses its timestamp column for olderThan', async () => {
  const env = makeEnv();
  env.DB_LOGS.prepare('INSERT INTO activity_log (timestamp, name, action) VALUES (?,?,?)').bind(isoAgo(400), 'USER0001', 'add').run();
  env.DB_LOGS.prepare('INSERT INTO activity_log (timestamp, name, action) VALUES (?,?,?)').bind(isoAgo(10), 'USER0001', 'add').run();
  const res = await cleanupData(env, 'activity_log', 'olderThan', 90, SUPER);
  assert.equal(res.removed, 1);
});

test('cleanupPreview counts without deleting', async () => {
  const env = makeEnv();
  seedPersonMsg(env, 'failed', 1);
  seedPersonMsg(env, 'failed', 1);
  seedPersonMsg(env, 'sent', 1);
  const p = await cleanupPreview(env, 'whatsapp_messages', 'failed', null, SUPER);
  assert.equal(p.count, 2);
  assert.equal(await count(env.DB_WHATSAPP_INDEX, 'person_messages'), 3, 'preview must not delete');
});

test('olderThan rejects a bad days value', async () => {
  const env = makeEnv();
  await assert.rejects(() => cleanupData(env, 'error_log', 'olderThan', 'abc', SUPER), /valid number of days/i);
});
