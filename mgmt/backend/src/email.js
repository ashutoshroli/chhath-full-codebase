// ============================================================================
// EMAIL channel (Resend) — mirrors the WhatsApp pipeline (whatsapp.js) but the
// Worker sends directly via the Resend HTTPS API. There is NO external poller
// and NO apiKey-gated endpoint: the Worker itself drains the email_messages
// queue in scheduled() (see processPendingEmails).
//
// FLOW (collection save):
//   collectionQueue.runOneJob -> triggerCollectionEmail(env, payload, docType,
//   recordId, generatedFileLink) picks an active email template by
//   contribution_type/doc_sub_type, renders {placeholders} into subject+body,
//   resolves the attachment link (the freshly generated PDF, same link WhatsApp
//   uses), and INSERTs one 'pending' row into email_messages.
//
//   The cron then calls processPendingEmails(env), which claims pending rows and
//   POSTs each to Resend, moving it to 'sent'/'failed'.
//
// Templates + rendering are reused wholesale from whatsapp.js — an email
// template is just a person template with a `subject` column.
// ============================================================================

import { requireSuperadmin, ValidationError } from './auth.js';
import { logErrorAt, logWarn } from './logger.js';
import { randomId } from './random.js';
import { parseAmt } from './money.js';
import { isTruthyFlag } from './flags.js';
import { userByIdCode } from './lookups.js';
import { getSheetDataAsJSON } from './crud.js';
import {
  renderTemplateChecked, pickRandomActive, templatesForContribution, generateMessageId,
} from './whatsapp.js';

const EMAIL_TEMPLATE_TABLE = 'email_message_templates';
const EMAIL_QUEUE_TABLE = 'email_messages';

// Same retry/stale semantics as whatsapp.js (kept in sync deliberately).
const MAX_ATTEMPTS = 5;
const CLAIM_STALE_MS = 10 * 60 * 1000;
// How many emails one cron tick sends. Resend free tier is 100/day, and the
// free-plan subrequest cap is 50 per invocation, so keep a small batch: each
// send is one fetch (subrequest) + the claim/finalize writes.
const SEND_BATCH = 10;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// contribution_type comes back as 3 / 3.0 / '3.0'; collapse to '3'. (whatsapp.js
// keeps its own private copy; duplicated here to avoid widening that module's API.)
function normalizeType(val) {
  if (val === undefined || val === null || val === '') return '1';
  const num = parseFloat(val);
  return isNaN(num) ? val.toString() : Math.floor(num).toString();
}

