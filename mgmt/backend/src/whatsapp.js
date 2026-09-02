import { getSheetDataAsJSON } from './crud.js';
import { requireSuperadmin, ValidationError } from './auth.js';
import { withCC } from './settings.js';
import { logErrorAt, logWarn } from './logger.js';
import { waNumber, looksLikeAttemptedNumber } from './phone.js';

const TEMPLATE_TABLE = { PERSON_MESSAGE_TEMPLATES: 'person_message_templates', GROUP_MESSAGE_TEMPLATES: 'group_message_templates' };
const MESSAGE_TABLE = { person: { table: 'person_messages' }, group: { table: 'group_messages' } };

// 'sending' is the new claimed state set by getPendingMessages() so a second /
// overlapping poll cycle cannot re-serve the same row (which is how duplicate
// WhatsApp messages happened).
const TERMINAL_STATES = ['sent', 'failed'];
// A claim older than this is assumed dead (sender crashed / host went down) and
// the row becomes eligible again. Without this a crash left rows stuck forever.
const CLAIM_STALE_MS = 10 * 60 * 1000;
// Hard cap so a permanently-undeliverable row can't be retried forever.
const MAX_ATTEMPTS = 5;
// getPendingMessages() had NO limit, so the poller's payload and the full-table
// scan grew without bound.
const PENDING_PAGE_SIZE = 100;

// crypto.randomUUID() instead of Date.now()+Math.random(): the old generator was
// duplicated inline in loans.js twice and could collide, which (with no UNIQUE
// constraint) silently corrupted a different recipient's status.
export function generateMessageId() {
  return 'MSG' + crypto.randomUUID().replace(/-/g, '');
}

function tableFor(type) {
  const t = MESSAGE_TABLE[type];
  if (!t) throw new Error('type must be person or group');
  return t.table;
}

// ---- Templates CRUD (Superadmin) ----
export async function addTemplate(env, sheetName, text, messageType, contributionType, fileLink, docSubType, fileDocType, user) {
  requireSuperadmin(user);
  if (!text || !text.toString().trim()) throw new Error('Template text required');
  const table = TEMPLATE_TABLE[sheetName];
  if (!table) throw new Error('Invalid template table');
  const id = 'TPL' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // doc_sub_type / file_doc_type now exist on BOTH template tables (they were
  // missing on group_message_templates, so every Add/Update Group Template
  // returned D1_ERROR "no column named doc_sub_type"). See
  // db/migration/2026-09-01-audit-fixes.sql.
  await env.DB_WHATSAPP_INDEX.prepare(
    `INSERT INTO ${table} (template_id, text, active, created_at, message_type, contribution_type, file_link, doc_sub_type, file_doc_type) VALUES (?, ?, '1', ?, ?, ?, ?, ?, ?)`
  ).bind(id, text.toString().trim(), new Date().toISOString(), messageType || 'normal', contributionType || '1', fileLink || '', docSubType || '', fileDocType || '').run();
  return { success: true, template_id: id };
}

export async function updateTemplate(env, sheetName, rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw new Error('rowIndex required');
  const table = TEMPLATE_TABLE[sheetName];
  if (!table) throw new Error('Invalid template table');
  const sets = []; const vals = [];
  if (text !== undefined) { sets.push('text = ?'); vals.push(text); }
  // `active` is a TEXT column — bind the string form so the DB never ends up
  // holding a mix of 'True' (sheet migration) and 1 (portal writes).
  if (active !== undefined) { sets.push('active = ?'); vals.push(active ? '1' : '0'); }
  if (messageType !== undefined) { sets.push('message_type = ?'); vals.push(messageType); }
  if (contributionType !== undefined) { sets.push('contribution_type = ?'); vals.push(contributionType); }
  if (fileLink !== undefined) { sets.push('file_link = ?'); vals.push(fileLink); }
  if (docSubType !== undefined) { sets.push('doc_sub_type = ?'); vals.push(docSubType); }
  if (fileDocType !== undefined) { sets.push('file_doc_type = ?'); vals.push(fileDocType); }
  if (!sets.length) return { success: true };
  vals.push(rowIndex);
  await env.DB_WHATSAPP_INDEX.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return { success: true };
}

