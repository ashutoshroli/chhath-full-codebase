// ============ Official mailbox (chhath@shaharpura.com) ============
// send/reply store an outbound row; the inbound webhook fetches the body via the
// Received Emails API and stores an inbound row; reads are Superadmin-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1, schemaFor } from './helpers/stubs.mjs';
import {
  sendOfficialEmail, replyOfficialEmail, listOfficialEmails, getOfficialEmail,
  handleInboundEmailWebhook,
} from '../src/officialMail.js';

const SUPER = { name: 'USER0001', role: 'Superadmin' };
const ADMIN = { name: 'USER0010', role: 'Admin' };

function makeEnv(overrides = {}) {
  return {
    DB_WHATSAPP_INDEX: makeD1(schemaFor('whatsapp_index.sql')),
    DB_LOGS: makeD1(schemaFor('logs.sql')),
    RESEND_API_KEY: 'test-key',
    OFFICIAL_FROM: 'chhath@shaharpura.com',
    ...overrides,
  };
}

let realFetch;
const stubFetch = (fn) => { realFetch = globalThis.fetch; globalThis.fetch = fn; };
const restoreFetch = () => { if (realFetch) globalThis.fetch = realFetch; realFetch = undefined; };

const last = (env, dir) =>
  env.DB_WHATSAPP_INDEX.prepare(`SELECT * FROM official_emails WHERE direction = ? ORDER BY id DESC LIMIT 1`).bind(dir).first();

// ---------------------------------------------------------------- send

test('sendOfficialEmail POSTs to Resend (from chhath@) and stores an outbound row', async () => {
  const env = makeEnv();
  let body = null;
  stubFetch(async (url, opts) => {
    assert.equal(url, 'https://api.resend.com/emails');
    body = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ id: 're_1' }) };
  });
  try {
    const res = await sendOfficialEmail(env, { to: 'x@example.com', subject: 'Hi', body: 'Hello there' }, SUPER);
    assert.equal(res.success, true);
  } finally { restoreFetch(); }
  assert.equal(body.from, 'chhath@shaharpura.com');
  assert.deepEqual(body.to, ['x@example.com']);
  const row = await last(env, 'outbound');
  assert.equal(row.status, 'sent');
  assert.equal(row.to_addr, 'x@example.com');
  assert.equal(row.resend_id, 're_1');
});

test('sendOfficialEmail forwards attachments to Resend and stores their filenames (not bytes)', async () => {
  const env = makeEnv();
  let body = null;
  stubFetch(async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ id: 're_att' }) }; });
  try {
    await sendOfficialEmail(env, {
      to: 'x@example.com', subject: 'Doc', body: 'see attached',
      attachments: [{ filename: 'note.txt', content: 'aGVsbG8=' }],
    }, SUPER);
  } finally { restoreFetch(); }
  assert.equal(body.attachments.length, 1);
  assert.equal(body.attachments[0].filename, 'note.txt');
  assert.equal(body.attachments[0].content, 'aGVsbG8=', 'base64 bytes go to Resend');
  const row = await last(env, 'outbound');
  const stored = JSON.parse(row.attachments || '[]');
  assert.deepEqual(stored, [{ filename: 'note.txt' }], 'only the filename is stored in D1, never the bytes');
});

test('sendOfficialEmail rejects a bad recipient / missing subject / empty body', async () => {
  const env = makeEnv();
  await assert.rejects(() => sendOfficialEmail(env, { to: 'nope', subject: 's', body: 'b' }, SUPER), /valid recipient/i);
  await assert.rejects(() => sendOfficialEmail(env, { to: 'a@b.com', subject: '', body: 'b' }, SUPER), /subject/i);
  await assert.rejects(() => sendOfficialEmail(env, { to: 'a@b.com', subject: 's', body: '' }, SUPER), /body/i);
});

test('sendOfficialEmail is Superadmin-only', async () => {
  const env = makeEnv();
  await assert.rejects(() => sendOfficialEmail(env, { to: 'a@b.com', subject: 's', body: 'b' }, ADMIN));
});

// ---------------------------------------------------------------- inbound webhook

test('inbound webhook fetches the body via the Received Emails API and stores an inbound row', async () => {
  const env = makeEnv();
  stubFetch(async (url, opts) => {
    assert.match(url, /\/emails\/receiving\/rcv_123$/);
    assert.equal(opts.headers.Authorization, 'Bearer test-key');
    return { ok: true, status: 200, json: async () => ({ from: 'sender@x.com', to: 'chhath@shaharpura.com', subject: 'Question', html: '<p>Hi</p>', text: 'Hi' }) };
  });
  try {
    const res = await handleInboundEmailWebhook(env, { type: 'email.received', data: { email_id: 'rcv_123', from: 'sender@x.com', to: 'chhath@shaharpura.com', subject: 'Question' } });
    assert.equal(res.ok, true);
  } finally { restoreFetch(); }
  const row = await last(env, 'inbound');
  assert.equal(row.from_addr, 'sender@x.com');
  assert.equal(row.subject, 'Question');
  assert.equal(row.body_html, '<p>Hi</p>');
  assert.equal(row.status, 'received');
  assert.equal(row.is_read, 0);
});