// A very small email-address sanity check. We are not trying to fully validate
// RFC 5322 — just refuse obviously-unsendable values so a typo/blank field is a
// visible skip rather than a Resend 4xx.
function cleanEmail(v) {
  const s = (v == null ? '' : v.toString()).trim();
  if (!s) return '';
  // one @, a dot in the domain, no spaces.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

// ---------------------------------------------------------------- Templates CRUD
// (Superadmin) — the email equivalent of whatsapp.js addTemplate/update/delete.

export async function addEmailTemplate(env, subject, text, messageType, contributionType, fileLink, docSubType, fileDocType, user) {
  requireSuperadmin(user);
  if (!text || !text.toString().trim()) throw ValidationError('Template body (text) required');
  if (!subject || !subject.toString().trim()) throw ValidationError('Email subject required');
  const id = randomId('ETPL');
  await env.DB_WHATSAPP_INDEX.prepare(
    `INSERT INTO ${EMAIL_TEMPLATE_TABLE} (template_id, subject, text, active, created_at, message_type, contribution_type, file_link, doc_sub_type, file_doc_type)
     VALUES (?, ?, ?, '1', ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, subject.toString().trim(), text.toString().trim(), new Date().toISOString(),
    messageType || 'normal', contributionType || '1', fileLink || '', docSubType || '', fileDocType || ''
  ).run();
  return { success: true, template_id: id };
}

export async function updateEmailTemplate(env, rowIndex, subject, text, active, messageType, contributionType, fileLink, docSubType, fileDocType, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw ValidationError('rowIndex required');
  const sets = []; const vals = [];
  if (subject !== undefined) { sets.push('subject = ?'); vals.push(subject); }
  if (text !== undefined) { sets.push('text = ?'); vals.push(text); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active ? '1' : '0'); }
  if (messageType !== undefined) { sets.push('message_type = ?'); vals.push(messageType); }
  if (contributionType !== undefined) { sets.push('contribution_type = ?'); vals.push(contributionType); }
  if (fileLink !== undefined) { sets.push('file_link = ?'); vals.push(fileLink); }
  if (docSubType !== undefined) { sets.push('doc_sub_type = ?'); vals.push(docSubType); }
  if (fileDocType !== undefined) { sets.push('file_doc_type = ?'); vals.push(fileDocType); }
  if (!sets.length) return { success: true };
  vals.push(rowIndex);
  await env.DB_WHATSAPP_INDEX.prepare(`UPDATE ${EMAIL_TEMPLATE_TABLE} SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return { success: true };
}

export async function deleteEmailTemplate(env, rowIndex, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw ValidationError('rowIndex required');
  await env.DB_WHATSAPP_INDEX.prepare(`DELETE FROM ${EMAIL_TEMPLATE_TABLE} WHERE id = ?`).bind(rowIndex).run();
  return { success: true };
}

// ---------------------------------------------------------------- Enqueue primitive

export async function queueEmailDirect(env, toEmail, subject, body, from, replyTo, messageType, fileLink) {
  const to = cleanEmail(toEmail);
  if (!to) {
    await logWarn(env, 'email-queue', 'queueEmailDirect',
      `Refused to queue an email: "${toEmail}" is not a valid email address.`,
      { rawEmail: String(toEmail) });
    return { success: false, skipped: true, reason: 'invalid-email' };
  }
  const messageId = generateMessageId();
  await env.DB_WHATSAPP_INDEX.prepare(
    `INSERT INTO ${EMAIL_QUEUE_TABLE} (message_id, to_email, subject, body, status, remarks, created_at, "from", reply_to, message_type, file_link, attempts)
     VALUES (?, ?, ?, ?, 'pending', '', ?, ?, ?, ?, ?, 0)`
  ).bind(
    messageId, to, subject || '', body || '', new Date().toISOString(),
    from || '', replyTo || '', messageType || 'normal', fileLink || ''
  ).run();
  return { success: true, messageId, to };
}

// ---------------------------------------------------------------- Collection trigger
// Mirrors triggerCollectionMessages' PERSON branch, but for email. Called from
// collectionQueue.runOneJob for NEW entries, AFTER the PDF is generated, using
// the SAME generatedFileLink (the PDF is never regenerated).

export async function triggerCollectionEmail(env, payload, docType, recordId, generatedFileLink) {
  let emailSent = false;
  const warnings = [];
  try {
    const isResell = isTruthyFlag(payload['Is Resell']);
    // Resell entries have no contributor/recipient email — same as WhatsApp's
    // person branch, which skips resell.
    if (isResell) return { emailSent: false, warnings: ['resell-no-email'] };

    const contributor = await userByIdCode(env, (payload.Name || '').toString().trim());
    if (!contributor) {
      warnings.push('contributor-not-found');
      await logWarn(env, 'email-queue', 'triggerCollectionEmail',
        `Contributor "${payload.Name}" not found in USERS — no email queued.`,
        { contributorId: payload.Name, docType, recordId });
      return { emailSent: false, warnings };
    }

    const toEmail = cleanEmail(contributor.Email);
    if (!toEmail) {
      warnings.push('no-email');
      await logWarn(env, 'email-queue', 'triggerCollectionEmail',
        `Contributor ${payload.Name} has no valid email on file ("${contributor.Email || ''}") — no email queued.`,
        { contributorId: payload.Name, docType, recordId });
      return { emailSent: false, warnings };
    }

    const contributionType = normalizeType(payload['Contribution Type'] || '1');
    const docSubType = (payload['Certificate Or Receipt'] || '').toString();

    const allTemplates = await getSheetDataAsJSON(env, 'EMAIL_MESSAGE_TEMPLATES');
    const templates = templatesForContribution(allTemplates, contributionType, docSubType);
    const tpl = pickRandomActive(templates);
    if (!tpl) {
      warnings.push('no-email-template');
      await logWarn(env, 'email-queue', 'triggerCollectionEmail',
        `No active email template for contribution type ${contributionType}${docSubType ? ' / docSubType=' + docSubType : ''} — ${payload.Name} got no email.`,
        { contributionType, docSubType, totalTemplates: allTemplates.length, docType, recordId });
      return { emailSent: false, warnings };
    }

    const placeholderData = {
      Name: contributor.Name || (payload.Name || ''),
      NameHindi: contributor['Name (Hindi)'] || '',
      Amount: parseAmt(payload.Amount),
      Year: payload.Year || '',
      PaymentMethod: payload['Payment Mode'] || '',
      Village: contributor.Village || '',
      VillageHindi: contributor['Village (Hindi)'] || '',
      FatherName: contributor["Father's Name"] || '',
      FatherNameHindi: contributor["Father's Name (Hindi)"] || '',
      Detail: payload.Detail || '',
      ItemName: '',
    };

    // Attachment link: same rule as WhatsApp's resolveFileLink — attach the
    // freshly generated PDF when the template's file_doc_type matches the
    // produced document (receipt/receipt_work interchangeable); otherwise use the
    // template's static file_link. The PDF is delivered as a LINK in the email
    // body (Resend can attach by URL, but a link avoids fetching/encoding a large
    // PDF inside the Worker — this mirrors what WhatsApp does).
    const RECEIPT_EQUIVALENT = new Set(['receipt', 'receipt_work']);
    const docTypeMatches = (want) => {
      if (!want || !docType) return false;
      if (want === docType) return true;
      return RECEIPT_EQUIVALENT.has(want) && RECEIPT_EQUIVALENT.has(docType);
    };
    const fileLink = tpl.file_doc_type
      ? (docTypeMatches(tpl.file_doc_type) ? (generatedFileLink || '') : '')
      : (tpl.file_link || '');

    const subjectR = renderTemplateChecked(tpl.subject, placeholderData);
    const bodyR = renderTemplateChecked(tpl.text, placeholderData);
    const missing = [...new Set([...subjectR.missing, ...bodyR.missing])];
    if (missing.length) {
      await logWarn(env, 'email-template', 'triggerCollectionEmail',
        `Email template ${tpl.template_id || '(unknown)'} has unresolved placeholder(s): ${missing.join(', ')} — rendered blank.`,
        { templateId: tpl.template_id, missing, docType, recordId });
    }

    const from = (env && env.RESEND_FROM) || '';
    const replyTo = (env && env.RESEND_REPLY_TO) || '';

    const res = await queueEmailDirect(env, toEmail, subjectR.text, bodyR.text, from, replyTo, tpl.message_type || 'normal', fileLink);
    emailSent = !!res.success;
    if (!emailSent) warnings.push(res.reason || 'queue-failed');

    return { emailSent, warnings };
  } catch (err) {
    // Email must NEVER break the collection job (nor affect WhatsApp) — swallow
    // to a real error_log row, exactly like triggerCollectionMessages does.
    console.error('EmailQueueError', err);
    await logErrorAt(env, 'email-queue', 'triggerCollectionEmail', err, {
      docType, recordId, contributorId: payload && payload.Name, year: payload && payload.Year,
    });
    return { emailSent, warnings: warnings.concat('exception'), error: err.message };
  }
}

// ---------------------------------------------------------------- Send via Resend

// Renders a plain-text body into minimal, safe HTML: escapes HTML special chars,
// turns newlines into <br>, and appends the attachment link as a clickable line.
function escapeHtml(s) {
  return (s == null ? '' : s.toString())
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function bodyToHtml(body, fileLink) {
  const safe = escapeHtml(body).replace(/\r?\n/g, '<br>');
  let html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222">${safe}`;
  const link = (fileLink || '').toString().trim();
  if (link) {
    html += `<br><br><a href="${escapeHtml(link)}" style="color:#0a58ca">📎 Download document</a>`;
  }
  html += '</div>';
  return html;
}

// One Resend send. Returns { ok, status, id?, error? }. Never throws.
export async function sendViaResend(env, { to, subject, body, from, replyTo, fileLink }) {
  const apiKey = env && env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 0, error: 'RESEND_API_KEY not configured' };
  }
  const fromAddr = from || (env && env.RESEND_FROM) || '';
  if (!fromAddr) {
    return { ok: false, status: 0, error: 'from address (RESEND_FROM) not configured' };
  }
  const payload = {
    from: fromAddr,
    to: [to],
    subject: subject || '(no subject)',
    html: bodyToHtml(body, fileLink),
  };
  const rt = replyTo || (env && env.RESEND_REPLY_TO) || '';
  if (rt) payload.reply_to = rt;

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* non-JSON body */ }
    if (resp.ok) return { ok: true, status: resp.status, id: data && data.id };
    const msg = (data && (data.message || data.error || data.name)) || `HTTP ${resp.status}`;
    return { ok: false, status: resp.status, error: msg };
  } catch (err) {
    return { ok: false, status: 0, error: (err && err.message) || String(err) };
  }
}

