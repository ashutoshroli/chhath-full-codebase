import { requireSuperadmin } from './auth.js';

// ---- Festival dates (core db) ----
export async function getFestivalDates(env, year) {
  const row = await env.DB_CORE.prepare('SELECT * FROM festival_dates WHERE year = ?').bind(parseInt(year)).first();
  if (!row) return { Year: year, 'Diwali Next Day Date': '', 'Nahay-Khay Date': '', 'Chhath Morning Arghya Date': '' };
  return {
    Year: row.year,
    'Diwali Next Day Date': row.diwali_next_day_date,
    'Nahay-Khay Date': row.nahay_khay_date,
    'Chhath Morning Arghya Date': row.chhath_morning_arghya_date,
  };
}

export async function saveFestivalDates(env, year, diwali, nahayKhay, chhathArghya, user) {
  requireSuperadmin(user);
  const existing = await env.DB_CORE.prepare('SELECT id FROM festival_dates WHERE year = ?').bind(parseInt(year)).first();
  if (existing) {
    await env.DB_CORE.prepare(
      'UPDATE festival_dates SET diwali_next_day_date = ?, nahay_khay_date = ?, chhath_morning_arghya_date = ? WHERE year = ?'
    ).bind(diwali, nahayKhay, chhathArghya, parseInt(year)).run();
  } else {
    await env.DB_CORE.prepare(
      'INSERT INTO festival_dates (year, diwali_next_day_date, nahay_khay_date, chhath_morning_arghya_date) VALUES (?, ?, ?, ?)'
    ).bind(parseInt(year), diwali, nahayKhay, chhathArghya).run();
  }
  return { success: true };
}

const WEEKDAY_HI = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
export function dayNamesOf(dateStr) {
  if (!dateStr) return { en: '', hi: '' };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { en: '', hi: '' };
  const en = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  return { en, hi: WEEKDAY_HI[d.getDay()] };
}

// ---- Portal settings (core db) ----
export async function getPortalSetting(env, key) {
  const row = await env.DB_CORE.prepare('SELECT value FROM portal_settings WHERE key = ?').bind(key).first();
  return row ? row.value : '';
}

export async function setPortalSetting(env, key, value, user) {
  requireSuperadmin(user);
  const existing = await env.DB_CORE.prepare('SELECT id FROM portal_settings WHERE key = ?').bind(key).first();
  if (existing) {
    await env.DB_CORE.prepare('UPDATE portal_settings SET value = ? WHERE key = ?').bind(value, key).run();
  } else {
    await env.DB_CORE.prepare('INSERT INTO portal_settings (key, value) VALUES (?, ?)').bind(key, value).run();
  }
  return { success: true };
}

export function withCC(number) {
  const digits = (number || '').toString().replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}

export async function otpConsentSenderNumber(env) {
  return withCC(await getPortalSetting(env, 'otp_consent_sender_number'));
}

// ---- Consent page templates (templates db) — seed text already migrated via
// migration/templates.sql from the live xlsx export, so no need to re-embed the
// long bilingual legal text here; this is pure CRUD over that table. ----
export async function getConsentPageTemplate(env, type) {
  const row = await env.DB_TEMPLATES.prepare('SELECT * FROM consent_page_templates WHERE type = ?').bind(type).first();
  return row ? { type: row.type, text: row.text, updated_at: row.updated_at } : { type, text: '', updated_at: '' };
}

export async function updateConsentPageTemplate(env, type, text, user) {
  requireSuperadmin(user);
  const existing = await env.DB_TEMPLATES.prepare('SELECT id FROM consent_page_templates WHERE type = ?').bind(type).first();
  const now = new Date().toISOString();
  if (existing) {
    await env.DB_TEMPLATES.prepare('UPDATE consent_page_templates SET text = ?, updated_at = ? WHERE type = ?').bind(text, now, type).run();
  } else {
    await env.DB_TEMPLATES.prepare('INSERT INTO consent_page_templates (type, text, updated_at) VALUES (?, ?, ?)').bind(type, text, now).run();
  }
  return { success: true };
}
