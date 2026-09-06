// ============ receipt_work WhatsApp auto-attach tolerance ============
//
// A WhatsApp person/group template auto-attaches the generated PDF when its
// file_doc_type matches the document the collection produced. After the
// receipt_work split, a Service (Work) + Receipt contribution generates a
// `receipt_work` PDF — but templates authored earlier were set to attach
// `receipt`. `receipt` and `receipt_work` are now treated as interchangeable so
// those templates still attach the file, instead of silently attaching nothing.
// `samaan` / `certificate` stay strict (genuinely different documents).
//
// Run: node --test mgmt/backend/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { triggerCollectionMessages } from '../src/whatsapp.js';

const LINK = 'https://drive.example/generated.pdf';

function makeEnv() {
  const core = makeD1(schemaFor('core.sql'));
  const wa = makeD1(schemaFor('whatsapp_index.sql'));
  // A contributor with a valid 10-digit mobile so a person message can queue.
  core.prepare('INSERT INTO users (id_code, name, mobile, whatsapp) VALUES (?,?,?,?)')
    .bind('USER0001', 'Kuldeep', 7282032146, 7282032146).run();
  return { DB_CORE: core, DB_WHATSAPP_INDEX: wa, DB_LOGS: makeD1(schemaFor('logs.sql')) };
}

// Seed a person template for contribution type 3 with a given file_doc_type.
function seedPersonTemplate(env, fileDocType) {
  env.DB_WHATSAPP_INDEX.prepare(
    `INSERT INTO person_message_templates (template_id, text, active, created_at, message_type, contribution_type, doc_sub_type, file_doc_type)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind('TPL1', 'Thank you {Name}', '1', '2026-01-01', 'normal', 3, 'Receipt', fileDocType).run();
}

async function queuedPersonFileLink(env) {
  const row = await env.DB_WHATSAPP_INDEX
    .prepare('SELECT file_link FROM person_messages ORDER BY id DESC LIMIT 1').first();
  return row ? row.file_link : null;
}

const workPayload = {
  Name: 'USER0001', Year: 2026, Amount: 500,
  'Contribution Type': 3, 'Certificate Or Receipt': 'Receipt', 'Is Resell': '',
};

test('a template set to attach `receipt` still attaches a receipt_work PDF', async () => {
  const env = makeEnv();
  seedPersonTemplate(env, 'receipt'); // authored before the split
  await triggerCollectionMessages(env, workPayload, 'receipt_work', 'receipt_work-2026-1', LINK);
  assert.equal(await queuedPersonFileLink(env), LINK, 'the work receipt should be attached');
});

test('a template set to attach `receipt_work` attaches it (exact match)', async () => {
  const env = makeEnv();
  seedPersonTemplate(env, 'receipt_work');
  await triggerCollectionMessages(env, workPayload, 'receipt_work', 'receipt_work-2026-1', LINK);
  assert.equal(await queuedPersonFileLink(env), LINK);
});

test('a plain `receipt` collection still attaches a template set to `receipt_work`', async () => {
  const env = makeEnv();
  seedPersonTemplate(env, 'receipt_work');
  const cashPayload = { ...workPayload, 'Contribution Type': 1, 'Certificate Or Receipt': '' };
  // The template is type-3, but templatesForContribution matches by type; use a
  // type-3 receipt collection to hit it, with docType 'receipt' (the equivalence).
  await triggerCollectionMessages(env, { ...workPayload }, 'receipt', 'receipt-2026-1', LINK);
  assert.equal(await queuedPersonFileLink(env), LINK, 'receipt <-> receipt_work are interchangeable');
});

test('samaan is NOT attached to a receipt_work document (strict)', async () => {
  const env = makeEnv();
  seedPersonTemplate(env, 'samaan'); // genuinely wrong doc type
  await triggerCollectionMessages(env, workPayload, 'receipt_work', 'receipt_work-2026-1', LINK);
  assert.equal(await queuedPersonFileLink(env), '', 'a material receipt must not be attached to a work receipt');
});

test('certificate is NOT attached to a receipt_work document (strict)', async () => {
  const env = makeEnv();
  seedPersonTemplate(env, 'certificate');
  await triggerCollectionMessages(env, workPayload, 'receipt_work', 'receipt_work-2026-1', LINK);
  assert.equal(await queuedPersonFileLink(env), '', 'a certificate must not be attached to a work receipt');
});