// ---------------------------------------------------------------- Queue drain (cron)
// The Worker's own sender. Claims a small batch of pending/resending rows, sends
// each via Resend, and moves it to sent/failed. Mirrors getPendingMessages'
// claim-and-verify pattern (status='sending' + claim token) so overlapping ticks
// never double-send. Never throws to the caller (the cron must return cleanly).

export async function processPendingEmails(env) {
  if (!env || !env.DB_WHATSAPP_INDEX) return { processed: 0, note: 'DB_WHATSAPP_INDEX missing' };
  if (!env.RESEND_API_KEY) {
    // No key configured yet — do nothing (rows stay 'pending' until it is set).
    return { processed: 0, note: 'RESEND_API_KEY not configured' };
  }
  const db = env.DB_WHATSAPP_INDEX;
  const staleCutoff = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const nowIso = new Date().toISOString();

  // Requeue dead claims (a tick that died mid-send).
  await db.prepare(
    `UPDATE ${EMAIL_QUEUE_TABLE} SET status = 'pending'
      WHERE status = 'sending' AND (claimed_at IS NULL OR claimed_at < ?)`
  ).bind(staleCutoff).run().catch(() => {});

  const { results } = await db.prepare(
    `SELECT id FROM ${EMAIL_QUEUE_TABLE}
      WHERE status IN ('pending', 'resending') AND COALESCE(attempts, 0) < ?
      ORDER BY id ASC LIMIT ?`
  ).bind(MAX_ATTEMPTS, SEND_BATCH).all().catch(() => ({ results: [] }));

  const ids = (results || []).map(r => r.id);
  let processed = 0;

  for (const id of ids) {
    // Optimistic claim — only if still eligible. Guards overlapping ticks.
    const claim = await db.prepare(
      `UPDATE ${EMAIL_QUEUE_TABLE} SET status = 'sending', claimed_at = ?, attempts = COALESCE(attempts, 0) + 1
        WHERE id = ? AND status IN ('pending', 'resending')`
    ).bind(nowIso, id).run().catch(() => null);
    if (!claim || !claim.meta || claim.meta.changes === 0) continue; // someone else took it

    const row = await db.prepare(
      `SELECT message_id, to_email, subject, body, "from", reply_to, file_link, attempts FROM ${EMAIL_QUEUE_TABLE} WHERE id = ?`
    ).bind(id).first().catch(() => null);
    if (!row) continue;

    const result = await sendViaResend(env, {
      to: row.to_email, subject: row.subject, body: row.body,
      from: row.from, replyTo: row.reply_to, fileLink: row.file_link,
    });

    if (result.ok) {
      await db.prepare(
        `UPDATE ${EMAIL_QUEUE_TABLE} SET status = 'sent', sent_at = ?, remarks = ?, claimed_at = NULL WHERE id = ?`
      ).bind(new Date().toISOString(), ('resend id: ' + (result.id || '')).slice(0, 200), id).run().catch(() => {});
      processed++;
    } else {
      const attempts = (parseInt(row.attempts) || 0); // already incremented by the claim
      const exhausted = attempts >= MAX_ATTEMPTS;
      await db.prepare(
        `UPDATE ${EMAIL_QUEUE_TABLE} SET status = ?, remarks = ?, sent_at = ?, claimed_at = NULL WHERE id = ?`
      ).bind(
        exhausted ? 'failed' : 'pending',
        (result.error || 'send failed').toString().slice(0, 300),
        exhausted ? new Date().toISOString() : null,
        id
      ).run().catch(() => {});
      await logWarn(env, 'email-queue', 'processPendingEmails',
        `Email ${row.message_id} to ${row.to_email} ${exhausted ? 'FAILED (exhausted)' : 'send failed, will retry'}: ${result.error}`,
        { messageId: row.message_id, attempts, exhausted, status: result.status });
    }
  }

  return { processed, claimed: ids.length };
}

