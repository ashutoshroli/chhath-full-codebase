import { requireSuperadmin, ValidationError } from './auth.js';

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

// audit L-12 — the English and Hindi day names were computed from DIFFERENT clocks.
//
//     const en = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
//     return { en, hi: WEEKDAY_HI[d.getDay()] };
//
// `en` was formatted in IST. `d.getDay()` is the LOCAL weekday, and a Cloudflare
// Worker's local zone is UTC — so any timestamp falling between 18:30 UTC and
// midnight UTC is already the next day in IST, and the two names disagreed by one.
//
// These names go onto loan consent documents (FINAL_REPAYMENT_DAY_NAME,
// NAHAY_KHAY_DAY_NAME, CHHATH_MORNING_ARGHYA_DAY_NAME, DIWALI_NEXT_DAY_DAY_NAME),
// which the loaner and three guarantors sign. A document reading "Monday /
// रविवार" is not a cosmetic defect.
//
// Keying the Hindi name on the English one that `toLocaleDateString` ALREADY
// produced in IST removes the second clock entirely — there is no index arithmetic
// left to get wrong.
const WEEKDAY_HI_BY_EN = {
  Sunday: 'रविवार',
  Monday: 'सोमवार',
  Tuesday: 'मंगलवार',
  Wednesday: 'बुधवार',
  Thursday: 'गुरुवार',
  Friday: 'शुक्रवार',
  Saturday: 'शनिवार',
};

export function dayNamesOf(dateStr) {
  if (!dateStr) return { en: '', hi: '' };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { en: '', hi: '' };
  const en = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  return { en, hi: WEEKDAY_HI_BY_EN[en] || '' };
}

// ---- Portal settings (core db) ----
export async function getPortalSetting(env, key) {
  // `key` is a SQLite keyword — always quote it (audit 6.5), matching dataVersion.js.
  const row = await env.DB_CORE.prepare('SELECT value FROM portal_settings WHERE "key" = ?').bind(key).first();
  return row ? row.value : '';
}

// ============ DONATION PAYMENT DETAILS (carry-over C3) ============
//
// THE DEFECT. The seven `donation_*` settings are the page that tells people where to
// send money. Both mgmt frontends published them by calling the SINGULAR action seven
// times in a loop, and the server validated nothing at all. Two things followed:
//
//   1. PARTIAL PUBLISH. A failure on call 4 of 7 — a dropped connection on a phone,
//      which is how this screen is actually used — left the public Donate page showing
//      the NEW UPI id beside the OLD account number and the OLD IFSC. Proven on `main`:
//      a bank transfer made from that page goes to an account the committee has left.
//      The Svelte view's own comment said the remaining risk "cannot be removed from the
//      client — it needs a single atomic settings action on the backend". This is it.
//   2. NO VALIDATION ON THE SERVER. `money.ts` checks these in the BROWSER, and the
//      retained React app (the rollback target, which has no tests) does not check at
//      all — so a typo'd UPI id or account number reached the live Donate page from
//      there, and from any scripted call.
//
// Validating here fixes both frontends at once, including the one nothing else guards.

// Kept in step with mgmt/frontend-svelte/src/lib/money.ts by a test that extracts these
// four literals from both files and compares them. They cannot share a module — one is
// TypeScript in a Vite app, the other runs in workerd — so the drift is guarded instead
// of prevented. The dangerous direction is the SERVER being more permissive, since the
// server is the authority.
const UPI_RE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,32}$/;
const IFSC_RE = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
const ACCOUNT_RE = /^\d{6,20}$/;
const TEN_DIGITS = /^\d{10}$/;

// setting key -> the field it is, for validation. Order is the display order.
export const DONATION_SETTING_KEYS = Object.freeze({
  donation_upi_id: 'upiId',
  donation_qr_url: 'qrUrl',
  donation_bank_account_name: 'bankAccountName',
  donation_bank_name: 'bankName',
  donation_account_number: 'accountNumber',
  donation_ifsc: 'ifsc',
  donation_whatsapp: 'whatsapp',
});

