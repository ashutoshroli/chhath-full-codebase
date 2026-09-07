// free-plan (Cloudflare 50-subrequest-per-invocation cap): the group-message loop
// in triggerCollectionMessages does one D1 INSERT per ACTIVE WhatsApp group in a
// single invocation. A committee has a handful of groups, but nothing stops an
// admin activating many; MAX_GROUPS_PER_JOB caps the per-job fan-out so one save
// can't approach the subrequest limit. These tests pin that cap and confirm the
// contributor lookup still works after switching the full USERS scan to a single
// indexed userByIdCode() lookup.
//
// Run: node --test mgmt/backend/test/free-plan-group-cap.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { triggerCollectionMessages, MAX_GROUPS_PER_JOB } from '../src/whatsapp.js';

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const wa = makeD1(schemaFor('whatsapp_index.sql'));
  core.prepare('INSERT INTO users (id_code, name, mobile, whatsapp) VALUES (?,?,?,?)')
    .bind('USER0001', 'Kuldeep', '7282032146', '7282032146').run();
  return { DB_CORE: core, DB_WHATSAPP_INDEX: wa, DB_LOGS: makeD1(schemaFor('logs.sql')) };
}

function seedGroups(env, n) {
  for (let i = 1; i <= n; i++) {
    env.DB_WHATSAPP_INDEX.prepare(
      `INSERT INTO whatsapp_groups (group_id, group_name, groupid, active, created_at) VALUES (?,?,?,?,?)`
    ).bind(`G${i}`, `Group ${i}`, `1203630${String(i).padStart(6, '0')}@g.us`, '1', '2026-01-01').run();
  }
}

function seedGroupTemplate(env) {
  env.DB_WHATSAPP_INDEX.prepare(
    `INSERT INTO group_message_templates (template_id, text, active, created_at, message_type, contribution_type, doc_sub_type, file_doc_type)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind('GT1', 'Thanks {Name} for {Amount}', '1', '2026-01-01', 'normal', 1, '', '').run();
}

const cashPayload = {
  Name: 'USER0001', Year: 2026, Amount: 500,
  'Contribution Type': 1, 'Certificate Or Receipt': '', 'Is Resell': '', 'Created By': 'USER0001',
};

const countGroupMsgs = async (env) =>
  (await env.DB_WHATSAPP_INDEX.prepare('SELECT COUNT(*) AS n FROM group_messages').first('n'));

test('free-plan: with fewer active groups than the cap, ALL get a message', async () => {
  const env = makeEnv();
  seedGroups(env, 3);
  seedGroupTemplate(env);
  await triggerCollectionMessages(env, cashPayload, 'receipt', 'receipt-2026-1', 'https://x/f.pdf');
  assert.equal(await countGroupMsgs(env), 3, 'all 3 active groups messaged');
});

test('free-plan: MORE active groups than the cap -> only MAX_GROUPS_PER_JOB messaged (subrequest cap safety)', async () => {
  const env = makeEnv();
  const many = MAX_GROUPS_PER_JOB + 12;
  seedGroups(env, many);
  seedGroupTemplate(env);
  await triggerCollectionMessages(env, cashPayload, 'receipt', 'receipt-2026-1', 'https://x/f.pdf');
  assert.equal(await countGroupMsgs(env), MAX_GROUPS_PER_JOB, `capped at ${MAX_GROUPS_PER_JOB}, not ${many}`);
  // The cap is logged, not silent.
  const warned = await env.DB_LOGS.prepare(
    "SELECT COUNT(*) AS n FROM error_log WHERE message LIKE '%exceed the per-job cap%'"
  ).first('n');
  assert.ok(warned >= 1, 'the cap must be logged for the operator');
});

test('free-plan: contributor person-message still queues after the full-USERS-scan removal', async () => {
  const env = makeEnv();
  seedGroups(env, 1);
  seedGroupTemplate(env);
  // person template so a personal message is attempted (proves userByIdCode found the contributor)
  env.DB_WHATSAPP_INDEX.prepare(
    `INSERT INTO person_message_templates (template_id, text, active, created_at, message_type, contribution_type, doc_sub_type, file_doc_type)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind('PT1', 'Hi {Name}', '1', '2026-01-01', 'normal', 1, '', '').run();
  await triggerCollectionMessages(env, cashPayload, 'receipt', 'receipt-2026-1', 'https://x/f.pdf');
  const person = await env.DB_WHATSAPP_INDEX.prepare('SELECT COUNT(*) AS n FROM person_messages').first('n');
  assert.equal(person, 1, 'the contributor (found via indexed lookup) got a personal message');
});
