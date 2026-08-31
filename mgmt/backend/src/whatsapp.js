import { getSheetDataAsJSON } from './crud.js';
import { requireSuperadmin, PermissionError } from './auth.js';
import { withCC } from './settings.js';

const TEMPLATE_TABLE = { PERSON_MESSAGE_TEMPLATES: 'person_message_templates', GROUP_MESSAGE_TEMPLATES: 'group_message_templates' };
const MESSAGE_TABLE = { person: { table: 'person_messages', idCol: 'mobileno' }, group: { table: 'group_messages', idCol: 'groupid' } };

function generateMessageId() { return 'MSG' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ---- Templates CRUD (Superadmin) ----
export async function addTemplate(env, sheetName, text, messageType, contributionType, fileLink, docSubType, fileDocType, user) {
  requireSuperadmin(user);
  if (!text || !text.toString().trim()) throw new Error('Template text required');
  const table = TEMPLATE_TABLE[sheetName];
  const id = 'TPL' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await env.DB_WHATSAPP_INDEX.prepare(
    `INSERT INTO ${table} (template_id, text, active, created_at, message_type, contribution_type, file_link, doc_sub_type, file_doc_type) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`
  ).bind(id, text.toString().trim(), new Date().toISOString(), messageType || 'normal', contributionType || '1', fileLink || '', docSubType || '', fileDocType || '').run();
  return { success: true, template_id: id };
}

export async function updateTemplate(env, sheetName, rowIndex, text, active, messageType, contributionType, fileLink, docSubType, fileDocType, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw new Error('rowIndex required');
  const table = TEMPLATE_TABLE[sheetName];
  const sets = []; const vals = [];
  if (text !== undefined) { sets.push('text = ?'); vals.push(text); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active ? 1 : 0); }
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
  await env.DB_WHATSAPP_INDEX.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(rowIndex).run();
  return { success: true };
}

// ---- Group Info CRUD (Superadmin) ----
export async function addWhatsappGroup(env, groupName, groupid, user) {
  requireSuperadmin(user);
  if (!groupName || !groupid) throw new Error('Group name and Group ID required');
  const id = 'GRP' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await env.DB_WHATSAPP_INDEX.prepare(
    'INSERT INTO whatsapp_groups (group_id, group_name, groupid, active, created_at) VALUES (?, ?, ?, 1, ?)'
  ).bind(id, groupName.toString().trim(), groupid.toString().trim(), new Date().toISOString()).run();
  return { success: true, group_id: id };
}

export async function updateWhatsappGroup(env, rowIndex, groupName, groupid, active, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw new Error('rowIndex required');
  const sets = []; const vals = [];
  if (groupName !== undefined) { sets.push('group_name = ?'); vals.push(groupName); }
  if (groupid !== undefined) { sets.push('groupid = ?'); vals.push(groupid); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active ? 1 : 0); }
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

// ---- Queue polling (external automation script, apiKey-based) ----
export async function getPendingMessages(env) {
  const isPending = (m) => m.status === 'pending' || m.status === 'resending';
  const person = (await getSheetDataAsJSON(env, 'PERSON_MESSAGES')).filter(isPending).map(m => ({ ...m, type: 'person' }));
  const group = (await getSheetDataAsJSON(env, 'GROUP_MESSAGES')).filter(isPending).map(m => ({ ...m, type: 'group' }));
  return person.concat(group);
}

export async function resendMessage(env, type, messageId, user) {
  requireSuperadmin(user);
  const table = type === 'person' ? 'person_messages' : type === 'group' ? 'group_messages' : null;
  if (!table) throw new Error('type must be person or group');
  const row = await env.DB_WHATSAPP_INDEX.prepare(`SELECT id, status FROM ${table} WHERE message_id = ?`).bind(messageId.toString().trim()).first();
  if (!row) throw new Error('Message nahi mila.');
  if (row.status !== 'failed') throw new Error('Sirf failed messages hi resend kiye ja sakte hain (current status: ' + row.status + ')');
  await env.DB_WHATSAPP_INDEX.prepare(`UPDATE ${table} SET status = 'resending' WHERE id = ?`).bind(row.id).run();
  return { success: true };
}

export async function updateMessageStatus(env, type, messageId, status, remarks) {
  if (!type || !messageId || !status) throw new Error('type, message_id and status required');
  if (['sent', 'failed'].indexOf(status) === -1) throw new Error('status must be sent or failed');
  const table = type === 'person' ? 'person_messages' : type === 'group' ? 'group_messages' : null;
  if (!table) throw new Error('type must be person or group');
  const result = await env.DB_WHATSAPP_INDEX.prepare(
    `UPDATE ${table} SET status = ?, remarks = ? WHERE message_id = ?`
  ).bind(status, remarks || '', messageId.toString().trim()).run();
  if (!result.meta.changes) throw new Error('message_id not found');
  return { success: true };
}