test('inbound webhook stores attachment metadata (filename/type/id), not bytes', async () => {
  const env = makeEnv();
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({
    from: 's@x.com', to: 'chhath@shaharpura.com', subject: 'With file', html: '<p>hi</p>', text: 'hi',
    attachments: [{ filename: 'invoice.pdf', content_type: 'application/pdf', id: 'att_1' }],
  }) }));
  try {
    await handleInboundEmailWebhook(env, { type: 'email.received', data: { email_id: 'rcv_att' } });
  } finally { restoreFetch(); }
  const row = await last(env, 'inbound');
  const att = JSON.parse(row.attachments || '[]');
  assert.equal(att.length, 1);
  assert.equal(att[0].filename, 'invoice.pdf');
  assert.equal(att[0].contentType, 'application/pdf');
  assert.equal(att[0].id, 'att_1');
});

test('inbound webhook falls back to /emails/received when /emails/receiving 405s', async () => {
  const env = makeEnv();
  const urls = [];
  stubFetch(async (url) => {
    urls.push(url);
    if (/\/emails\/receiving\//.test(url)) return { ok: false, status: 405, json: async () => ({}) };
    // the fallback /received path returns the body
    return { ok: true, status: 200, json: async () => ({ from: 'f@x.com', to: 'chhath@shaharpura.com', subject: 'FB', html: '<p>fb</p>', text: 'fb' }) };
  });
  try {
    await handleInboundEmailWebhook(env, { type: 'email.received', data: { email_id: 'rcv_fb' } });
  } finally { restoreFetch(); }
  assert.ok(urls.some(u => /\/emails\/receiving\//.test(u)), 'tries /receiving first');
  assert.ok(urls.some(u => /\/emails\/received\//.test(u)), 'falls back to /received on 405');
  const row = await last(env, 'inbound');
  assert.equal(row.body_html, '<p>fb</p>', 'body still stored via the fallback');
});

test('inbound webhook parses a WRAPPED {data:{...}} Received-Emails response', async () => {
  const env = makeEnv();
  // Resend sometimes wraps the retrieve response in { data: {...} }.
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({
    data: { from: 'w@x.com', to: 'chhath@shaharpura.com', subject: 'Wrapped', html: '<p>body here</p>', text: 'body here' },
  }) }));
  try {
    await handleInboundEmailWebhook(env, { type: 'email.received', data: { email_id: 'rcv_wrap' } });
  } finally { restoreFetch(); }
  const row = await last(env, 'inbound');
  assert.equal(row.from_addr, 'w@x.com', 'from unwrapped from data{}');
  assert.equal(row.subject, 'Wrapped');
  assert.equal(row.body_html, '<p>body here</p>', 'body unwrapped from data{}');
});

test('inbound webhook accepts alternate body field names (body_html/body_text)', async () => {
  const env = makeEnv();
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({
    from: 'a@b.com', to: 'chhath@shaharpura.com', subject: 'Alt', body_html: '<b>hi</b>', body_text: 'hi',
  }) }));
  try {
    await handleInboundEmailWebhook(env, { type: 'email.received', data: { email_id: 'rcv_alt' } });
  } finally { restoreFetch(); }
  const row = await last(env, 'inbound');
  assert.equal(row.body_html, '<b>hi</b>');
  assert.equal(row.body_text, 'hi');
});

test('inbound webhook ignores non-received events', async () => {
  const env = makeEnv();
  let called = false;
  stubFetch(async () => { called = true; return { ok: true, json: async () => ({}) }; });
  try {
    const res = await handleInboundEmailWebhook(env, { type: 'email.delivered', data: {} });
    assert.equal(res.ignored, 'email.delivered');
  } finally { restoreFetch(); }
  assert.equal(called, false);
});

// ---------------------------------------------------------------- read + reply

test('reply threads onto the original and opening marks an inbound message read', async () => {
  const env = makeEnv();
  // Seed an inbound message.
  stubFetch(async () => ({ ok: true, json: async () => ({ from: 's@x.com', to: 'chhath@shaharpura.com', subject: 'Q', html: '<p>hi</p>', text: 'hi' }) }));
  try {
    await handleInboundEmailWebhook(env, { type: 'email.received', data: { email_id: 'rcv_9', from: 's@x.com', to: 'chhath@shaharpura.com', subject: 'Q' } });
  } finally { restoreFetch(); }
  const inbound = await last(env, 'inbound');
  assert.equal(inbound.is_read, 0);

  // Open it -> marked read, thread returned.
  const opened = await getOfficialEmail(env, inbound.message_id, SUPER);
  assert.equal(opened.message.message_id, inbound.message_id);
  const afterOpen = await env.DB_WHATSAPP_INDEX.prepare('SELECT is_read FROM official_emails WHERE message_id = ?').bind(inbound.message_id).first();
  assert.equal(afterOpen.is_read, 1, 'opening an inbound message marks it read');

  // Reply -> outbound row in the SAME thread, addressed back to the sender.
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ id: 're_reply' }) }));
  let reply;
  try {
    reply = await replyOfficialEmail(env, { messageId: inbound.message_id, body: 'Thanks!' }, SUPER);
  } finally { restoreFetch(); }
  assert.equal(reply.success, true);
  const out = await last(env, 'outbound');
  assert.equal(out.to_addr, 's@x.com', 'reply goes back to the inbound sender');
  assert.equal(out.thread_id, inbound.thread_id, 'reply stays in the same thread');
  assert.match(out.subject, /^Re:/);

  // Inbox list shows 0 unread now; getOfficialEmail thread has 2 messages.
  const list = await listOfficialEmails(env, 'inbox', {}, SUPER);
  assert.equal(list.unread, 0);
  const thread = await getOfficialEmail(env, inbound.message_id, SUPER);
  assert.equal(thread.thread.length, 2);
});

test('listOfficialEmails is Superadmin-only', async () => {
  const env = makeEnv();
  await assert.rejects(() => listOfficialEmails(env, 'inbox', {}, ADMIN));
});