// Format of ONE donation field. Blank is allowed throughout: a committee may publish only
// UPI, or only bank details. A field that IS filled in must be plausible.
function donationFieldProblem(key, value) {
  const v = (value == null ? '' : value.toString()).trim();
  if (!v) return '';
  switch (key) {
    case 'donation_upi_id':
      return UPI_RE.test(v) ? '' : 'The UPI ID does not look right — it should look like name@bank.';
    case 'donation_account_number':
      return ACCOUNT_RE.test(v) ? '' : 'The account number must be 6–20 digits, with no spaces or dashes.';
    case 'donation_ifsc':
      return IFSC_RE.test(v) ? '' : 'The IFSC code does not look right — it should look like SBIN0001234.';
    case 'donation_whatsapp':
      return TEN_DIGITS.test(v) ? '' : 'The WhatsApp number must be exactly 10 digits.';
    default:
      return ''; // the two free-text names and the QR url the server minted itself
  }
}

/**
 * Every problem with a COMPLETE set of donation settings, including the rule that only
 * makes sense across fields.
 *
 * WHY THE PAIR RULE LIVES HERE AND NOT IN THE SINGULAR ACTION. An account number with no
 * IFSC (or the reverse) publishes a transfer nobody can complete — but a loop that writes
 * the seven keys one at a time NECESSARILY passes through that state, so enforcing it per
 * key would reject the committee's own legitimate save half-way through. It is enforceable
 * only when the whole set arrives together, which is the other reason this action exists.
 */
function donationSetProblem(entries) {
  for (const key of Object.keys(entries)) {
    const problem = donationFieldProblem(key, entries[key]);
    if (problem) return problem;
  }
  const account = (entries.donation_account_number || '').toString().trim();
  const ifsc = (entries.donation_ifsc || '').toString().trim();
  if (account && !ifsc) return 'An account number needs its IFSC code as well.';
  if (ifsc && !account) return 'An IFSC code needs the account number as well.';
  return '';
}

// One UPSERT, relying on the UNIQUE index on portal_settings("key").
//
// This also replaces a SELECT-then-INSERT-or-UPDATE, which was racy: two admins saving at
// once both saw "no such row" and both inserted, and the winner was whichever the UNIQUE
// index did not reject. `"key"` stays quoted — it is a SQLite keyword (audit 6.5).
const upsertSetting = (env, key, value) => env.DB_CORE.prepare(
  `INSERT INTO portal_settings ("key", value) VALUES (?, ?)
     ON CONFLICT("key") DO UPDATE SET value = excluded.value`
).bind(key, (value == null ? '' : value.toString()));

export async function setPortalSetting(env, key, value, user) {
  requireSuperadmin(user);
  if (!key) throw ValidationError('Missing required field: key.');
  // A donation field written through the singular action is format-checked too — that is
  // the path the retained React app still uses. The cross-field pair rule is deliberately
  // NOT applied here; see donationSetProblem.
  const problem = donationFieldProblem(key, value);
  if (problem) throw ValidationError(problem);
  await upsertSetting(env, key, value).run();
  return { success: true };
}

/**
 * Write several portal settings ATOMICALLY — all of them or none.
 *
 * `settings` is a plain object of key -> value. D1's batch() is one implicit transaction,
 * so a failure on any statement rolls the whole set back and the Donate page is never
 * left showing a mix of old and new payment details.
 */
export async function setPortalSettings(env, settings, user) {
  requireSuperadmin(user);

  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw ValidationError('Missing required field: settings (an object of key/value pairs).');
  }
  const keys = Object.keys(settings);
  if (!keys.length) throw ValidationError('No settings were supplied.');
  for (const key of keys) {
    if (!key || typeof key !== 'string') throw ValidationError('Every setting needs a key.');
    const value = settings[key];
    if (value != null && typeof value === 'object') {
      throw ValidationError(`The value for ${key} must be text, not an object.`);
    }
  }

  // Validate EVERYTHING before writing ANYTHING — the point of the action.
  const donationKeys = keys.filter((k) => k in DONATION_SETTING_KEYS);
  if (donationKeys.length) {
    const entries = {};
    for (const k of donationKeys) entries[k] = settings[k];
    const problem = donationSetProblem(entries);
    if (problem) throw ValidationError(problem);
  }

  await env.DB_CORE.batch(keys.map((key) => upsertSetting(env, key, settings[key])));
  return { success: true, saved: keys.length };
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
  // A missing `type` would bind `undefined` and crash D1 (D1_TYPE_ERROR / 500).
  // Return a friendly 400 instead (audit HIGH #3).
  if (!type) throw ValidationError('Missing required field: type.');
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
