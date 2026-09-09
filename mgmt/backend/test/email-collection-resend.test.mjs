// ============ Collection Email (Resend) ============
//
// Mirrors the WhatsApp collection flow but the Worker sends directly via the
// Resend HTTPS API (no external poller). These tests cover:
//   * triggerCollectionEmail queues a rendered email (subject + body) to the
//     contributor's users.email, resolving the PDF link like WhatsApp does;
//   * skip behaviour when there's no email / no template / resell;
//   * processPendingEmails drains the queue: pending -> sent on a 2xx from Resend,
//     pending (retry) on a transient failure, and failed once attempts are spent;
//   * no network call and no crash when RESEND_API_KEY is unset.
//
// The global fetch is stubbed per test so nothing hits the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import { triggerCollectionEmail, processPendingEmails } from '../src/email.js';

const PDF_LINK = 'https://drive.example/generated.pdf';

function makeEnv(overrides = {}) {
  const core = makeD1(schemaFor('core.sql'));
  const wa = makeD1(schemaFor('whatsapp_index.sql'));
  // A contributor with an email on file.
  core.prepare('INSERT INTO users (id_code, name, email, mobile) VALUES (?,?,?,?)')
    .bind('USER0001', 'Kuldeep', 'kuldeep@example.com', 7282032146).run();
  return {
    DB_CORE: core,
    DB_WHATSAPP_INDEX: wa,
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    RESEND_API_KEY: 'test-key',
    RESEND_FROM: 'noreply@shaharpura.com',
    RESEND_REPLY_TO: 'shaharpura.815312@gmail.com',
    ...overrides,
  };
}

