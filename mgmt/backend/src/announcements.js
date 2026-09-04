import { getSheetDataAsJSON, getSheetDataByYear } from './crud.js';
import { usersByIdCodes } from './lookups.js';
import { requireAdminOrAbove, ValidationError, hashPassword, verifyPassword } from './auth.js';
// Audit 6.1: use the shared flag parser. This file's local copy did NOT trim or
// accept 'yes'/0/false the way every other module did — exactly the divergence
// that causes "Active but never shown" bugs.
import { isTruthyFlag } from './flags.js';
import { randomId, randomToken } from './random.js';

const ANNOUNCE_MAX_PIN_ATTEMPTS = 5;
const ANNOUNCE_PIN_LOCKOUT_SECONDS = 900; // 15 min, mirrors login lockout
const ANNOUNCE_SESSION_TTL_SECONDS = 21600; // 6 hours

// audit H-17 — the PIN lockout counter was keyed on the LINK TOKEN alone:
//
//     const lockKey = 'announcepinfail:' + token;
//
// The token is the URL. It is deliberately shared — WhatsApped around the
// committee and read off a phone on stage. So ANY holder of the link could type
// five wrong PINs and lock the announce screen for EVERYBODY for fifteen
// minutes, from anywhere, at will. During a live on-stage announcement that is a
// denial of service on the event itself, and it needs no credential at all: the
// URL is the whole prerequisite.
//
// Keying the counter on token + the Cloudflare edge IP scopes a lockout to the
// client that is actually failing. `CF-Connecting-IP` is set by the edge and
// cannot be forged by the caller (this is the same value the router's per-IP rate
// limiter uses).
//
// A GLOBAL per-token backstop was considered and rejected. Every failed attempt
// costs a KV write, and KV writes are the tightest free-tier limit (~1,000/day),
// so a second counter would double the write cost of an attack and could be used
// to exhaust the quota instead. The remaining protections are adequate for this
// threat model: a 6-digit numeric PIN (10^6 combinations), a per-IP lockout, the
// router's 20-requests-per-minute-per-IP limit on `verifyAnnouncementPin`, a link
// that expires, and an Admin who can revoke it instantly. Covering the keyspace
// would need ~200,000 distinct IP addresses.
const pinFailKey = (token, ip) => {
  const addr = (ip || '').toString().trim();
  // No edge IP (local `wrangler dev`, an odd proxy): fall back to the old
  // token-only key rather than leaving the attempt ungated.
  return addr ? `announcepinfail:${token}:${addr}` : `announcepinfail:${token}`;
};

// The PIN is typed on a phone by whoever is holding the microphone, and the
// minimum-length message has always said "digits". Enforce it, so a 6-character
// alphanumeric PIN cannot be set and then be impossible to enter on a numeric
// keypad — and so the keyspace claim above actually holds.
const ANNOUNCE_PIN_RE = /^\d+$/;

// SECURITY (audit C-4): the announce token is a bearer credential handed out over
// WhatsApp — it must come from a CSPRNG, not Math.random(). See random.js.
const generateAnnouncementToken = () => randomToken();
const generateCustomAnnouncementId = () => randomId('CA');

// PIN minimum length. A shared on-stage announce link protected by a 4-digit PIN
// (10k combinations) was too weak even with the 5-attempt lockout; require 6.
const ANNOUNCE_MIN_PIN_LENGTH = 6;

// hashPassword / verifyPassword come from auth.js (PBKDF2 + per-link random salt,
// constant-time verification). Legacy bare-SHA-256 PINs still verify.

// ---- Superadmin/Admin: manage links ----

