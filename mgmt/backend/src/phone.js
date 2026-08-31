// ============ PHONE NUMBER NORMALIZATION ============
//
// Before this module there were FOUR mutually inconsistent ways to produce a
// recipient number, so the same person could be stored three different ways:
//   whatsapp.js  -> '91' + digits       (only if exactly 10 digits)
//   loans.js     -> bare 10 digits, NO country code   <- used by MOST sends
//   errorLog.js  -> raw u.WhatsApp, zero validation
//   settings.js  -> withCC(), correct-ish but only ever used for the `from` field
// Result (visible in mgmt/db/migration/whatsapp_index.sql): the same column
// holds both `7282032146` and `917282032146`.
//
// Everything now uses waNumber() below. One format, everywhere: `91XXXXXXXXXX`.
//
// NOTE on E.164: the DB columns are `mobileno REAL` / `"from" REAL` so a literal
// leading '+' cannot survive a round-trip. We therefore standardise on the
// country-code-prefixed digit string (91XXXXXXXXXX) which IS what the external
// WhatsApp sender expects, and expose e164() for anything that needs display.

const INDIA_CC = '91';

/**
 * Normalizes any user-entered Indian mobile number to `91XXXXXXXXXX`.
 * Returns '' when the input cannot be trusted as a real 10-digit mobile — the
 * caller must treat '' as "do not send" (and log it).
 *
 * Handles: 9876543210, +91 98765 43210, 0091-9876543210, 09876543210,
 *          919876543210, and the REAL-number form D1 gives back (9.87654321e9).
 */
export function waNumber(raw) {
  let digits = (raw === undefined || raw === null ? '' : raw.toString()).trim();

  // D1 stores these columns with REAL affinity, so a number can come back as
  // "9876543210" but also as "9876543210.0" or in exponential form.
  if (/e\+?\d+$/i.test(digits)) {
    const n = Number(digits);
    if (Number.isFinite(n)) digits = BigInt(Math.round(n)).toString();
  }
  digits = digits.replace(/\.0+$/, '').replace(/\D/g, '');

  if (!digits) return '';

  // Strip international prefixes / trunk zeros down to the national number.
  if (digits.length === 13 && digits.startsWith('0' + INDIA_CC)) digits = digits.slice(1);
  if (digits.length === 14 && digits.startsWith('00' + INDIA_CC)) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith(INDIA_CC)) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  // Indian mobile numbers are exactly 10 digits and never start with 0-5.
  if (!/^[6-9]\d{9}$/.test(digits)) return '';
  return INDIA_CC + digits;
}

/**
 * Pulls the best available number off a USERS row and normalizes it.
 * Replaces loans.js's whatsappNumberOf() and errorLog.js's raw field access.
 */
export function waNumberOf(user) {
  if (!user) return '';
  return waNumber(user.WhatsApp) || waNumber(user.Mobile);
}

/** Display/logging form only — never written to the message tables. */
export function e164(raw) {
  const n = waNumber(raw);
  return n ? '+' + n : '';
}

/**
 * True when the raw input looks like a number the user *meant* to be a phone
 * number but which we rejected. Lets callers log "invalid number" separately
 * from "no number on file at all".
 */
export function looksLikeAttemptedNumber(raw) {
  const digits = (raw === undefined || raw === null ? '' : raw.toString()).replace(/\D/g, '');
  return digits.length > 0 && !waNumber(raw);
}