function seedEmailTemplate(env, { subject = 'Thank you {Name} for {Year}', text = 'Dear {Name}, we received ₹{Amount}.', contributionType = 1, docSubType = '', fileDocType = '' } = {}) {
  env.DB_WHATSAPP_INDEX.prepare(
    `INSERT INTO email_message_templates (template_id, subject, text, active, created_at, message_type, contribution_type, file_link, doc_sub_type, file_doc_type)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind('ETPL1', subject, text, '1', '2026-01-01', 'normal', contributionType, '', docSubType, fileDocType).run();
}

async function lastQueuedEmail(env) {
  return env.DB_WHATSAPP_INDEX.prepare('SELECT * FROM email_messages ORDER BY id DESC LIMIT 1').first();
}

const cashPayload = { Name: 'USER0001', Year: 2026, Amount: 500, 'Contribution Type': 1, 'Certificate Or Receipt': '', 'Is Resell': '' };

// ---- stub fetch ----
let originalFetch;
function stubFetch(fn) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = fn;
}
function restoreFetch() {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = undefined;
}

// ------------------------------------------------------------------ trigger

test('triggerCollectionEmail queues a rendered email to the contributor', async () => {
  const env = makeEnv();
  seedEmailTemplate(env);
  const res = await triggerCollectionEmail(env, cashPayload, 'receipt', 'receipt-2026-1', PDF_LINK);
  assert.equal(res.emailSent, true);
  const row = await lastQueuedEmail(env);
  assert.equal(row.to_email, 'kuldeep@example.com');
  assert.equal(row.subject, 'Thank you Kuldeep for 2026', 'subject placeholders resolved');
  assert.equal(row.body, 'Dear Kuldeep, we received ₹500.', 'body placeholders resolved');
  assert.equal(row.status, 'pending');
  assert.equal(row.from, 'noreply@shaharpura.com');
  assert.equal(row.reply_to, 'shaharpura.815312@gmail.com');
});

test('triggerCollectionEmail attaches the generated PDF link when file_doc_type matches (receipt~receipt_work)', async () => {
  const env = makeEnv();
  seedEmailTemplate(env, { fileDocType: 'receipt' });
  await triggerCollectionEmail(env, cashPayload, 'receipt_work', 'receipt_work-2026-1', PDF_LINK);
  const row = await lastQueuedEmail(env);
  assert.equal(row.file_link, PDF_LINK, 'receipt and receipt_work are interchangeable');
});

test('triggerCollectionEmail does NOT attach a mismatched doc type (samaan vs receipt)', async () => {
  const env = makeEnv();
  seedEmailTemplate(env, { fileDocType: 'samaan' });
  await triggerCollectionEmail(env, cashPayload, 'receipt', 'receipt-2026-1', PDF_LINK);
  const row = await lastQueuedEmail(env);
  assert.equal(row.file_link, '', 'a material receipt must not attach to a cash receipt');
});

test('triggerCollectionEmail skips a contributor with no email', async () => {
  const env = makeEnv();
  env.DB_CORE.prepare('INSERT INTO users (id_code, name, email) VALUES (?,?,?)').bind('USER0002', 'NoEmail', '').run();
  seedEmailTemplate(env);
  const res = await triggerCollectionEmail(env, { ...cashPayload, Name: 'USER0002' }, 'receipt', 'receipt-2026-2', PDF_LINK);
  assert.equal(res.emailSent, false);
  assert.ok(res.warnings.includes('no-email'));
  const row = await lastQueuedEmail(env);
  assert.equal(row, null, 'nothing queued');
});

test('triggerCollectionEmail skips a resell entry (no contributor)', async () => {
  const env = makeEnv();
  seedEmailTemplate(env);
  const res = await triggerCollectionEmail(env, { ...cashPayload, 'Is Resell': 'TRUE' }, null, null, '');
  assert.equal(res.emailSent, false);
  assert.ok(res.warnings.includes('resell-no-email'));
});

test('triggerCollectionEmail warns when there is no active template', async () => {
  const env = makeEnv(); // no template seeded
  const res = await triggerCollectionEmail(env, cashPayload, 'receipt', 'receipt-2026-1', PDF_LINK);
  assert.equal(res.emailSent, false);
  assert.ok(res.warnings.includes('no-email-template'));
});

// ------------------------------------------------------------------ drain

test('processPendingEmails sends a pending email and marks it sent on a 2xx', async () => {
  const env = makeEnv();
  seedEmailTemplate(env, { fileDocType: 'receipt' }); // so the PDF link is attached + rendered
  await triggerCollectionEmail(env, cashPayload, 'receipt', 'receipt-2026-1', PDF_LINK);

  let sawAuth = false, sawBody = null;
  stubFetch(async (url, opts) => {
    assert.equal(url, 'https://api.resend.com/emails');
    sawAuth = (opts.headers.Authorization === 'Bearer test-key');
    sawBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ id: 're_123' }) };
  });
  try {
    const out = await processPendingEmails(env);
    assert.equal(out.processed, 1);
  } finally { restoreFetch(); }

  assert.ok(sawAuth, 'used the Bearer API key');
  assert.equal(sawBody.from, 'noreply@shaharpura.com');
  assert.deepEqual(sawBody.to, ['kuldeep@example.com']);
  assert.equal(sawBody.reply_to, 'shaharpura.815312@gmail.com');
  assert.ok(sawBody.html.includes('Download document'), 'PDF link rendered into the HTML body');

  const row = await lastQueuedEmail(env);
  assert.equal(row.status, 'sent');
  assert.ok(row.sent_at);
});

test('processPendingEmails re-queues (pending) on a transient failure, not failed', async () => {
  const env = makeEnv();
  seedEmailTemplate(env);
  await triggerCollectionEmail(env, cashPayload, 'receipt', 'receipt-2026-1', PDF_LINK);

  stubFetch(async () => ({ ok: false, status: 500, json: async () => ({ message: 'server error' }) }));
  try {
    await processPendingEmails(env);
  } finally { restoreFetch(); }

  const row = await lastQueuedEmail(env);
  assert.equal(row.status, 'pending', 'a single 500 leaves it retryable');
  assert.equal(row.attempts, 1, 'the claim incremented attempts once');
});

test('processPendingEmails marks an email failed once attempts are exhausted', async () => {
  const env = makeEnv();
  seedEmailTemplate(env);
  await triggerCollectionEmail(env, cashPayload, 'receipt', 'receipt-2026-1', PDF_LINK);
  // Pre-set attempts to the cap-1 so the next claim reaches MAX_ATTEMPTS (5).
  env.DB_WHATSAPP_INDEX.prepare('UPDATE email_messages SET attempts = 4').run();

  stubFetch(async () => ({ ok: false, status: 422, json: async () => ({ message: 'invalid recipient' }) }));
  try {
    await processPendingEmails(env);
  } finally { restoreFetch(); }

  const row = await lastQueuedEmail(env);
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 5);
  assert.ok(row.sent_at, 'terminal timestamp set');
});

test('processPendingEmails is a no-op (no fetch) when RESEND_API_KEY is unset', async () => {
  const env = makeEnv({ RESEND_API_KEY: undefined });
  seedEmailTemplate(env);
  await triggerCollectionEmail(env, cashPayload, 'receipt', 'receipt-2026-1', PDF_LINK);

  let called = false;
  stubFetch(async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; });
  try {
    const out = await processPendingEmails(env);
    assert.equal(out.processed, 0);
  } finally { restoreFetch(); }
  assert.equal(called, false, 'never calls Resend without a key');

  const row = await lastQueuedEmail(env);
  assert.equal(row.status, 'pending', 'row stays pending until a key is configured');
});