export async function generateAnnouncementLink(env, year, pin, expiresAt, user) {
  requireAdminOrAbove(user);
  if (!year) throw ValidationError('Year is required');
  const pinStr = (pin == null ? '' : pin).toString().trim();
  if (!pinStr || pinStr.length < ANNOUNCE_MIN_PIN_LENGTH) {
    throw ValidationError(`PIN must be at least ${ANNOUNCE_MIN_PIN_LENGTH} digits`);
  }
  if (!ANNOUNCE_PIN_RE.test(pinStr)) {
    throw ValidationError('The PIN must be digits only — it is typed on a phone keypad.');
  }

  const token = generateAnnouncementToken();
  const hashedPin = await hashPassword(pinStr);
  await env.DB_MISC.prepare(
    'INSERT INTO announcement_links (token, year, pin, expiresat, active, createdby, createdat) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).bind(token, parseInt(year), hashedPin, expiresAt || '', user.name, new Date().toISOString()).run();

  // audit H-17: the plaintext PIN is NOT echoed back. It was, and there is no
  // reason for it to travel a second time — the Admin just typed it, so the
  // screen already has it (AnnouncementPortal.jsx now displays its own local
  // value). Echoing it put the live PIN into a response body for no benefit.
  return { success: true, token };
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

export async function verifyAnnouncementPin(env, token, pin, ip) {
  if (!token || !pin) return { success: false, message: 'PIN is required' };

  // audit H-17: scoped to this client, so one person cannot lock the whole
  // committee out of the announce screen mid-event. See pinFailKey above.
  const lockKey = pinFailKey(token, ip);
  const fails = parseInt((await env.KV_SESSIONS.get(lockKey)) || '0');
  if (fails >= ANNOUNCE_MAX_PIN_ATTEMPTS) {
    return {
      success: false,
      message: `Too many incorrect attempts from this device. Please wait ${Math.round(ANNOUNCE_PIN_LOCKOUT_SECONDS / 60)} minutes and try again.`,
    };
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

// audit M-15 — this used to scan USERS, COLLECTIONS and CUSTOM_ANNOUNCEMENTS in
// FULL and filter in JS, and it runs on every PIN verify AND on the 15-second poll
// from AnnouncePage.jsx. During a live announcement that is three full-table reads
// every fifteen seconds, for hours, against the 5,000,000-rows/day D1 budget — from
// a page that is by design open on several phones at once.
//
// Now: the two year-scoped tables are read with `WHERE year = ?` (index-served),
// and USERS is fetched by the exact contributor ids present in that year rather
// than in full (the same batched-lookup approach as H-11).
async function buildAnnouncementQueue(env, year, statusFilter, typeFilter) {
  const y = parseInt(year);

  const [collectionsForYear, customForYear] = await Promise.all([
    getSheetDataByYear(env, 'COLLECTIONS', y),
    // CUSTOM_ANNOUNCEMENTS is not in crud.js's TABLES_WITH_YEAR set, so
    // getSheetDataByYear would silently fall back to a full scan. Query it directly
    // — idx_custom_announcements_year has existed since the original schema.
    (async () => {
      const { results } = await env.DB_MISC
        .prepare('SELECT * FROM custom_announcements WHERE year = ? ORDER BY id ASC').bind(y).all();
      return (results || []).map(r => ({
        ID: r.id_code, Year: r.year, TextHindi: r.texthindi, TextEnglish: r.textenglish,
        Priority: r.priority, Announced: r.announced, AnnouncedCount: r.announcedcount,
        CreatedAt: r.createdat, Order: r.order, __rowIndex: r.id,
      }));
    })(),
  ]);

  // Only the contributors this year's rows actually reference. A resell row has no
  // contributor, so it contributes no id.
  const userMap = await usersByIdCodes(env, collectionsForYear
    .filter(r => collectionAnnounceCategory(r) !== 'Resell')
    .map(r => (r.Name || '').toString().trim()));

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

// audit H-18. Three problems:
//
//  1. THE COUNTER WAS READ-THEN-WRITTEN.
//         const row = await ...SELECT announcedcount...
//         await ...UPDATE SET announcedcount = ? (currentCount + 1)
//     The announce screen is used by SEVERAL people at once on a shared link
//     (that is the entire point of it), so two taps on the same item both read
//     the same count and both write the same value: two announcements, one
//     increment. The count is what the screen uses to show "announced twice", so
//     it quietly under-reports. Fixed by incrementing IN the UPDATE, which is one
//     atomic statement.
//  2. A MISSING ITEM REPORTED SUCCESS. With no row, `currentCount` was 0, the
//     UPDATE matched nothing, and the caller still got
//     `{ success: true, announcedCount: 1 }` — so the screen ticked an item that
//     was never recorded. Now `meta.changes` is checked.
//  3. THE YEAR WAS NOT ENFORCED — see reannounceAll below on why the year is also
//     coerced with parseInt (the empty/NULL case, not a string/number mismatch).
//     The announce session is scoped to ONE year, but
//     the UPDATE addressed the row by id alone. A holder of a 2025 link could
//     mark 2026 items announced (and reannounceAll would then not reset them,
//     because that IS year-scoped). Now the year from the session is part of the
//     WHERE clause.
export async function markAnnounced(env, announceToken, itemId, itemType) {
  const session = await requireAnnounceSession(env, announceToken);
  const year = parseInt(session.year);
  if (!year) throw ValidationError('This announce session has no year. Please enter the PIN again.');

  if (itemType === 'custom') {
    const id = (itemId == null ? '' : itemId).toString().trim();
    if (!id) throw ValidationError('Item not found');
    // COALESCE because `announcedcount` is nullable, and SQLite coerces the
    // REAL/TEXT stored value for the arithmetic exactly as parseInt() used to.
    const res = await env.DB_MISC.prepare(
      "UPDATE custom_announcements SET announced = '1', announcedcount = COALESCE(announcedcount, 0) + 1 "
      + 'WHERE id_code = ? AND year = ?'
    ).bind(id, year).run();
    if (!res.meta.changes) throw ValidationError('Item not found');

    const after = await env.DB_MISC.prepare('SELECT announcedcount FROM custom_announcements WHERE id_code = ?')
      .bind(id).first('announcedcount');
    return { success: true, announcedCount: parseInt(after) || 0 };
  }

  const rowIndex = parseInt(itemId);
  if (!rowIndex) throw ValidationError('Item not found');
  const res = await env.DB_COLLECTIONS.prepare(
    "UPDATE collections SET announced = '1', announcedcount = COALESCE(announcedcount, 0) + 1 "
    + 'WHERE id = ? AND year = ?'
  ).bind(rowIndex, year).run();
  if (!res.meta.changes) throw ValidationError('Item not found');

  const after = await env.DB_COLLECTIONS.prepare('SELECT announcedcount FROM collections WHERE id = ?')
    .bind(rowIndex).first('announcedcount');
  return { success: true, announcedCount: parseInt(after) || 0 };
}

export async function reannounceAll(env, announceToken, typeFilter) {
  const session = await requireAnnounceSession(env, announceToken);
  // audit H-18: `session.year` was used raw in `WHERE year = ?`.
  //
  // To be precise about what that did and did not break: a year that arrives as
  // the STRING '2026' is fine, because SQLite applies the column's REAL affinity
  // to the comparison operand — verified against node:sqlite, `WHERE year = ?`
  // bound with '2026' matches a stored 2026.0. So that is NOT a bug, and this
  // parseInt is not what makes the query work.
  //
  // What it does fix is the empty case. `announcement_links.year` is nullable and
  // the generate call bound whatever it was given, so a link created with a blank
  // year puts `year: null` (or '') into the KV session. `WHERE year = NULL`
  // matches NOTHING — every comparison with NULL is NULL — so "Reannounce all"
  // reset zero rows and still returned `{ success: true }`. The operator saw the
  // action confirmed while the whole list stayed marked as announced, and had no
  // way to find out why. Fail loudly instead.
  const year = parseInt(session.year);
  if (!year) throw ValidationError('This announce session has no year. Please enter the PIN again.');

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

  // audit M-16: this read EVERY collection row of the year and used only
  // `.length`, to place the new item at the end of the queue. COUNT(*) is answered
  // from the year index without materialising a single row.
  const countRow = await env.DB_COLLECTIONS
    .prepare('SELECT COUNT(*) AS n FROM collections WHERE year = ?').bind(parseInt(year)).first();
  const order = countRow ? (Number(countRow.n) || 0) : 0;
  const id = generateCustomAnnouncementId();
  await env.DB_MISC.prepare(
    'INSERT INTO custom_announcements (id_code, year, texthindi, textenglish, priority, announced, announcedcount, createdat, "order") VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)'
  ).bind(id, year, textHindi || '', textEnglish || '', priority ? 1 : 0, new Date().toISOString(), order).run();
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