export async function deleteTemplate(env, sheetName, rowIndex, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw new Error('rowIndex required');
  const table = TEMPLATE_TABLE[sheetName];
  if (!table) throw new Error('Invalid template table');
  await env.DB_WHATSAPP_INDEX.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(rowIndex).run();
  return { success: true };
}

// ---- Group Info CRUD (Superadmin) ----
export async function addWhatsappGroup(env, groupName, groupid, user) {
  requireSuperadmin(user);
  if (!groupName || !groupid) throw new Error('Group name and Group ID required');
  const id = 'GRP' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await env.DB_WHATSAPP_INDEX.prepare(
    "INSERT INTO whatsapp_groups (group_id, group_name, groupid, active, created_at) VALUES (?, ?, ?, '1', ?)"
  ).bind(id, groupName.toString().trim(), groupid.toString().trim(), new Date().toISOString()).run();
  return { success: true, group_id: id };
}

export async function updateWhatsappGroup(env, rowIndex, groupName, groupid, active, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw new Error('rowIndex required');
  const sets = []; const vals = [];
  if (groupName !== undefined) { sets.push('group_name = ?'); vals.push(groupName); }
  if (groupid !== undefined) { sets.push('groupid = ?'); vals.push(groupid); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active ? '1' : '0'); }
  if (!sets.length) return { success: true };
  vals.push(rowIndex);
  await env.DB_WHATSAPP_INDEX.prepare(`UPDATE whatsapp_groups SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return { success: true };
}

export async function deleteWhatsappGroup(env, rowIndex, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw new Error('rowIndex required');
  await env.DB_WHATSAPP_INDEX.prepare('DELETE FROM whatsapp_groups WHERE id = ?').bind(rowIndex).run();
  return { success: true };
}

// ---- Message log (view-only, Superadmin) ----
export async function getMessageLog(env) {
  const person = (await getSheetDataAsJSON(env, 'PERSON_MESSAGES')).map(m => ({ ...m, type: 'person', recipient: m.mobileno }));
  const group = (await getSheetDataAsJSON(env, 'GROUP_MESSAGES')).map(m => ({ ...m, type: 'group', recipient: m.groupid }));
  return person.concat(group).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Rows that are queued but have gone nowhere for a long time — surfaced in the
// WhatsApp view so a dead external sender / rotated API key is visible instead of
// silently piling up 'pending' rows nobody ever looks at.
export async function getStuckMessages(env, olderThanMinutes) {
  const cutoff = new Date(Date.now() - (parseInt(olderThanMinutes) || 30) * 60000).toISOString();
  const q = (table) => env.DB_WHATSAPP_INDEX.prepare(
    `SELECT message_id, status, attempts, created_at, claimed_at FROM ${table}
      WHERE status NOT IN ('sent', 'failed') AND created_at < ? ORDER BY created_at ASC LIMIT 200`
  ).bind(cutoff).all();
  const [p, g] = await Promise.all([q('person_messages'), q('group_messages')]);
  return {
    cutoff,
    person: (p.results || []).map(r => ({ ...r, type: 'person' })),
    group: (g.results || []).map(r => ({ ...r, type: 'group' })),
    total: (p.results || []).length + (g.results || []).length,
  };
}

// ---- Queue polling (external automation script, apiKey-based) ----
//
// This is a CLAIMING read, not a plain read. Previously it returned every
// pending row and marked nothing, so any overlapping poll cycle (or a send that
// outlasted the poll interval) re-served the same rows and the recipient got the
// message twice. Now each served row is moved to 'sending' with claimed_at set;
// a claim older than CLAIM_STALE_MS is reclaimed automatically.
// D1 gives back columns with REAL affinity as JS NUMBERS, not strings. `mobileno`
// / `groupid` / `from` were historically REAL (see whatsapp_index.sql: "was
// REAL"), so a recipient like 917282032146 arrives as the number 917282032146 —
// and the external sender then crashes with "to.includes is not a function"
// because it (rightly) expects a string. A number can also silently lose a
// leading digit or hit float precision. Coerce every field the sender reads to a
// clean string here, at the boundary, so no consumer ever sees a number.
//
// The `.0` suffix (e.g. "917282032146.0") that a REAL round-trip can add is also
// stripped, mirroring phone.js's waNumber().
function toCleanStr(v) {
  if (v === undefined || v === null) return '';
  let s = v.toString();
  // Exponential form a very large REAL can take (e.g. 9.17282032146e11).
  if (/e\+?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = BigInt(Math.round(n)).toString();
  }
  return s.replace(/\.0+$/, '').trim();
}

// Fields the external sender reads. Numeric-looking recipient/sender ids must be
// strings; text fields are coerced too so a purely-numeric message body (e.g.
// "12345") can't arrive as a number either.
function normalizeQueueRow(row) {
  return {
    ...row,
    mobileno: toCleanStr(row.mobileno),
    groupid: toCleanStr(row.groupid),
    from: toCleanStr(row.from),
    message_id: toCleanStr(row.message_id),
    message: row.message === undefined || row.message === null ? '' : row.message.toString(),
    file_link: toCleanStr(row.file_link),
  };
}

export async function getPendingMessages(env, limit) {
  const pageSize = Math.min(Math.max(parseInt(limit) || PENDING_PAGE_SIZE, 1), 500);
  const staleCutoff = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const nowIso = new Date().toISOString();
  const out = [];

  for (const type of ['person', 'group']) {
    const table = tableFor(type);

    // Requeue dead claims first so a crashed sender doesn't strand rows.
    await env.DB_WHATSAPP_INDEX.prepare(
      `UPDATE ${table} SET status = 'pending'
        WHERE status = 'sending' AND (claimed_at IS NULL OR claimed_at < ?)`
    ).bind(staleCutoff).run();

    const { results } = await env.DB_WHATSAPP_INDEX.prepare(
      `SELECT * FROM ${table}
        WHERE status IN ('pending', 'resending')
          AND COALESCE(attempts, 0) < ?
        ORDER BY id ASC LIMIT ?`
    ).bind(MAX_ATTEMPTS, pageSize).all();

    const rows = results || [];
    if (!rows.length) continue;

    // Claim all eligible rows in ONE atomic set-based UPDATE instead of a
    // per-row UPDATE loop. The old loop issued one D1 write PER ROW (up to 100
    // round-trips per poll), which — with a 5s poller and a burst of freshly
    // queued messages — overwhelmed D1 and produced
    // "D1 DB storage operation exceeded timeout". A single `id IN (...)` write
    // is one round-trip. A short-lived `claimToken` in claimed_at makes the
    // claim verifiable so a concurrent poll can't double-serve the same rows.
    const ids = rows.map(r => r.id);
    const claimToken = `${nowIso}#${crypto.randomUUID()}`;
    const placeholders = ids.map(() => '?').join(', ');
    await env.DB_WHATSAPP_INDEX.prepare(
      `UPDATE ${table} SET status = 'sending', claimed_at = ?, attempts = COALESCE(attempts, 0) + 1
        WHERE status IN ('pending', 'resending') AND id IN (${placeholders})`
    ).bind(claimToken, ...ids).run();

    // Re-read exactly the rows THIS poll claimed (claimed_at === our token).
    // Anything a concurrent poll grabbed first won't carry our token, so it's
    // naturally excluded — no double-serve.
    const { results: claimed } = await env.DB_WHATSAPP_INDEX.prepare(
      `SELECT * FROM ${table} WHERE claimed_at = ?`
    ).bind(claimToken).all();

    for (const row of claimed || []) {
      out.push(normalizeQueueRow({ ...row, type, status: 'sending' }));
    }
  }

  // Anything that burned through MAX_ATTEMPTS without a terminal status is a
  // real delivery failure — mark it failed so it shows in the portal instead of
  // sitting invisible forever. Now a single batched write (see below).
  await failExhaustedMessages(env);
  return out;
}

