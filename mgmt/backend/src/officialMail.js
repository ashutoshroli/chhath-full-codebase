// ============================================================================
// OFFICIAL MAILBOX — chhath@shaharpura.com (two-way: send/reply + inbound).
//
// SEND/REPLY: the Worker POSTs to the Resend send API with from=OFFICIAL_FROM.
// INBOUND: Resend's receiving webhook (event 'email.received') POSTs metadata
//   ONLY (no body). We fetch the body via the Received Emails API
//   (GET https://api.resend.com/emails/received/{email_id}) and store the row.
//
// All rows land in official_emails (DB_WHATSAPP_INDEX). Reads/sends are
// Superadmin-only; the inbound webhook is a PUBLIC route guarded by a shared
// secret (RESEND_WEBHOOK_SECRET) checked in index.js.
// ============================================================================

import { requireSuperadmin, ValidationError } from './auth.js';
import { logErrorAt, logWarn } from './logger.js';
import { generateMessageId } from './whatsapp.js';

const TABLE = 'official_emails';
const RESEND_SEND = 'https://api.resend.com/emails';
const RESEND_RECEIVED = (id) => `https://api.resend.com/emails/received/${encodeURIComponent(id)}`;

function db(env) {
  if (!env || !env.DB_WHATSAPP_INDEX) throw ValidationError('Mailbox storage not configured.');
  return env.DB_WHATSAPP_INDEX;
}
function officialFrom(env) {
  return (env && env.OFFICIAL_FROM) || 'chhath@shaharpura.com';
}
function cleanEmail(v) {
  const s = (v == null ? '' : v.toString()).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}
function escapeHtml(s) {
  return (s == null ? '' : s.toString())
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// A composed plain-text body -> minimal safe HTML (newlines -> <br>).
function textToHtml(text) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222">${escapeHtml(text).replace(/\r?\n/g, '<br>')}</div>`;
}

