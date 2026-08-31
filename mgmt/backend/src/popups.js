import { requireAdminOrAbove } from './auth.js';
import { uploadFileToDrive } from './account.js';

function popupOut(r) {
  return { popup_id: r.popup_id, title: r.title, roles: r.roles, active: r.active, start_at: r.start_at, end_at: r.end_at, created_at: r.created_at, updated_at: r.updated_at };
}
function slideOut(r) {
  return { slide_id: r.slide_id, popup_id: r.popup_id, slide_order: r.slide_order, image_url: r.image_url, text: r.text, link_url: r.link_url, link_text: r.link_text };
}

export async function getPopups(env, user) {
  requireAdminOrAbove(user);
  const { results } = await env.DB_MISC.prepare('SELECT * FROM popups ORDER BY created_at DESC').all();
  return results.map(popupOut);
}

export async function getPopupWithSlides(env, popupId, user) {
  requireAdminOrAbove(user);
  const popup = await env.DB_MISC.prepare('SELECT * FROM popups WHERE popup_id = ?').bind(popupId).first();
  if (!popup) throw new Error('Popup nahi mila.');
  const { results } = await env.DB_MISC.prepare('SELECT * FROM popup_slides WHERE popup_id = ? ORDER BY slide_order ASC').bind(popupId).all();
  return { popup: popupOut(popup), slides: results.map(slideOut) };
}

export async function savePopup(env, popupId, title, roles, active, startAt, endAt, user) {
  requireAdminOrAbove(user);
  if (!title || !title.toString().trim()) throw new Error('Title zaroori hai.');
  const rolesStr = Array.isArray(roles) ? roles.join(',') : (roles || '');
  const now = new Date().toISOString();

  if (popupId) {
    const existing = await env.DB_MISC.prepare('SELECT id FROM popups WHERE popup_id = ?').bind(popupId).first();
    if (!existing) throw new Error('Popup nahi mila.');
    await env.DB_MISC.prepare(
      'UPDATE popups SET title = ?, roles = ?, active = ?, start_at = ?, end_at = ?, updated_at = ? WHERE popup_id = ?'
    ).bind(title.toString().trim(), rolesStr, active ? 1 : 0, startAt || '', endAt || '', now, popupId).run();
    return { success: true, popup_id: popupId };
  }

  const id = 'POP' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await env.DB_MISC.prepare(
    'INSERT INTO popups (popup_id, title, roles, active, start_at, end_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title.toString().trim(), rolesStr, active !== undefined ? (active ? 1 : 0) : 1, startAt || '', endAt || '', now, now).run();
  return { success: true, popup_id: id };
}

export async function deletePopup(env, popupId, user) {
  requireAdminOrAbove(user);
  await env.DB_MISC.prepare('DELETE FROM popups WHERE popup_id = ?').bind(popupId).run();
  await env.DB_MISC.prepare('DELETE FROM popup_slides WHERE popup_id = ?').bind(popupId).run(); // cascade
  return { success: true };
}

export async function savePopupSlides(env, popupId, slides, user) {
  requireAdminOrAbove(user);
  if (!popupId) throw new Error('popupId required');
  await env.DB_MISC.prepare('DELETE FROM popup_slides WHERE popup_id = ?').bind(popupId).run();
  const stmts = (slides || []).map((s, i) => {
    const id = 'SLD' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i;
    return env.DB_MISC.prepare(
      'INSERT INTO popup_slides (slide_id, popup_id, slide_order, image_url, text, link_url, link_text) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, popupId, i + 1, s.imageUrl || '', s.text || '', s.linkUrl || '', s.linkText || '');
  });
  if (stmts.length) await env.DB_MISC.batch(stmts);
  return { success: true };
}

// Popup images reuse the same Drive folder/upload path as consent photos —
// just a different sub-folder. See account.js's uploadFileToDrive() TODO note.
export async function uploadPopupImage(env, base64, fileName, user) {
  requireAdminOrAbove(user);
  if (!base64) throw new Error('Image required');
  return uploadFileToDrive(env, base64, fileName || 'popup.jpg', 'image/jpeg');
}

export async function getActivePopups(env, user) {
  const now = new Date();
  const { results: allPopups } = await env.DB_MISC.prepare('SELECT * FROM popups WHERE active = 1').all();
  const popups = allPopups.filter(p => {
    const rolesList = (p.roles || '').split(',').map(r => r.trim()).filter(Boolean);
    if (rolesList.length && !rolesList.includes(user.role)) return false;
    if (p.start_at && new Date(p.start_at) > now) return false;
    if (p.end_at && new Date(p.end_at) < now) return false;
    return true;
  });
  if (!popups.length) return [];
  const { results: allSlides } = await env.DB_MISC.prepare('SELECT * FROM popup_slides ORDER BY slide_order ASC').all();
  return popups
    .map(p => ({
      popup_id: p.popup_id,
      title: p.title,
      slides: allSlides.filter(s => s.popup_id === p.popup_id).map(slideOut),
    }))
    .filter(p => p.slides.length > 0);
}