async function failExhaustedMessages(env) {
  for (const type of ['person', 'group']) {
    const table = tableFor(type);
    // Count first so we only touch the DB (and log) when there's actually
    // something to fail — the common case is zero, and then this is a single
    // cheap COUNT with no writes at all.
    const countRow = await env.DB_WHATSAPP_INDEX.prepare(
      `SELECT COUNT(*) AS n FROM ${table}
        WHERE status NOT IN ('sent', 'failed') AND COALESCE(attempts, 0) >= ?`
    ).bind(MAX_ATTEMPTS).first().catch(() => null);
    const n = countRow ? (parseInt(countRow.n) || 0) : 0;
    if (!n) continue;

    // ONE set-based UPDATE for every exhausted row instead of a per-row loop
    // (the old loop did 1 write + 1 error_log write PER row — a major
    // contributor to the D1 write-storm that caused the timeout).
    await env.DB_WHATSAPP_INDEX.prepare(
      `UPDATE ${table} SET status = 'failed', sent_at = ?, remarks = COALESCE(remarks, '') || ' | auto-failed after ${MAX_ATTEMPTS} attempts'
        WHERE status NOT IN ('sent', 'failed') AND COALESCE(attempts, 0) >= ?`
    ).bind(new Date().toISOString(), MAX_ATTEMPTS).run().catch(() => {});

    // One summary log line for the whole batch (not one per message).
    await logWarn(env, 'whatsapp-queue', 'failExhaustedMessages',
      `${n} WhatsApp ${type} message(s) auto-failed after ${MAX_ATTEMPTS} delivery attempts`,
      { type, count: n });
  }
}

