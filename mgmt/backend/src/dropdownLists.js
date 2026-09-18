import { requireSuperadmin, ValidationError } from './auth.js';

const DROPDOWN_LIST_TYPES = ['Category', 'Payment Mode', 'Loan Status', 'Village'];

function rowOut(r) {
  return { 'List Type': r.list_type, 'English Value': r.english_value, 'Hindi Label': r.hindi_label, 'Active': r.active, 'Sort Order': r.sort_order, __rowIndex: r.id };
}

export async function getDropdownList(env, type) {
  const { results } = await env.DB_CORE.prepare(
    'SELECT * FROM dropdown_lists WHERE list_type = ? ORDER BY sort_order ASC'
  ).bind(type).all();
  return results.map(rowOut);
}

export async function getAllDropdownLists(env) {
  const { results } = await env.DB_CORE.prepare('SELECT * FROM dropdown_lists ORDER BY sort_order ASC').all();
  const grouped = {};
  DROPDOWN_LIST_TYPES.forEach(t => grouped[t] = []);
  results.forEach(r => { (grouped[r.list_type] = grouped[r.list_type] || []).push(rowOut(r)); });
  return grouped;
}

export async function addDropdownListItem(env, type, englishValue, hindiLabel, user) {
  requireSuperadmin(user);
  if (!DROPDOWN_LIST_TYPES.includes(type)) throw ValidationError('Invalid list type');
  if (!englishValue || !englishValue.toString().trim()) throw ValidationError('English value required');
  const existing = await env.DB_CORE.prepare(
    'SELECT english_value, sort_order FROM dropdown_lists WHERE list_type = ?'
  ).bind(type).all();
  if (existing.results.some(r => r.english_value.toLowerCase() === englishValue.toString().trim().toLowerCase())) {
    throw ValidationError('This value is already in the list.');
  }
  const maxOrder = existing.results.reduce((m, r) => Math.max(m, parseInt(r.sort_order) || 0), 0);
  const res = await env.DB_CORE.prepare(
    'INSERT INTO dropdown_lists (list_type, english_value, hindi_label, active, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).bind(type, englishValue.toString().trim(), (hindiLabel || '').toString().trim(), 1, maxOrder + 1).run();
  if (!res || !res.meta || !res.meta.changes) throw ValidationError('Could not add the item. Please try again.');
  return { success: true };
}

export async function updateDropdownListItem(env, rowIndex, englishValue, hindiLabel, active, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw ValidationError('rowIndex required');
  const sets = [];
  const vals = [];
  if (englishValue !== undefined) { sets.push('english_value = ?'); vals.push(englishValue.toString().trim()); }
  if (hindiLabel !== undefined) { sets.push('hindi_label = ?'); vals.push(hindiLabel.toString().trim()); }
  if (active !== undefined) { sets.push('active = ?'); vals.push(active ? 1 : 0); }
  if (!sets.length) return { success: true };
  vals.push(rowIndex);
  const res = await env.DB_CORE.prepare(`UPDATE dropdown_lists SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  if (!res || !res.meta || !res.meta.changes) throw ValidationError('Item not found.');
  return { success: true };
}

export async function deleteDropdownListItem(env, rowIndex, user) {
  requireSuperadmin(user);
  if (!rowIndex) throw ValidationError('rowIndex required');
  const res = await env.DB_CORE.prepare('DELETE FROM dropdown_lists WHERE id = ?').bind(rowIndex).run();
  if (!res || !res.meta || !res.meta.changes) throw ValidationError('Item not found.');
  return { success: true };
}

// Seed data — run once against a fresh `core` DB if DROPDOWN_LISTS didn't have
// rows in your xlsx export (it did — 15 rows — so migration/core.sql already
// covers this; this export is kept only as a reference/backup seed).
// audit L-4: the DROPDOWN_LIST_SEED constant was removed. Nothing imported it, so it
// was seed DATA living in application code where it could drift from what the
// dropdown_lists table actually holds, with no way to notice. Seed data belongs in
// db/seed/ as SQL.
