// ============ "OUR JOURNEY" CONTENT (journey_entries, core DB) ============
//
// Backs the public "Our Journey / 10 Years of Chhath" year-by-year story, which
// used to be hardcoded in the frontend and is now editable from the mgmt
// "Journey Content" tab. Each row is one year card: year, bilingual title +
// content, and a display position (ascending).
//
// The tagline ("A decade of faith, unity and service") is NOT here — it lives in
// the existing portal_settings key/value table under journey_tagline_en /
// journey_tagline_hi and is edited via getPortalSetting / setPortalSetting.
//
// All rows live in env.DB_CORE (same DB as portal_settings / users).
import { requireAdminOrAbove, ValidationError } from './auth.js';

// Coalesce nullable columns to '' / numbers so the frontend never sees null.
function journeyOut(r) {
  return {
    id: r.id,
    year: r.year == null ? '' : Number(r.year),
    title_en: r.title_en || '',
    title_hi: r.title_hi || '',
    content_en: r.content_en || '',
    content_hi: r.content_hi || '',
    position: r.position == null ? 0 : Number(r.position),
  };
}

export async function getJourneyEntries(env, user) {
  requireAdminOrAbove(user);
  const { results } = await env.DB_CORE
    .prepare('SELECT * FROM journey_entries ORDER BY position ASC, year ASC, id ASC')
    .all()
    .catch(() => ({ results: [] }));
  return (results || []).map(journeyOut);
}

// Insert (id falsy) or update (id given) one entry. Returns the saved id.
export async function saveJourneyEntry(env, entry, user) {
  requireAdminOrAbove(user);
  const e = entry || {};
  const year = parseInt(e.year, 10);
  if (!Number.isFinite(year) || year < 1900 || year > 3000) {
    throw ValidationError('A valid year is required.');
  }
  const title_en = (e.title_en || '').toString();
  const title_hi = (e.title_hi || '').toString();
  const content_en = (e.content_en || '').toString();
  const content_hi = (e.content_hi || '').toString();
  if (!title_en.trim() && !title_hi.trim()) {
    throw ValidationError('A title (English or Hindi) is required.');
  }
  const position = Number.isFinite(parseInt(e.position, 10)) ? parseInt(e.position, 10) : year;

  const id = parseInt(e.id, 10);
  if (Number.isFinite(id) && id > 0) {
    await env.DB_CORE.prepare(
      'UPDATE journey_entries SET year = ?, title_en = ?, title_hi = ?, content_en = ?, content_hi = ?, position = ? WHERE id = ?'
    ).bind(year, title_en, title_hi, content_en, content_hi, position, id).run();
    return { success: true, id };
  }

  const res = await env.DB_CORE.prepare(
    'INSERT INTO journey_entries (year, title_en, title_hi, content_en, content_hi, position) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(year, title_en, title_hi, content_en, content_hi, position).run();
  const newId = res && res.meta ? res.meta.last_row_id : undefined;
  return { success: true, id: newId };
}

export async function deleteJourneyEntry(env, id, user) {
  requireAdminOrAbove(user);
  const rowId = parseInt(id, 10);
  if (!Number.isFinite(rowId) || rowId <= 0) throw ValidationError('A valid entry id is required.');
  await env.DB_CORE.prepare('DELETE FROM journey_entries WHERE id = ?').bind(rowId).run();
  return { success: true };
}

// Persist a new display order. `orderedIds` is the id list in the desired order;
// position is rewritten as 1..N in one batch (same approach as popup slides).
export async function reorderJourneyEntries(env, orderedIds, user) {
  requireAdminOrAbove(user);
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return { success: true };
  const stmts = orderedIds
    .map((id, i) => ({ id: parseInt(id, 10), pos: i + 1 }))
    .filter((x) => Number.isFinite(x.id) && x.id > 0)
    .map((x) => env.DB_CORE.prepare('UPDATE journey_entries SET position = ? WHERE id = ?').bind(x.pos, x.id));
  if (stmts.length) await env.DB_CORE.batch(stmts);
  return { success: true };
}
