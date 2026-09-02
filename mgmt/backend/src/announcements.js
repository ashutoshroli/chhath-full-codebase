import { getSheetDataAsJSON } from './crud.js';
import { requireAdminOrAbove, ValidationError, hashPassword, verifyPassword } from './auth.js';
// Audit 6.1: use the shared flag parser. This file's local copy did NOT trim or
// accept 'yes'/0/false the way every other module did — exactly the divergence
// that causes "Active but never shown" bugs.
import { isTruthyFlag } from './flags.js';

const ANNOUNCE_MAX_PIN_ATTEMPTS = 5;
const ANNOUNCE_PIN_LOCKOUT_SECONDS = 900; // 15 min, mirrors login lockout
const ANNOUNCE_SESSION_TTL_SECONDS = 21600; // 6 hours

function generateAnnouncementToken() {
  return crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).slice(2, 8);
}
function generateCustomAnnouncementId() { return 'CA' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// PIN minimum length. A shared on-stage announce link protected by a 4-digit PIN
// (10k combinations) was too weak even with the 5-attempt lockout; require 6.
const ANNOUNCE_MIN_PIN_LENGTH = 6;

// hashPassword / verifyPassword come from auth.js (PBKDF2 + per-link random salt,
// constant-time verification). Legacy bare-SHA-256 PINs still verify.

// ---- Superadmin/Admin: manage links ----

export async function generateAnnouncementLink(env, year, pin, expiresAt, user) {
  requireAdminOrAbove(user);
  if (!year) throw ValidationError('Year is required');
  if (!pin || pin.toString().trim().length < ANNOUNCE_MIN_PIN_LENGTH) {
    throw ValidationError(`PIN must be at least ${ANNOUNCE_MIN_PIN_LENGTH} digits`);
  }

  const token = generateAnnouncementToken();
  const hashedPin = await hashPassword(pin.toString().trim());
  await env.DB_MISC.prepare(
    'INSERT INTO announcement_links (token, year, pin, expiresat, active, createdby, createdat) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).bind(token, year, hashedPin, expiresAt || '', user.name, new Date().toISOString()).run();

  return { success: true, token, pin: pin.toString().trim() };
}

export async function getAnnouncementLinks(env, user) {
  requireAdminOrAbove(user);
  const { results } = await env.DB_MISC.prepare('SELECT * FROM announcement_links').all();
  const now = Date.now();
  return results.map(r => {
    const active = isTruthyFlag(r.active);
    const expiresAt = r.expiresat ? new Date(r.expiresat).getTime() : null;
    const expired = expiresAt !== null && !isNaN(expiresAt) && now > expiresAt;
    return {
      __rowIndex: r.id, Token: r.token, Year: r.year, ExpiresAt: r.expiresat || null,
      Active: active, CreatedBy: r.createdby, CreatedAt: r.createdat,
      status: !active ? 'revoked' : (expired ? 'expired' : 'active'),
    };
  }).sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
}

export async function revokeAnnouncementLink(env, token, user) {
  requireAdminOrAbove(user);
  const result = await env.DB_MISC.prepare('UPDATE announcement_links SET active = 0 WHERE token = ?').bind(token).run();
  if (!result.meta.changes) throw ValidationError('Link not found');
  return { success: true };
}

// ---- Public: PIN verification -> short announceToken session (KV, mirrors login-fail-lock pattern) ----

export async function verifyAnnouncementPin(env, token, pin) {
  if (!token || !pin) return { success: false, message: 'PIN is required' };

  const lockKey = 'announcepinfail:' + token;
  const fails = parseInt((await env.KV_SESSIONS.get(lockKey)) || '0');
  if (fails >= ANNOUNCE_MAX_PIN_ATTEMPTS) {
    return { success: false, message: 'Too many incorrect attempts. Please try again after some time.' };
  }

  const row = await env.DB_MISC.prepare('SELECT * FROM announcement_links WHERE token = ?').bind(token).first();
  if (!row) return { success: false, message: 'This link is not valid' };

  if (!isTruthyFlag(row.active)) return { success: false, message: 'This link has expired', expired: true };
  if (row.expiresat) {
    const exp = new Date(row.expiresat).getTime();
    if (!isNaN(exp) && Date.now() > exp) return { success: false, message: 'This link has expired', expired: true };
  }

  // Constant-time verification; accepts both the legacy bare-SHA-256 PIN hash and
  // the new PBKDF2 format.
  const { ok, needsUpgrade } = await verifyPassword(env, pin.toString().trim(), row.pin);
  if (!ok) {
    await env.KV_SESSIONS.put(lockKey, String(fails + 1), { expirationTtl: ANNOUNCE_PIN_LOCKOUT_SECONDS });
    return { success: false, message: 'Incorrect PIN' };
  }
  await env.KV_SESSIONS.delete(lockKey);

  // Upgrade a legacy PIN hash to PBKDF2 now that we've confirmed it. Best-effort.
  if (needsUpgrade) {
    try {
      const upgraded = await hashPassword(pin.toString().trim());
      await env.DB_MISC.prepare('UPDATE announcement_links SET pin = ? WHERE token = ?').bind(upgraded, token).run();
    } catch (e) { /* non-fatal */ }
  }

  const announceToken = generateAnnouncementToken();
  await env.KV_SESSIONS.put(
    'announce:' + announceToken,
    JSON.stringify({ year: row.year, linkToken: token }),
    { expirationTtl: ANNOUNCE_SESSION_TTL_SECONDS }
  );

  // Built in the same request that just wrote the KV entry — no eventual-
  // consistency read-after-write gap (this was the whole reason Code.js's
  // version does the same inline-build trick with CacheService).
  const queue = await buildAnnouncementQueue(env, row.year, 'All', 'All');

  return { success: true, announceToken, year: row.year, items: queue.items, priorityItems: queue.priorityItems };
}

// Deliberately does NOT behave like an authError — this is a separate PIN
// session from the LOGIN one, often on a different/shared on-stage device.
export async function requireAnnounceSession(env, announceToken) {
  const raw = await env.KV_SESSIONS.get('announce:' + announceToken);
  if (!raw) {
    const err = new Error('Session expired, please enter the PIN again');
    err.announceSessionExpired = true;
    throw err;
  }
  return JSON.parse(raw);
}

// ---- Queue building ----

function collectionAnnounceCategory(row) {
  if (isTruthyFlag(row['Is Resell'])) return 'Resell';
  const ct = (row['Contribution Type'] || '1').toString();
  if (ct === '3') return 'Kaam';
  if (ct === '2') return 'Saman';
  return 'Paisa';
}

function buildAnnouncementItem(itemType, category, id, rowIndex, fields) {
  return Object.assign({ itemType, category, itemId: id, __rowIndex: rowIndex }, fields);
}

export async function getAnnouncementQueue(env, announceToken, statusFilter, typeFilter) {
  const session = await requireAnnounceSession(env, announceToken);
  return buildAnnouncementQueue(env, session.year, statusFilter, typeFilter);
}

async function buildAnnouncementQueue(env, year, statusFilter, typeFilter) {
  const users = await getSheetDataAsJSON(env, 'USERS');
  const userMap = {};
  users.forEach(u => { userMap[(u.ID || '').toString().trim()] = u; });

  const collectionsForYear = (await getSheetDataAsJSON(env, 'COLLECTIONS')).filter(r => parseInt(r.Year) === parseInt(year));
  const customForYear = (await getSheetDataAsJSON(env, 'CUSTOM_ANNOUNCEMENTS')).filter(r => parseInt(r.Year) === parseInt(year));

  const collectionItems = collectionsForYear.map((row, idx) => {
    const category = collectionAnnounceCategory(row);
    const isResell = category === 'Resell';
    const contributor = isResell ? null : userMap[(row.Name || '').toString().trim()];
    return buildAnnouncementItem('collection', category, row.__rowIndex, row.__rowIndex, {
      seq: idx + 1,
      name: isResell ? '' : (contributor ? contributor.Name : (row.Name || '')),
      nameHindi: isResell ? '' : (contributor ? (contributor['Name (Hindi)'] || '') : ''),
      designation: isResell ? '' : (contributor ? (contributor.Designation || '') : ''),
      designationHindi: isResell ? '' : (contributor ? (contributor['Designation (Hindi)'] || '') : ''),
      fatherName: isResell ? '' : (contributor ? (contributor["Father's Name"] || '') : ''),
      fatherNameHindi: isResell ? '' : (contributor ? (contributor["Father's Name (Hindi)"] || '') : ''),
      village: isResell ? '' : (contributor ? (contributor.Village || '') : ''),
      villageHindi: isResell ? '' : (contributor ? (contributor['Village (Hindi)'] || '') : ''),
      amount: row.Amount || '',
      detail: row.Detail || '',
      announced: isTruthyFlag(row.Announced),
      announcedCount: parseInt(row.AnnouncedCount) || 0,
      priority: false,
    });
  });

  const customItems = customForYear.map(row => buildAnnouncementItem('custom', 'Custom', row.ID, row.__rowIndex, {
    order: parseInt(row.Order) || 0,
    textHindi: row.TextHindi || '',
    textEnglish: row.TextEnglish || '',
    announced: isTruthyFlag(row.Announced),
    announcedCount: parseInt(row.AnnouncedCount) || 0,
    priority: isTruthyFlag(row.Priority),
  }));

  const nonPriorityCustom = customItems.filter(c => !c.priority);
  const priorityItems = customItems.filter(c => c.priority && !c.announced);

  let merged;
  if (typeFilter && typeFilter !== 'All' && typeFilter !== 'Custom') {
    merged = collectionItems.filter(c => c.category === typeFilter);
  } else if (typeFilter === 'Custom') {
    merged = nonPriorityCustom;
  } else {
    merged = [];
    let ci = 0;
    for (; ci < collectionItems.length; ci++) {
      merged.push(collectionItems[ci]);
      nonPriorityCustom.filter(c => c.order === ci + 1).forEach(c => merged.push(c));
    }
    nonPriorityCustom.filter(c => c.order > collectionItems.length || c.order <= 0).forEach(c => merged.push(c));
  }

  if (statusFilter === 'Announced') merged = merged.filter(i => i.announced);
  else if (statusFilter === 'Not Announced') merged = merged.filter(i => !i.announced);

  return { year, items: merged, priorityItems };
}

export async function markAnnounced(env, announceToken, itemId, itemType) {
  await requireAnnounceSession(env, announceToken);
  if (itemType === 'custom') {
    const row = await env.DB_MISC.prepare('SELECT announcedcount FROM custom_announcements WHERE id_code = ?').bind(itemId.toString()).first();
    const currentCount = row ? (parseInt(row.announcedcount) || 0) : 0;
    await env.DB_MISC.prepare('UPDATE custom_announcements SET announced = 1, announcedcount = ? WHERE id_code = ?')
      .bind(currentCount + 1, itemId.toString()).run();
    return { success: true, announcedCount: currentCount + 1 };
  }
  const rowIndex = parseInt(itemId);
  if (!rowIndex) throw ValidationError('Item not found');
  const row = await env.DB_COLLECTIONS.prepare('SELECT announcedcount FROM collections WHERE id = ?').bind(rowIndex).first();
  const currentCount = row ? (parseInt(row.announcedcount) || 0) : 0;
  await env.DB_COLLECTIONS.prepare('UPDATE collections SET announced = 1, announcedcount = ? WHERE id = ?')
    .bind(currentCount + 1, rowIndex).run();
  return { success: true, announcedCount: currentCount + 1 };
}

export async function reannounceAll(env, announceToken, typeFilter) {
  const session = await requireAnnounceSession(env, announceToken);
  const year = session.year;

  if (!typeFilter || typeFilter === 'All') {
    await env.DB_COLLECTIONS.prepare('UPDATE collections SET announced = 0, announcedcount = 0 WHERE year = ?').bind(year).run();
    await env.DB_MISC.prepare('UPDATE custom_announcements SET announced = 0, announcedcount = 0 WHERE year = ?').bind(year).run();
  } else if (typeFilter === 'Custom') {
    await env.DB_MISC.prepare('UPDATE custom_announcements SET announced = 0, announcedcount = 0 WHERE year = ?').bind(year).run();
  } else {
    // Category (Paisa/Saman/Kaam/Resell) is derived, not a stored column, so
    // pull the year's rows and filter in JS like Code.js does, then reset by id.
    const { results } = await env.DB_COLLECTIONS.prepare('SELECT id, contribution_type, is_resell FROM collections WHERE year = ?').bind(year).all();
    const ids = results.filter(r => collectionAnnounceCategory({ 'Is Resell': r.is_resell, 'Contribution Type': r.contribution_type }) === typeFilter).map(r => r.id);
    if (ids.length) {
      const stmts = ids.map(id => env.DB_COLLECTIONS.prepare('UPDATE collections SET announced = 0, announcedcount = 0 WHERE id = ?').bind(id));
      await env.DB_COLLECTIONS.batch(stmts);
    }
  }
  return { success: true };
}

// ---- Custom Announcements CRUD (Superadmin/Admin) ----

export async function addCustomAnnouncement(env, year, textHindi, textEnglish, priority, user) {
  requireAdminOrAbove(user);
  if (!year) throw ValidationError('Year is required');
  if (!(textHindi || '').toString().trim() && !(textEnglish || '').toString().trim()) throw ValidationError('At least one of Hindi or English text is required');

  const collectionsForYear = (await getSheetDataAsJSON(env, 'COLLECTIONS')).filter(r => parseInt(r.Year) === parseInt(year));
  const id = generateCustomAnnouncementId();
  await env.DB_MISC.prepare(
    'INSERT INTO custom_announcements (id_code, year, texthindi, textenglish, priority, announced, announcedcount, createdat, "order") VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)'
  ).bind(id, year, textHindi || '', textEnglish || '', priority ? 1 : 0, new Date().toISOString(), collectionsForYear.length).run();
  return { success: true, id };
}

export async function updateCustomAnnouncement(env, id, textHindi, textEnglish, priority, user) {
  requireAdminOrAbove(user);
  const result = await env.DB_MISC.prepare(
    'UPDATE custom_announcements SET texthindi = ?, textenglish = ?, priority = ? WHERE id_code = ?'
  ).bind(textHindi || '', textEnglish || '', priority ? 1 : 0, id.toString()).run();
  if (!result.meta.changes) throw ValidationError('Custom announcement not found');
  return { success: true };
}

export async function deleteCustomAnnouncement(env, id, user) {
  requireAdminOrAbove(user);
  const result = await env.DB_MISC.prepare('DELETE FROM custom_announcements WHERE id_code = ?').bind(id.toString()).run();
  if (!result.meta.changes) throw ValidationError('Custom announcement not found');
  return { success: true };
}

export async function getCustomAnnouncements(env, year, user) {
  requireAdminOrAbove(user);
  const { results } = await env.DB_MISC.prepare('SELECT * FROM custom_announcements WHERE year = ?').bind(parseInt(year)).all();
  return results
    .map(r => ({ ID: r.id_code, Year: r.year, TextHindi: r.texthindi, TextEnglish: r.textenglish, Priority: !!r.priority, Announced: !!r.announced, AnnouncedCount: r.announcedcount, CreatedAt: r.createdat, Order: r.order, __rowIndex: r.id }))
    .sort((a, b) => (parseInt(a.Order) || 0) - (parseInt(b.Order) || 0));
}