export async function resendMessage(env, type, messageId, user) {
  requireSuperadmin(user);
  const table = tableFor(type);
  if (!messageId) throw new Error('message_id required');
  const row = await env.DB_WHATSAPP_INDEX.prepare(
    `SELECT id, status, attempts FROM ${table} WHERE message_id = ?`
  ).bind(messageId.toString().trim()).first();
  if (!row) throw ValidationError('Message not found.');
  if (row.status === 'sent') throw ValidationError('This message has already been sent.');

  // Previously this HARD-REQUIRED status === 'failed'. But nothing in this repo
  // ever sets 'failed' (only the external sender does), so a message stuck at
  // 'pending' was unrecoverable through the UI. A stuck/claimed/pending row is
  // now resendable too.
  if (!['failed', 'pending', 'sending', 'resending'].includes(row.status)) {
    throw ValidationError('A message with this status cannot be resent (current status: ' + row.status + ')');
  }

  // resendMessage had no attempt cap at all (unlike resendConsent's send_count
  // >= 5), so a Superadmin could loop it indefinitely.
  const attempts = parseInt(row.attempts) || 0;
  if (attempts >= MAX_ATTEMPTS) {
    throw ValidationError(`This message has already been tried ${attempts} times. Check the number/template, then queue a new message.`);
  }

  await env.DB_WHATSAPP_INDEX.prepare(
    `UPDATE ${table} SET status = 'resending', claimed_at = NULL WHERE id = ?`
  ).bind(row.id).run();
  return { success: true, attempts };
}