// ============================================================================
// LOAN email (Resend) — the email mirror of the WhatsApp loan notifications in
// loans.js. Personal loan notifications (consent link, OTP, accepted, verified,
// disbursed, resend, replace-guarantor) are ALSO emailed to the loaner/guarantor
// (users.email). Group notifications are NOT emailed (email has no group). All of
// this reuses the same email_messages queue + processPendingEmails + Resend send.
// ============================================================================

const LOAN_EMAIL_TEMPLATE_TABLE = 'loan_email_templates';

// Reads LOAN_EMAIL_TEMPLATES once and returns a picker, mirroring loans.js
// loanTemplateContext (but there is no sender number — email uses RESEND_FROM).
export async function loanEmailTemplateContext(env) {
  const all = await getSheetDataAsJSON(env, 'LOAN_EMAIL_TEMPLATES');
  return {
    pick: (type) => pickRandomActive((all || []).filter(t => t.type === type)),
    countFor: (type) => (all || []).filter(t => t.type === type).length,
  };
}

// Queue ONE loan email of `type` to a recipient USERS row's email. Renders
// subject + body from `data`. Never throws — logs and returns a summary so the
// caller (loans.js, inside its own trySend) can keep going. Group types are not
// emailed here; callers simply don't call this for group notifications.
//
// `ctxHelper` is an optional pre-loaded loanEmailTemplateContext (so a caller
// that sends several emails in one operation reads the templates once).
export async function queueLoanEmail(env, type, recipientUser, data, context, ctxHelper) {
  try {
    const toEmail = cleanEmail(recipientUser && recipientUser.Email);
    if (!toEmail) {
      await logWarn(env, 'email-loans', 'queueLoanEmail',
        `No valid email for the recipient of a "${type}" loan email — skipped.`,
        { type, ...(context || {}) });
      return { emailSent: false, reason: 'no-email' };
    }
    const tpls = ctxHelper || await loanEmailTemplateContext(env);
    const tpl = tpls.pick(type);
    if (!tpl) {
      await logWarn(env, 'email-loans', 'queueLoanEmail',
        `No active "${type}" loan email template — no email queued.`, { type, ...(context || {}) });
      return { emailSent: false, reason: 'no-template' };
    }
    const subjectR = renderTemplateChecked(tpl.subject, data);
    const bodyR = renderTemplateChecked(tpl.text, data);
    const missing = [...new Set([...subjectR.missing, ...bodyR.missing])];
    if (missing.length) {
      await logWarn(env, 'email-loans', 'queueLoanEmail',
        `Loan email template ${tpl.template_id || '(unknown)'} [${type}] has unresolved placeholder(s): ${missing.join(', ')} — rendered blank.`,
        { templateId: tpl.template_id, type, missing, ...(context || {}) });
    }
    const from = (env && env.RESEND_FROM) || '';
    const replyTo = (env && env.RESEND_REPLY_TO) || '';
    const res = await queueEmailDirect(env, toEmail, subjectR.text, bodyR.text, from, replyTo, tpl.message_type || 'normal', tpl.file_link || '');
    return { emailSent: !!res.success, reason: res.reason };
  } catch (err) {
    // Loan email must NEVER break the loan/consent flow (nor the WhatsApp send).
    await logErrorAt(env, 'email-loans', 'queueLoanEmail', err, { type, ...(context || {}) });
    return { emailSent: false, reason: 'exception', error: err && err.message };
  }
}

