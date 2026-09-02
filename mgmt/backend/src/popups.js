import { requireAdminOrAbove, ValidationError } from './auth.js';
import { uploadFileToDrive, getDriveAccessToken } from './account.js';
import { base64ToBytes, sniffImageMime } from './base64.js';
import { r2Available, putToR2, keyForPopup, isR2Url, keyFromR2Url, deleteFromR2 } from './r2.js';
import { logWarn, logErrorAt } from './logger.js';

// `popups.active` and the flag columns elsewhere are TEXT (see db/schema/misc.sql),
// so a bound number 1 is stored as the STRING '1' by SQLite's TEXT affinity, and
// the sheet migration wrote 'True'. Any comparison therefore has to accept all of
// those forms — this is the same class of bug as the WhatsApp `active` flag.
function isTruthyFlag(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null || v === undefined) return false;
  const s = v.toString().trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

// Dates are stored as ISO-8601 with an explicit offset (the frontend now converts
// the datetime-local wall time to a real instant before sending). Legacy rows from
// the sheet migration look like '2026-08-22 14:31:00' — space-separated and with
// NO timezone. Such a stamp is read as UTC here.
//
// The zone has to be decided BEFORE `new Date()` sees the string, not as a fallback
// after a failed parse. V8 accepts the space form and reads it as LOCAL time, so a
// parse-then-fix-on-failure order only ever corrects Safari (which rejects it) and
// silently leaves V8 with a local-time reading. That made the Worker (TZ=UTC) and an
// IST browser disagree by 5.5h about the very same stored value.
function parseStoredDate(v) {
  if (!v) return null;
  const raw = v.toString().trim();
  if (!raw) return null;
  // 'YYYY-MM-DD HH:MM:SS' / 'YYYY-MM-DDTHH:MM:SS' -> '...THH:MM:SSZ'
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  let d = new Date(raw.replace(' ', 'T') + (hasZone ? '' : 'Z'));
  if (!isNaN(d.getTime())) return d;
  // Date-only ('2026-08-22') and anything else unusual: let Date decide.
  d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function popupOut(r) {
  return { popup_id: r.popup_id, title: r.title, roles: r.roles, active: r.active, start_at: r.start_at, end_at: r.end_at, created_at: r.created_at, updated_at: r.updated_at };
}
// image_url/text/link_url/link_text are all nullable, and the migrated row has
// text/link_url/link_text = NULL. Handing a raw null to the frontend made
// `slide.text.trim()` throw in PopupManagement's save() — outside its try/catch,
// so the Save button silently did nothing. Coalesce to '' at the boundary.
function slideOut(r) {
  return {
    slide_id: r.slide_id,
    popup_id: r.popup_id,
    slide_order: parseInt(r.slide_order) || 0,
    image_url: r.image_url || '',
    text: r.text || '',
    link_url: r.link_url || '',
    link_text: r.link_text || '',
  };
}

export async function getPopups(env, user) {
  requireAdminOrAbove(user);
  const { results } = await env.DB_MISC.prepare('SELECT * FROM popups ORDER BY created_at DESC').all();
  // Slide counts come along so the list can warn about a popup that can never
  // display (a popup with zero slides is silently dropped by getActivePopups).
  const { results: counts } = await env.DB_MISC.prepare(
    'SELECT popup_id, COUNT(*) AS n FROM popup_slides GROUP BY popup_id'
  ).all().catch(() => ({ results: [] }));
  const countMap = {};
  (counts || []).forEach(c => { countMap[c.popup_id] = c.n; });
  return results.map(r => Object.assign(popupOut(r), { slide_count: countMap[r.popup_id] || 0 }));
}

export async function getPopupWithSlides(env, popupId, user) {
  requireAdminOrAbove(user);
  const popup = await env.DB_MISC.prepare('SELECT * FROM popups WHERE popup_id = ?').bind(popupId).first();
  if (!popup) throw ValidationError('Popup not found.');
  const { results } = await env.DB_MISC.prepare('SELECT * FROM popup_slides WHERE popup_id = ? ORDER BY slide_order ASC').bind(popupId).all();
  return { popup: popupOut(popup), slides: results.map(slideOut) };
}

export async function savePopup(env, popupId, title, roles, active, startAt, endAt, user) {
  requireAdminOrAbove(user);
  if (!title || !title.toString().trim()) throw ValidationError('Title is required.');
  const rolesStr = Array.isArray(roles) ? roles.join(',') : (roles || '');
  const now = new Date().toISOString();
  // Bind the STRING form: the column is TEXT, and writing a number left the DB
  // holding a mix of '1' (portal) and 'True' (migration).
  const activeStr = (active === undefined ? true : isTruthyFlag(active)) ? '1' : '0';

  if (popupId) {
    const existing = await env.DB_MISC.prepare('SELECT id FROM popups WHERE popup_id = ?').bind(popupId).first();
    if (!existing) throw ValidationError('Popup not found.');
    await env.DB_MISC.prepare(
      'UPDATE popups SET title = ?, roles = ?, active = ?, start_at = ?, end_at = ?, updated_at = ? WHERE popup_id = ?'
    ).bind(title.toString().trim(), rolesStr, activeStr, startAt || '', endAt || '', now, popupId).run();
    return { success: true, popup_id: popupId };
  }

  const id = 'POP' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await env.DB_MISC.prepare(
    'INSERT INTO popups (popup_id, title, roles, active, start_at, end_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title.toString().trim(), rolesStr, activeStr, startAt || '', endAt || '', now, now).run();
  return { success: true, popup_id: id };
}

// Best-effort cleanup when a popup is deleted. Handles both R2-hosted images
// (new) and legacy Drive images (old) so neither is orphaned.
async function trashDriveFileByUrl(env, url) {
  // R2-hosted popup image -> delete the R2 object.
  if (isR2Url(env, url)) {
    const key = keyFromR2Url(env, url);
    if (key) {
      try { await deleteFromR2(env, key); }
      catch (err) {
        await logWarn(env, 'backend-popups', 'trashDriveFileByUrl',
          `Popup image left in R2: ${key} — ${err && err.message}`, { key });
      }
    }
    return;
  }

  const m = /[?&]id=([A-Za-z0-9_-]+)|\/d\/([A-Za-z0-9_-]+)/.exec(url || '');
  const fileId = m && (m[1] || m[2]);
  if (!fileId) return;
  try {
    const token = await getDriveAccessToken(env);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok) {
      await logWarn(env, 'backend-popups', 'trashDriveFileByUrl',
        `Popup image left in Drive: file ${fileId} could not be trashed (${res.status}).`, { fileId });
    }
  } catch (err) {
    await logWarn(env, 'backend-popups', 'trashDriveFileByUrl',
      `Popup image left in Drive: ${fileId} — ${err && err.message}`, { fileId });
  }
}

export async function deletePopup(env, popupId, user) {
  requireAdminOrAbove(user);
  // Collect the image URLs BEFORE deleting the rows so the Drive files can be
  // cleaned up (previously they were orphaned forever).
  const { results: slides } = await env.DB_MISC.prepare(
    'SELECT image_url FROM popup_slides WHERE popup_id = ?'
  ).bind(popupId).all().catch(() => ({ results: [] }));

  await env.DB_MISC.batch([
    env.DB_MISC.prepare('DELETE FROM popups WHERE popup_id = ?').bind(popupId),
    env.DB_MISC.prepare('DELETE FROM popup_slides WHERE popup_id = ?').bind(popupId),
  ]);

  for (const s of (slides || [])) {
    if (s.image_url) await trashDriveFileByUrl(env, s.image_url);
  }
  return { success: true };
}

export async function savePopupSlides(env, popupId, slides, user) {
  requireAdminOrAbove(user);
  if (!popupId) throw ValidationError('popupId required');

  // The DELETE and the INSERTs are now a SINGLE batch. Previously the DELETE was
  // committed first and the INSERTs went in a separate batch() — so if that batch
  // failed (or the request died in between) EVERY slide of the popup was
  // permanently lost, which also made the popup silently invisible because
  // getActivePopups drops popups with zero slides.
  const list = (slides || []);
  const stmts = [env.DB_MISC.prepare('DELETE FROM popup_slides WHERE popup_id = ?').bind(popupId)];
  list.forEach((s, i) => {
    const id = 'SLD' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i;
    stmts.push(env.DB_MISC.prepare(
      'INSERT INTO popup_slides (slide_id, popup_id, slide_order, image_url, text, link_url, link_text) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, popupId, i + 1, s.imageUrl || '', s.text || '', s.linkUrl || '', s.linkText || ''));
  });
  await env.DB_MISC.batch(stmts);

  if (!list.length) {
    await logWarn(env, 'backend-popups', 'savePopupSlides',
      `Popup ${popupId} was saved with ZERO slides — it can never be displayed to anyone.`, { popupId });
  }
  return { success: true, slideCount: list.length };
}

// Popup images reuse the same Drive folder/upload path as consent photos.
//
// 8 MB — the frontend already downscales via canvas and sends ~200-400 KB, so this
// is only a safety net (for an old client, or one where the canvas decode failed).
const MAX_POPUP_IMAGE_BYTES = 8 * 1024 * 1024;

export async function uploadPopupImage(env, base64, fileName, mimeType, user) {
  requireAdminOrAbove(user);
  if (!base64) throw ValidationError('An image is required.');

  // Previously there was ONLY `if (!base64)` here. Anything past that — a PDF, an
  // .exe, a 20 MB RAW photo — was sent to Drive labelled 'image/jpeg', and then
  // every user saw a broken image in the login popup. Now the real format is
  // checked from the bytes' magic number (the client's mimeType is not trusted).
  const bytes = base64ToBytes(base64, { label: 'Image', maxBytes: MAX_POPUP_IMAGE_BYTES });
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) {
    throw ValidationError('This file is not an image (JPG, PNG, GIF or WebP is required).');
  }
  // HEIC (iPhone's default format) uploads to Drive fine but Chrome/Firefox/
  // Android WebView cannot render it — the popup silently appears blank. The
  // frontend canvas produces a JPEG; if HEIC reaches this point it means the
  // conversion failed, and it is better to say so clearly than to silently serve
  // a broken image.
  if (sniffed === 'image/heic') {
    throw ValidationError(
      'The iPhone HEIC format does not display in browsers. Save the photo as JPG and ' +
      'upload it (iPhone: Settings > Camera > Formats > Most Compatible).'
    );
  }

  // mimeType was hardcoded to 'image/jpeg' — PNG/WebP also went to Drive as jpeg,
  // so the stored Content-Type was wrong. Now we send the real format.
  const ext = sniffed.split('/')[1].replace('jpeg', 'jpg');
  const safeName = (fileName || '').toString().trim().replace(/[^\w.\-]+/g, '_').slice(0, 80)
    || `popup_${Date.now()}.${ext}`;

  // Popup images go to R2 under `popups/` (NO year — popups are year-independent
  // and are never moved to Drive by the "Move year to Drive" feature). Falls back
  // to Drive when R2 isn't configured.
  if (r2Available(env)) {
    const key = keyForPopup(safeName);
    const imageUrl = await putToR2(env, key, bytes, sniffed);
    return { success: true, imageUrl, url: imageUrl, directUrl: imageUrl, mimeType: sniffed, bytes: bytes.length };
  }

  const res = await uploadFileToDrive(env, base64, safeName, sniffed);
  // `url` is the Drive VIEWER PAGE (…/file/d/<id>/view) — putting that in an
  // <img src> renders nothing. `directUrl` (…/uc?export=view&id=<id>) is the
  // actual image bytes. PopupManagement was storing `url`, so every popup image
  // uploaded through the UI was broken everywhere it was displayed.
  return Object.assign({}, res, { imageUrl: res.directUrl, mimeType: sniffed, bytes: bytes.length });
}

// Shared window/role evaluation so mgmt and the public portal can never drift.
export function popupIsLiveNow(p, now) {
  if (!isTruthyFlag(p.active)) return false;
  const start = parseStoredDate(p.start_at);
  const end = parseStoredDate(p.end_at);
  if (start && start > now) return false;
  if (end && end < now) return false;
  return true;
}

export async function getActivePopups(env, user) {
  const now = new Date();
  // Was `WHERE active = 1`. The column is TEXT, so that matched '1' but NEVER the
  // 'True' the sheet migration wrote — meanwhile the admin list rendered its badge
  // with a permissive isTruthyFlag, so the UI said "Active" while the popup was
  // never served to anybody. Filtering in JS with one shared predicate removes the
  // possibility of the two disagreeing.
  const { results: allPopups } = await env.DB_MISC.prepare('SELECT * FROM popups').all();
  const popups = allPopups.filter(p => {
    if (!popupIsLiveNow(p, now)) return false;
    const rolesList = (p.roles || '').split(',').map(r => r.trim()).filter(Boolean);
    if (rolesList.length && !rolesList.includes(user.role)) return false;
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

// Superadmin-only preview of exactly what the PUBLIC portal will show. There was
// no way to check this from inside mgmt: getActivePopups filters by the caller's
// own role, so a popup tagged only 'Public' was invisible to its own author.
export async function previewPublicPopups(env, user) {
  requireAdminOrAbove(user);
  const now = new Date();
  const { results: allPopups } = await env.DB_MISC.prepare('SELECT * FROM popups').all();
  const eligible = allPopups.filter(p => {
    if (!popupIsLiveNow(p, now)) return false;
    const rolesList = (p.roles || '').split(',').map(r => r.trim()).filter(Boolean);
    return rolesList.includes('Public');
  });
  const { results: allSlides } = await env.DB_MISC.prepare('SELECT * FROM popup_slides ORDER BY slide_order ASC').all();
  const withSlides = eligible.map(p => ({
    popup_id: p.popup_id,
    title: p.title,
    slides: allSlides.filter(s => s.popup_id === p.popup_id).map(slideOut),
  }));
  const shown = withSlides.filter(p => p.slides.length > 0);
  return {
    // The public portal renders popups[0] only, so anything after the first is
    // never seen. The UI now says so instead of leaving the admin guessing.
    shown: shown.slice(0, 1),
    alsoEligibleButNotShown: shown.slice(1).map(p => ({ popup_id: p.popup_id, title: p.title })),
    droppedNoSlides: withSlides.filter(p => p.slides.length === 0).map(p => ({ popup_id: p.popup_id, title: p.title })),
  };
}