export async function updateMessageStatus(env, type, messageId, status, remarks) {
  if (!type || !messageId || !status) throw new Error('type, message_id and status required');
  if (TERMINAL_STATES.indexOf(status) === -1) throw new Error('status must be sent or failed');
  const table = tableFor(type);

  // State guard: previously this would happily flip an already-'sent' row back
  // to 'failed', after which resendMessage() legitimised a SECOND send to the
  // same recipient. 'sent' is now terminal.
  const result = await env.DB_WHATSAPP_INDEX.prepare(
    `UPDATE ${table} SET status = ?, remarks = ?, sent_at = ?, claimed_at = NULL
      WHERE message_id = ? AND status != 'sent'`
  ).bind(status, remarks || '', new Date().toISOString(), messageId.toString().trim()).run();

  if (!result.meta.changes) {
    const existing = await env.DB_WHATSAPP_INDEX.prepare(
      `SELECT status FROM ${table} WHERE message_id = ?`
    ).bind(messageId.toString().trim()).first();
    if (!existing) {
      await logWarn(env, 'whatsapp-queue', 'updateMessageStatus',
        `updateMessageStatus called for unknown message_id ${messageId}`, { type, messageId, status });
      throw new Error('message_id not found');
    }
    return { success: true, alreadyFinal: true, status: existing.status };
  }

  if (status === 'failed') {
    await logWarn(env, 'whatsapp-queue', 'updateMessageStatus',
      `WhatsApp ${type} message ${messageId} reported FAILED by sender: ${remarks || 'no remarks'}`,
      { type, messageId, remarks });
  }
  return { success: true };
}

// ---- Template rendering ----
//
// renderTemplate() used to leave any key the caller didn't happen to pass as a
// literal `{Placeholder}` in the delivered text — real sent rows in the
// migration data contain `{Village} {FatherName} {Guarantor1}` etc. Unresolved
// tokens are now stripped AND reported back to the caller so it can log which
// template is missing which fields.
const TOKEN_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function renderTemplate(text, data) {
  return renderTemplateChecked(text, data).text;
}

export function renderTemplateChecked(text, data) {
  const src = (text || '').toString();
  const missing = [];
  const out = src.replace(TOKEN_RE, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const v = data[key];
      return v !== undefined && v !== null ? v.toString() : '';
    }
    missing.push(key);
    return ''; // never ship a raw {Token} to a real person
  });
  return { text: out, missing };
}

// Renders + logs any unresolved placeholders in one step. Used by every send
// path so a template/data mismatch becomes a visible error_log row instead of
// garbage in someone's WhatsApp.
async function renderAndCheck(env, page, tpl, data, context) {
  const { text, missing } = renderTemplateChecked(tpl.text, data);
  if (missing.length) {
    await logWarn(env, 'whatsapp-template', page,
      `Template ${tpl.template_id || '(unknown)'} has ${missing.length} unresolved placeholder(s): ${[...new Set(missing)].join(', ')} — they were rendered as blank.`,
      { templateId: tpl.template_id, missing: [...new Set(missing)], ...(context || {}) });
  }
  return text;
}

export function pickRandomActive(rows) {
  const active = rows.filter(r => isTruthyFlag(r.active));
  if (!active.length) return null;
  return active[Math.floor(Math.random() * active.length)];
}

// contribution_type is a REAL column, so it comes back as 3 / 3.0 / '3.0'.
// normalizeType() collapses all of those to '3'.
const normalizeType = (val) => {
  if (val === undefined || val === null || val === '') return '1';
  const num = parseFloat(val);
  return isNaN(num) ? val.toString() : Math.floor(num).toString();
};

export function templatesForContribution(allTemplates, contributionType, docSubType) {
  const targetType = normalizeType(contributionType);
  let pool = allTemplates.filter(t => normalizeType(t.contribution_type) === targetType);

  // Was `if (contributionType === '3')` — comparing the RAW argument while the
  // pool filter above used normalizeType(), so a caller passing 3 / 3.0 / '3.0'
  // silently skipped the Certificate-vs-Receipt refinement.
  if (targetType === '3') {
    const exact = pool.filter(t => (t.doc_sub_type || '') === docSubType);
    pool = exact.length ? exact : pool.filter(t => !t.doc_sub_type);
  }
  return pool;
}