// ---- Loan email template CRUD (Superadmin) ----

export async function addLoanEmailTemplate(env, type, subject, text, messageType, fileLink, user) {
  requireSuperadmin(user);
  if (!type || !type.toString().trim()) throw ValidationError('Template type required');
  if (!subject || !subject.toString().trim()) throw ValidationError('Email subject required');
  if (!text || !text.toString().trim()) throw ValidationError('Template body (text) required');
  const id = randomId('LETPL');
  await env.DB_LOANS_EXPENSES.prepare(
    `INSERT INTO ${LOAN_EMAIL_TEMPLATE_TABLE} (template_id, type, subject, text, active, created_at, message_type, file_link)
     VALUES (?, ?, ?, ?, '1', ?, ?, ?)`
  ).bind(id, type.toString().trim(), subject.toString().trim(), text.toString().trim(), new Date().toISOString(), messageType || 'normal', fileLink || '').run();
  return { success: true, template_id: id };
}

export async function updateLoanEmailTemplate(env, rowIndex, subject, text, active, messageType, fileLink, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw ValidationError('rowIndex required');
  const sets = []; const vals = [];
  if (subject !== undefined) { sets.push('subject = ?'); vals.push(subject); }
  if (text !== undefined) { sets.push('text = ?'); vals.push(text); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active ? '1' : '0'); }
  if (messageType !== undefined) { sets.push('message_type = ?'); vals.push(messageType); }
  if (fileLink !== undefined) { sets.push('file_link = ?'); vals.push(fileLink); }
  if (!sets.length) return { success: true };
  vals.push(rowIndex);
  await env.DB_LOANS_EXPENSES.prepare(`UPDATE ${LOAN_EMAIL_TEMPLATE_TABLE} SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return { success: true };
}

export async function deleteLoanEmailTemplate(env, rowIndex, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw ValidationError('rowIndex required');
  await env.DB_LOANS_EXPENSES.prepare(`DELETE FROM ${LOAN_EMAIL_TEMPLATE_TABLE} WHERE id = ?`).bind(rowIndex).run();
  return { success: true };
}

export async function getLoanEmailTemplates(env, type) {
  const { results } = await env.DB_LOANS_EXPENSES.prepare(
    `SELECT * FROM ${LOAN_EMAIL_TEMPLATE_TABLE} WHERE type = ? ORDER BY id ASC`
  ).bind((type || '').toString()).all();
  // Alias id -> __rowIndex so the frontend edit/delete/toggle (which use
  // __rowIndex) work exactly like the WhatsApp/loan message templates do.
  return (results || []).map(r => ({ ...r, __rowIndex: r.id }));
}

// ---------------------------------------------------------------- Admin views

// Full email log (view-only, Superadmin) — the email equivalent of
// whatsapp.js getMessageLog: every email row, newest first. `body` is excluded
// from the list (it can be long); the recipient, subject, status, remarks and
// timestamps are what the log view needs. `recipient` is aliased for a uniform
// shape with the WhatsApp log.
export async function getEmailLog(env) {
  const { results } = await env.DB_WHATSAPP_INDEX.prepare(
    `SELECT message_id, to_email, subject, status, remarks, created_at, "from", reply_to, message_type, file_link, attempts, sent_at
       FROM ${EMAIL_QUEUE_TABLE} ORDER BY id DESC LIMIT 500`
  ).all();
  return (results || []).map(m => ({ ...m, recipient: m.to_email }));
}

// Stuck emails — same idea as whatsapp getStuckMessages, one table.
export async function getStuckEmails(env, olderThanMinutes) {
  const cutoff = new Date(Date.now() - (parseInt(olderThanMinutes) || 30) * 60000).toISOString();
  const { results } = await env.DB_WHATSAPP_INDEX.prepare(
    `SELECT message_id, to_email, status, attempts, created_at, claimed_at, remarks FROM ${EMAIL_QUEUE_TABLE}
      WHERE status NOT IN ('sent', 'failed') AND created_at < ? ORDER BY created_at ASC LIMIT 200`
  ).bind(cutoff).all();
  return { cutoff, emails: results || [], total: (results || []).length };
}

// Resend a non-sent email (Superadmin) — mirror whatsapp resendMessage.
export async function resendEmail(env, messageId, user) {
  requireSuperadmin(user);
  if (!messageId) throw ValidationError('message_id required');
  const row = await env.DB_WHATSAPP_INDEX.prepare(
    `SELECT id, status, attempts FROM ${EMAIL_QUEUE_TABLE} WHERE message_id = ?`
  ).bind(messageId.toString().trim()).first();
  if (!row) throw ValidationError('Email not found.');
  if (row.status === 'sent') throw ValidationError('This email has already been sent.');
  const attempts = parseInt(row.attempts) || 0;
  if (attempts >= MAX_ATTEMPTS) {
    throw ValidationError(`This email has already been tried ${attempts} times. Check the address/template, then queue a new one.`);
  }
  await env.DB_WHATSAPP_INDEX.prepare(
    `UPDATE ${EMAIL_QUEUE_TABLE} SET status = 'resending', claimed_at = NULL WHERE id = ?`
  ).bind(row.id).run();
  return { success: true, attempts };
}