// One Resend send. Returns { ok, id?, error? }. Never throws.
async function resendSend(env, { to, cc, subject, html, replyToBody }) {
  const apiKey = env && env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const payload = { from: officialFrom(env), to: [to], subject: subject || '(no subject)', html };
  if (cc) payload.cc = [cc];
  // Replies go back to the official address so the thread stays with the mailbox.
  payload.reply_to = officialFrom(env);
  try {
    const resp = await fetch(RESEND_SEND, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = null; try { data = await resp.json(); } catch (e) { /* non-JSON */ }
    if (resp.ok) return { ok: true, id: data && data.id };
    return { ok: false, error: (data && (data.message || data.name)) || `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

async function insertRow(env, row) {
  const messageId = row.message_id || generateMessageId();
  await db(env).prepare(
    `INSERT INTO ${TABLE} (message_id, direction, resend_id, from_addr, to_addr, cc_addr, subject,
       body_html, body_text, thread_id, in_reply_to, status, remarks, is_read, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    messageId, row.direction, row.resend_id || '', row.from_addr || '', row.to_addr || '', row.cc_addr || '',
    row.subject || '', row.body_html || '', row.body_text || '', row.thread_id || messageId,
    row.in_reply_to || '', row.status || '', row.remarks || '', row.is_read ? 1 : 0, new Date().toISOString()
  ).run();
  return messageId;
}

// ------------------------------------------------------------------ SEND / REPLY

export async function sendOfficialEmail(env, { to, cc, subject, body }, user) {
  requireSuperadmin(user);
  const toAddr = cleanEmail(to);
  if (!toAddr) throw ValidationError('A valid recipient email is required.');
  if (!subject || !subject.toString().trim()) throw ValidationError('Subject is required.');
  if (!body || !body.toString().trim()) throw ValidationError('Message body is required.');
  const ccAddr = cc ? cleanEmail(cc) : '';
  const html = textToHtml(body);

  const res = await resendSend(env, { to: toAddr, cc: ccAddr, subject, html });
  const messageId = await insertRow(env, {
    direction: 'outbound', resend_id: res.id || '', from_addr: officialFrom(env), to_addr: toAddr,
    cc_addr: ccAddr, subject, body_html: html, body_text: body.toString(),
    status: res.ok ? 'sent' : 'failed', remarks: res.ok ? '' : (res.error || '').slice(0, 300),
  });
  if (!res.ok) {
    await logWarn(env, 'official-mail', 'sendOfficialEmail', `Send failed to ${toAddr}: ${res.error}`, { messageId });
    throw ValidationError('The email could not be sent: ' + (res.error || 'unknown error'));
  }
  return { success: true, messageId };
}

export async function replyOfficialEmail(env, { messageId, body }, user) {
  requireSuperadmin(user);
  if (!messageId) throw ValidationError('messageId is required.');
  if (!body || !body.toString().trim()) throw ValidationError('Reply body is required.');
  const orig = await db(env).prepare(`SELECT * FROM ${TABLE} WHERE message_id = ?`).bind(messageId.toString().trim()).first();
  if (!orig) throw ValidationError('Original message not found.');

  // Reply goes to whoever we were talking to: for an inbound message, the sender;
  // for an outbound one, the recipient.
  const toAddr = cleanEmail(orig.direction === 'inbound' ? orig.from_addr : orig.to_addr);
  if (!toAddr) throw ValidationError('The original message has no valid address to reply to.');
  const subject = /^re:/i.test(orig.subject || '') ? orig.subject : `Re: ${orig.subject || ''}`.trim();
  const html = textToHtml(body);

  const res = await resendSend(env, { to: toAddr, subject, html });
  const newId = await insertRow(env, {
    direction: 'outbound', resend_id: res.id || '', from_addr: officialFrom(env), to_addr: toAddr,
    subject, body_html: html, body_text: body.toString(),
    thread_id: orig.thread_id || orig.message_id, in_reply_to: orig.message_id,
    status: res.ok ? 'sent' : 'failed', remarks: res.ok ? '' : (res.error || '').slice(0, 300),
  });
  if (!res.ok) {
    await logWarn(env, 'official-mail', 'replyOfficialEmail', `Reply failed to ${toAddr}: ${res.error}`, { messageId: newId });
    throw ValidationError('The reply could not be sent: ' + (res.error || 'unknown error'));
  }
  return { success: true, messageId: newId };
}

// ------------------------------------------------------------------ READS

export async function listOfficialEmails(env, box, opts = {}, user) {
  requireSuperadmin(user);
  const dir = box === 'sent' ? 'outbound' : 'inbound';
  let limit = parseInt(opts.limit); if (!Number.isFinite(limit) || limit <= 0) limit = 50; if (limit > 200) limit = 200;
  // Only the columns the list needs — bodies are fetched on open (getOfficialEmail).
  const { results } = await db(env).prepare(
    `SELECT message_id, direction, from_addr, to_addr, subject, status, is_read, thread_id, created_at
       FROM ${TABLE} WHERE direction = ? ORDER BY id DESC LIMIT ?`
  ).bind(dir, limit).all();
  let unread = 0;
  if (dir === 'inbound') {
    const r = await db(env).prepare(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE direction='inbound' AND COALESCE(is_read,0)=0`).first().catch(() => null);
    unread = r ? (parseInt(r.n) || 0) : 0;
  }
  return { success: true, box: dir === 'sent' ? 'sent' : 'inbox', emails: results || [], unread };
}

// Open one message + its whole thread (so the UI can show the conversation).
export async function getOfficialEmail(env, messageId, user) {
  requireSuperadmin(user);
  if (!messageId) throw ValidationError('messageId is required.');
  const row = await db(env).prepare(`SELECT * FROM ${TABLE} WHERE message_id = ?`).bind(messageId.toString().trim()).first();
  if (!row) throw ValidationError('Message not found.');
  const threadId = row.thread_id || row.message_id;
  const { results: thread } = await db(env).prepare(
    `SELECT message_id, direction, from_addr, to_addr, cc_addr, subject, body_html, body_text, status, created_at, in_reply_to
       FROM ${TABLE} WHERE thread_id = ? ORDER BY id ASC`
  ).bind(threadId).all();
  // Opening an inbound message marks it read.
  if (row.direction === 'inbound' && !row.is_read) {
    await db(env).prepare(`UPDATE ${TABLE} SET is_read = 1 WHERE message_id = ?`).bind(row.message_id).run().catch(() => {});
  }
  return { success: true, message: row, thread: thread || [] };
}

export async function markOfficialEmailRead(env, messageId, user) {
  requireSuperadmin(user);
  if (!messageId) throw ValidationError('messageId is required.');
  await db(env).prepare(`UPDATE ${TABLE} SET is_read = 1 WHERE message_id = ?`).bind(messageId.toString().trim()).run();
  return { success: true };
}

// ------------------------------------------------------------------ INBOUND WEBHOOK
//
// Called from the PUBLIC route in index.js AFTER the shared-secret check. `payload`
// is the parsed Resend webhook JSON. We only act on 'email.received', and because
// the webhook carries metadata only, we fetch the body via the Received Emails API.
// Never throws (a webhook handler must return 2xx quickly); logs on failure.
export async function handleInboundEmailWebhook(env, payload) {
  try {
    const type = payload && (payload.type || payload.event);
    if (type && type !== 'email.received') return { ok: true, ignored: type };
    const data = (payload && payload.data) || {};
    const receivedId = data.email_id || data.id || '';

    // Metadata straight from the webhook (fallbacks in case fields move).
    let from = (Array.isArray(data.from) ? data.from[0] : data.from) || '';
    let to = (Array.isArray(data.to) ? data.to[0] : data.to) || '';
    let subject = data.subject || '';
    let bodyHtml = '';
    let bodyText = '';

    // Fetch the full body via the Received Emails API (webhook has metadata only).
    if (receivedId && env.RESEND_API_KEY) {
      try {
        const resp = await fetch(RESEND_RECEIVED(receivedId), {
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
        });
        if (resp.ok) {
          const full = await resp.json();
          from = (Array.isArray(full.from) ? full.from[0] : full.from) || from;
          to = (Array.isArray(full.to) ? full.to[0] : full.to) || to;
          subject = full.subject || subject;
          bodyHtml = full.html || '';
          bodyText = full.text || '';
        } else {
          await logWarn(env, 'official-mail', 'inbound:fetchBody',
            `Received-emails API returned HTTP ${resp.status} for ${receivedId}`, { receivedId });
        }
      } catch (e) {
        await logWarn(env, 'official-mail', 'inbound:fetchBody', `Body fetch failed: ${e && e.message}`, { receivedId });
      }
    }

    // Thread the inbound message onto an existing conversation when the sender
    // matches an address we've mailed (best-effort); else it starts its own thread.
    let threadId = '';
    const fromClean = cleanEmail(from);
    if (fromClean) {
      const prior = await db(env).prepare(
        `SELECT thread_id FROM ${TABLE} WHERE (to_addr = ? OR from_addr = ?) AND thread_id != '' ORDER BY id DESC LIMIT 1`
      ).bind(fromClean, fromClean).first().catch(() => null);
      if (prior && prior.thread_id) threadId = prior.thread_id;
    }

    const messageId = await insertRow(env, {
      direction: 'inbound', resend_id: receivedId, from_addr: from, to_addr: to,
      subject, body_html: bodyHtml, body_text: bodyText, thread_id: threadId, // '' -> insertRow defaults to its own id
      status: 'received', is_read: 0,
    });
    return { ok: true, messageId };
  } catch (err) {
    await logErrorAt(env, 'official-mail', 'handleInboundEmailWebhook', err, {});
    return { ok: false, error: err && err.message };
  }
}