// ---- Template rendering (verbatim from Code.js) ----
export function renderTemplate(text, data) {
  let out = (text || '').toString();
  Object.keys(data).forEach(key => {
    out = out.split('{' + key + '}').join(data[key] !== undefined && data[key] !== null ? data[key].toString() : '');
  });
  return out;
}
export function pickRandomActive(rows) {
  const active = rows.filter(r => isTruthyFlag(r.active));
  if (!active.length) return null;
  return active[Math.floor(Math.random() * active.length)];
}
export function templatesForContribution(allTemplates, contributionType, docSubType) {
  let pool = allTemplates.filter(t => (t.contribution_type || '1').toString() === contributionType);
  if (contributionType === '3') {
    const exact = pool.filter(t => (t.doc_sub_type || '') === docSubType);
    pool = exact.length ? exact : pool.filter(t => !t.doc_sub_type);
  }
  return pool;
}

function isTruthyFlag(v) { return v === true || v === 'true' || v === 'TRUE' || v === '1'; }

export async function queuePersonMessageDirect(env, mobile10Digit, message, from, messageType, fileLink) {
  await env.DB_WHATSAPP_INDEX.prepare(
    'INSERT INTO person_messages (message_id, mobileno, message, status, remarks, created_at, "from", message_type, file_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(generateMessageId(), mobile10Digit, message, 'pending', '', new Date().toISOString(), from || '', messageType || 'normal', fileLink || '').run();
}

// ---- queueCollectionMessages (called by frontend right after a COLLECTIONS
// save + that recipient's own PDF has finished generating client-side) ----
export async function queueCollectionMessages(env, payload, rowIndex, fileLink, user) {
  const docType = resolveCollectionDocType(payload);
  const recordId = (docType && rowIndex) ? `${docType}-${payload.Year}-${rowIndex}` : null;
  payload['Created By'] = user ? user.name : payload['Created By'];
  await triggerCollectionMessages(env, payload, docType, recordId, fileLink || '');
  return { success: true };
}

function resolveCollectionDocType(payload) {
  if (isTruthyFlag(payload['Is Resell'])) return null;
  const type = (payload['Contribution Type'] || '1').toString();
  if (type === '1') return 'receipt';
  if (type === '2') return 'samaan';
  if (type === '3') return payload['Certificate Or Receipt'] === 'Certificate' ? 'certificate' : 'receipt';
  return null;
}

export async function triggerCollectionMessages(env, payload, docType, recordId, generatedFileLink) {
  try {
    const resolveFileLink = (tpl) => {
      if (tpl.file_doc_type) return (docType && tpl.file_doc_type === docType) ? (generatedFileLink || '') : '';
      return tpl.file_link || '';
    };
    const parseAmt = (v) => parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;
    const users = await getSheetDataAsJSON(env, 'USERS');
    const isResell = isTruthyFlag(payload['Is Resell']);
    const contributor = isResell ? null : users.find(u => (u.ID || '').toString().trim() === (payload.Name || '').toString().trim());
    const contributionType = (payload['Contribution Type'] || '1').toString();
    const effectiveType = isResell ? '4' : contributionType;
    const docSubType = (payload['Certificate Or Receipt'] || '').toString();

    const actingUser = users.find(u => u.ID === payload['Created By']);
    const from = actingUser ? withCC(actingUser.WhatsApp || actingUser.Mobile || '') : '';

    const placeholderData = {
      Name: contributor ? contributor.Name : (payload.Name || ''),
      NameHindi: contributor ? (contributor['Name (Hindi)'] || '') : '',
      Amount: parseAmt(payload.Amount),
      Year: payload.Year || '',
      PaymentMethod: payload['Payment Mode'] || '',
      Village: contributor ? (contributor.Village || '') : '',
      VillageHindi: contributor ? (contributor['Village (Hindi)'] || '') : '',
      FatherName: contributor ? (contributor["Father's Name"] || '') : '',
      FatherNameHindi: contributor ? (contributor["Father's Name (Hindi)'] || '') : '',
      Detail: payload.Detail || '',
      ItemName: isResell ? (payload.Detail || '') : '',
    };

    const groups = (await getSheetDataAsJSON(env, 'WHATSAPP_GROUPS')).filter(g => isTruthyFlag(g.active));
    const groupTemplates = templatesForContribution(await getSheetDataAsJSON(env, 'GROUP_MESSAGE_TEMPLATES'), effectiveType, docSubType);
    
    let groupMessagesSent = 0;
    for (const g of groups) {
      const tpl = pickRandomActive(groupTemplates);
      if (!tpl) {
        // Log missing template for debugging
        await env.DB_LOGS.prepare(
          'INSERT INTO error_log (id, category, location, message, stack, context, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          'ERR' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          'whatsapp-queue-warning',
          'triggerCollectionMessages',
          `No active group template found for contribution type ${effectiveType}${docSubType ? ' docSubType=' + docSubType : ''}`,
          '',
          JSON.stringify({ groupId: g.groupid, groupName: g.group_name, contributionType: effectiveType, docSubType }),
          new Date().toISOString()
        ).run().catch(() => {});
        continue;
      }
      const message = renderTemplate(tpl.text, placeholderData);
      await env.DB_WHATSAPP_INDEX.prepare(
        'INSERT INTO group_messages (message_id, groupid, message, status, remarks, created_at, "from", message_type, file_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(generateMessageId(), g.groupid, message, 'pending', '', new Date().toISOString(), from, tpl.message_type || 'normal', resolveFileLink(tpl)).run();
      groupMessagesSent++;
    }

    const rawNumber = contributor ? (contributor.WhatsApp || contributor.Mobile || '').toString().trim() : '';
    const waNumber = (!isResell && /^\d{10}$/.test(rawNumber)) ? '91' + rawNumber : '';
    let personMessageSent = false;
    
    if (waNumber) {
      const personTemplates = templatesForContribution(await getSheetDataAsJSON(env, 'PERSON_MESSAGE_TEMPLATES'), contributionType, docSubType);
      const tpl = pickRandomActive(personTemplates);
      if (tpl) {
        const message = renderTemplate(tpl.text, placeholderData);
        await queuePersonMessageDirect(env, waNumber, message, from, tpl.message_type || 'normal', resolveFileLink(tpl));
        personMessageSent = true;
      } else {
        // Log missing person template
        await env.DB_LOGS.prepare(
          'INSERT INTO error_log (id, category, location, message, stack, context, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          'ERR' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          'whatsapp-queue-warning',
          'triggerCollectionMessages',
          `No active person template found for contribution type ${contributionType}${docSubType ? ' docSubType=' + docSubType : ''}`,
          '',
          JSON.stringify({ waNumber, contributorName: payload.Name, contributionType, docSubType }),
          new Date().toISOString()
        ).run().catch(() => {});
      }
    } else if (!isResell && contributor) {
      // Log missing/invalid WhatsApp number
      await env.DB_LOGS.prepare(
        'INSERT INTO error_log (id, category, location, message, stack, context, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        'ERR' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        'whatsapp-queue-warning',
        'triggerCollectionMessages',
        `Invalid or missing WhatsApp number for contributor ${payload.Name}`,
        '',
        JSON.stringify({ contributorId: payload.Name, rawNumber, contributorData: { WhatsApp: contributor.WhatsApp, Mobile: contributor.Mobile } }),
        new Date().toISOString()
      ).run().catch(() => {});
    }

    // Success summary log
    if (groupMessagesSent > 0 || personMessageSent) {
      console.log(`WhatsApp queued: ${groupMessagesSent} group message(s), ${personMessageSent ? '1 person message' : '0 person messages'}`);
    }
  } catch (err) {
    // Swallow — never let WhatsApp queueing break a collection save.
    console.error('WhatsAppQueueError', err);
    // But log the actual error for debugging
    try {
      await env.DB_LOGS.prepare(
        'INSERT INTO error_log (id, category, location, message, stack, context, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        'ERR' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        'whatsapp-queue-error',
        'triggerCollectionMessages',
        err.message || 'Unknown error',
        err.stack || '',
        JSON.stringify({ payload, docType, recordId }),
        new Date().toISOString()
      ).run();
    } catch (logErr) {
      console.error('Failed to log WhatsApp error:', logErr);
    }
  }
}

export async function triggerUserMessages(env, payload) {
  try {
    const rawNumber = (payload.WhatsApp || payload.Mobile || '').toString().trim();
    const waNumber = /^\d{10}$/.test(rawNumber) ? '91' + rawNumber : '';
    if (!waNumber) return;
    const tpl = pickRandomActive(await getSheetDataAsJSON(env, 'PERSON_MESSAGE_TEMPLATES'));
    if (!tpl) return;
    const message = renderTemplate(tpl.text, { Name: payload.Name || '', NameHindi: payload['Name (Hindi)'] || '' });
    await queuePersonMessageDirect(env, waNumber, message, '', tpl.message_type || 'normal', tpl.file_link || '');
  } catch (err) {
    console.error('WhatsAppQueueError', err);
  }
}
