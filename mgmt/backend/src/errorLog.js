import { getSheetDataAsJSON } from './crud.js';
import { requireSuperadmin } from './auth.js';
import { queuePersonMessageDirect } from './whatsapp.js';

export async function logError(env, source, page, message, stack, context) {
  try {
    const id = 'ERR' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await env.DB_LOGS.prepare(
      'INSERT INTO error_log (error_id, source, page, message, stack, context, created_at, reported) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
    ).bind(id, source || 'unknown', page || '', (message || '').toString().slice(0, 1000), (stack || '').toString().slice(0, 2000), (context || '').toString().slice(0, 500), new Date().toISOString()).run();
    return { success: true, errorId: id };
  } catch (e) {
    return { success: false };
  }
}

export async function reportErrorToWhatsApp(env, errorId) {
  const row = await env.DB_LOGS.prepare('SELECT * FROM error_log WHERE error_id = ?').bind(errorId).first();
  if (!row) throw new Error('Error record nahi mila.');
  if (row.reported === 1 || row.reported === true) return { success: true, alreadyReported: true };

  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[u.ID] = u; });
  const superadminMembers = (await getSheetDataAsJSON(env, 'COMMITEE MEMBERS')).filter(m => m.Role === 'Superadmin');
  const superadmins = superadminMembers.map(m => userMap[m.Name]).filter(u => u && (u.WhatsApp || u.Mobile));
  if (superadmins.length === 0) throw new Error('Koi Superadmin ka WhatsApp/Mobile number USERS mein registered nahi hai.');

  // Mark reported=1 with a conditional UPDATE (WHERE reported=0) so a
  // near-simultaneous second call can't slip through — D1's write is atomic per
  // statement, and `meta.changes === 0` tells us someone else already claimed it.
  const result = await env.DB_LOGS.prepare('UPDATE error_log SET reported = 1 WHERE error_id = ? AND reported = 0').bind(errorId).run();
  if (!result.meta.changes) return { success: true, alreadyReported: true };

  const msg = `⚠️ Error Report\nPage: ${row.page}\nSource: ${row.source}\nMessage: ${row.message}\nTime: ${row.created_at}\nRef: ${row.error_id}`;
  const uniqueNumbers = [...new Set(superadmins.map(u => u.WhatsApp || u.Mobile))];
  for (const num of uniqueNumbers) await queuePersonMessageDirect(env, num, msg, '', 'priority', '');

  return { success: true, sentTo: uniqueNumbers.length };
}

export async function getErrorLog(env, user) {
  requireSuperadmin(user);
  const { results } = await env.DB_LOGS.prepare('SELECT * FROM error_log ORDER BY created_at DESC LIMIT 300').all();
  return results;
}