export function isTruthyFlag(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') {
    const normalized = v.toLowerCase().trim();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

// Resolves the "from" (sender) WhatsApp number for a COLLECTION message: the
// number of the STAFF member who saved the entry, so the recipient sees who it
// came from. `createdBy` is the login name recorded on the collection
// (payload['Created By'] / the queue job's created_by), e.g. "USER0026".
//
// A staff member edits their own Mobile/WhatsApp via the profile Settings modal,
// which writes to the `users` table keyed by id_code (== the login name). So the
// number lives on the USERS row whose ID equals `createdBy`; we use the already-
// loaded `users` list to avoid an extra query. As a fallback (a login that has
// no matching USERS row) we read login_users.mobile.
//
// waNumber() normalizes to `91XXXXXXXXXX` (and is a no-op if already prefixed),
// so the returned "from" always carries the 91 country code. Returns '' when no
// usable number is on file (Option A: no default/fallback sender number).
export async function senderNumberForLogin(env, createdBy, users) {
  const name = (createdBy || '').toString().trim();
  if (!name) return '';

  // Primary: the USERS row for this staff login (has both WhatsApp and Mobile).
  const staffRow = (users || []).find(u => (u.ID || '').toString().trim() === name);
  if (staffRow) {
    const n = waNumber(staffRow.WhatsApp) || waNumber(staffRow.Mobile);
    if (n) return n;
  }

  // Fallback: login_users.mobile (the base login record; no whatsapp column).
  if (env && env.DB_CORE) {
    const row = await env.DB_CORE
      .prepare('SELECT mobile FROM login_users WHERE name = ?')
      .bind(name)
      .first()
      .catch(() => null);
    if (row) return waNumber(row.mobile) || '';
  }
  return '';
}

// ---- The two enqueue primitives ----
//
// queueGroupMessageDirect() is new: the group INSERT used to be copy-pasted
// three times (here + loans.js twice), each with its own inline message-id
// generator.
export async function queuePersonMessageDirect(env, mobile, message, from, messageType, fileLink) {
  const to = waNumber(mobile);
  if (!to) {
    // Silently skipping an unsendable number is how "the message just never
    // arrived" bugs stay invisible. Log and tell the caller.
    await logWarn(env, 'whatsapp-queue', 'queuePersonMessageDirect',
      `Refused to queue a person message: "${mobile}" is not a valid 10-digit Indian mobile number.`,
      { rawNumber: String(mobile) });
    return { success: false, skipped: true, reason: 'invalid-number' };
  }
  const messageId = generateMessageId();
  await env.DB_WHATSAPP_INDEX.prepare(
    'INSERT INTO person_messages (message_id, mobileno, message, status, remarks, created_at, "from", message_type, file_link, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)'
  ).bind(messageId, to, message, 'pending', '', new Date().toISOString(), withCC(from) || '', messageType || 'normal', fileLink || '').run();
  return { success: true, messageId, to };
}

export async function queueGroupMessageDirect(env, groupid, message, from, messageType, fileLink) {
  if (!groupid) {
    await logWarn(env, 'whatsapp-queue', 'queueGroupMessageDirect',
      'Refused to queue a group message: group JID (groupid) is empty.', {});
    return { success: false, skipped: true, reason: 'no-groupid' };
  }
  const messageId = generateMessageId();
  await env.DB_WHATSAPP_INDEX.prepare(
    'INSERT INTO group_messages (message_id, groupid, message, status, remarks, created_at, "from", message_type, file_link, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)'
  ).bind(messageId, groupid, message, 'pending', '', new Date().toISOString(), withCC(from) || '', messageType || 'normal', fileLink || '').run();
  return { success: true, messageId };
}

// ---- queueCollectionMessages (called by the frontend right after a COLLECTIONS
// save + that recipient's own PDF has finished generating client-side) ----
export async function queueCollectionMessages(env, payload, rowIndex, fileLink, user) {
  const docType = resolveCollectionDocType(payload);
  const recordId = (docType && rowIndex) ? `${docType}-${payload.Year}-${rowIndex}` : null;
  payload['Created By'] = user ? user.name : payload['Created By'];
  // Returns a real summary now instead of a bare {success:true} — the caller
  // (Home.jsx) surfaces "0 messages queued" instead of assuming it worked.
  const summary = await triggerCollectionMessages(env, payload, docType, recordId, fileLink || '');
  return { success: true, ...summary };
}

function resolveCollectionDocType(payload) {
  if (isTruthyFlag(payload['Is Resell'])) return null;
  const type = normalizeType(payload['Contribution Type'] || '1');
  if (type === '1') return 'receipt';
  if (type === '2') return 'samaan';
  if (type === '3') return payload['Certificate Or Receipt'] === 'Certificate' ? 'certificate' : 'receipt';
  return null;
}

export async function triggerCollectionMessages(env, payload, docType, recordId, generatedFileLink) {
  let groupMessagesSent = 0;
  let personMessageSent = false;
  const warnings = [];

  try {
    const resolveFileLink = (tpl) => {
      if (tpl.file_doc_type) return (docType && tpl.file_doc_type === docType) ? (generatedFileLink || '') : '';
      return tpl.file_link || '';
    };
    const parseAmt = (v) => parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;

    const users = await getSheetDataAsJSON(env, 'USERS');
    const isResell = isTruthyFlag(payload['Is Resell']);
    const contributor = isResell ? null : users.find(u => (u.ID || '').toString().trim() === (payload.Name || '').toString().trim());
    const contributionType = normalizeType(payload['Contribution Type'] || '1');
    const effectiveType = isResell ? '4' : contributionType;
    const docSubType = (payload['Certificate Or Receipt'] || '').toString();

    // A missing contributor is the root cause of the `{Village} {FatherName}`
    // literals that reached real recipients — the placeholder map came out empty
    // and nothing noticed. Log it explicitly.
    if (!isResell && !contributor) {
      warnings.push('contributor-not-found');
      await logWarn(env, 'whatsapp-queue', 'triggerCollectionMessages',
        `Contributor "${payload.Name}" not found in USERS — name/village/father-name placeholders will be blank in this message.`,
        { contributorId: payload.Name, docType, recordId });
    }

    // "from" = the number of the STAFF member who saved this entry (91-prefixed),
    // resolved from their USERS row (id_code == login name) with a login_users
    // fallback. The old inline lookup returned empty on the queue path because
    // 'Created By' wasn't set on the stored payload (now backfilled in
    // collectionQueue.runOneJob). Option A: if no number is on file, from stays ''.
    const from = await senderNumberForLogin(env, payload['Created By'], users);

    const placeholderData = {
      Name: contributor ? contributor.Name : (payload.Name || ''),
      NameHindi: contributor ? (contributor['Name (Hindi)'] || '') : '',
      Amount: parseAmt(payload.Amount),
      Year: payload.Year || '',
      PaymentMethod: payload['Payment Mode'] || '',
      Village: contributor ? (contributor.Village || '') : '',
      VillageHindi: contributor ? (contributor['Village (Hindi)'] || '') : '',
      FatherName: contributor ? (contributor["Father's Name"] || '') : '',
      FatherNameHindi: contributor ? (contributor["Father's Name (Hindi)"] || '') : '',
      Detail: payload.Detail || '',
      ItemName: isResell ? (payload.Detail || '') : '',
    };

    // ---- Group messages ----
    const allGroups = await getSheetDataAsJSON(env, 'WHATSAPP_GROUPS');
    const groups = allGroups.filter(g => isTruthyFlag(g.active));
    const allGroupTemplates = await getSheetDataAsJSON(env, 'GROUP_MESSAGE_TEMPLATES');
    const groupTemplates = templatesForContribution(allGroupTemplates, effectiveType, docSubType);

    if (groups.length === 0) {
      warnings.push('no-active-groups');
      await logWarn(env, 'whatsapp-queue', 'triggerCollectionMessages',
        `No ACTIVE WhatsApp group configured (${allGroups.length} group row(s) exist but none are active) — no group message was queued.`,
        { totalGroups: allGroups.length, docType, recordId });
    } else if (groupTemplates.length === 0) {
      // Logged ONCE per call, not once per group — the old code logged inside
      // the loop, which multiplied the (already broken) writes.
      warnings.push('no-group-template');
      await logWarn(env, 'whatsapp-queue', 'triggerCollectionMessages',
        `No active group message template for contribution type ${effectiveType}${docSubType ? ' / docSubType=' + docSubType : ''} — ${groups.length} group(s) got no message.`,
        { effectiveType, docSubType, activeGroups: groups.length, totalGroupTemplates: allGroupTemplates.length, docType, recordId });
    } else {
      for (const g of groups) {
        const tpl = pickRandomActive(groupTemplates);
        if (!tpl) continue;
        const message = await renderAndCheck(env, 'triggerCollectionMessages:group', tpl, placeholderData, { groupName: g.group_name, docType, recordId });
        const res = await queueGroupMessageDirect(env, g.groupid, message, from, tpl.message_type || 'normal', resolveFileLink(tpl));
        if (res.success) groupMessagesSent++;
      }
    }

    // ---- Person message ----
    const rawNumber = contributor ? (contributor.WhatsApp || contributor.Mobile || '') : '';
    const waTo = isResell ? '' : waNumber(rawNumber);

    if (waTo) {
      const allPersonTemplates = await getSheetDataAsJSON(env, 'PERSON_MESSAGE_TEMPLATES');
      const personTemplates = templatesForContribution(allPersonTemplates, contributionType, docSubType);
      const tpl = pickRandomActive(personTemplates);
      if (tpl) {
        const message = await renderAndCheck(env, 'triggerCollectionMessages:person', tpl, placeholderData, { contributorId: payload.Name, docType, recordId });
        const res = await queuePersonMessageDirect(env, waTo, message, from, tpl.message_type || 'normal', resolveFileLink(tpl));
        personMessageSent = !!res.success;
      } else {
        warnings.push('no-person-template');
        await logWarn(env, 'whatsapp-queue', 'triggerCollectionMessages',
          `No active person message template for contribution type ${contributionType}${docSubType ? ' / docSubType=' + docSubType : ''} — ${payload.Name} got no message.`,
          { contributionType, docSubType, totalPersonTemplates: allPersonTemplates.length, docType, recordId });
      }
    } else if (!isResell && contributor) {
      warnings.push('invalid-number');
      await logWarn(env, 'whatsapp-queue', 'triggerCollectionMessages',
        looksLikeAttemptedNumber(rawNumber)
          ? `Contributor ${payload.Name} has an INVALID WhatsApp/Mobile number ("${rawNumber}") — must be a 10-digit Indian mobile. No message queued.`
          : `Contributor ${payload.Name} has no WhatsApp/Mobile number on file. No message queued.`,
        { contributorId: payload.Name, rawNumber: String(rawNumber), docType, recordId });
    }

    if (groupMessagesSent === 0 && !personMessageSent) {
      await logWarn(env, 'whatsapp-queue', 'triggerCollectionMessages',
        `NO WhatsApp message was queued for collection ${recordId || '(no recordId)'} — nothing will be delivered for this entry.`,
        { docType, recordId, warnings, contributorId: payload.Name });
    }

    return { groupMessagesSent, personMessageSent, warnings };
  } catch (err) {
    // Still swallowed on purpose — WhatsApp queueing must never break a
    // collection save — but it is now a REAL error_log row (the old INSERT here
    // targeted columns `category`/`location`/`timestamp` that don't exist, and
    // was wrapped in .catch(()=>{}), so every failure vanished).
    console.error('WhatsAppQueueError', err);
    await logErrorAt(env, 'whatsapp-queue', 'triggerCollectionMessages', err, {
      docType, recordId, contributorId: payload && payload.Name, year: payload && payload.Year,
    });
    return { groupMessagesSent, personMessageSent, warnings: warnings.concat('exception'), error: err.message };
  }
}

// NOTE: triggerUserMessages() was removed.
// It was exported but never imported anywhere in the codebase, so "welcome
// message to a new user" never actually happened — while still carrying its own
// copy of the '91'-prefix logic and a catch that wrote nothing. Rather than
// leave a maintenance trap that silently sends nothing, it's gone. If welcome
// messages ARE wanted, wire a deliberate call from account.js/crud.js's USERS
// insert using queuePersonMessageDirect() + a dedicated template type — do not
// resurrect it silently, because it would start messaging every new user.
