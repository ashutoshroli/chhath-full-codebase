// ============ ZERO-DEPENDENCY REQUEST VALIDATION (audit Q-1) ============
//
// Q-1 asked for `zod` at the router boundary to replace ~90 handlers' worth of
// ad-hoc `if (!x) throw` checks. We did NOT add zod, on purpose: the mgmt Worker
// has ZERO runtime dependencies (see package.json — only wrangler as a devDep), by
// design — the source is plain ESM that Node can import directly so the test suite
// runs the real code, and a free-tier Worker bundle stays tiny. Pulling in zod
// (and a package-lock + `npm ci` the backend deliberately avoids) three weeks before
// launch trades that for a large surface area.
//
// Instead this is a small, dependency-free validator with a zod-like declarative
// shape. It gives the SAME win — one consistent, self-documenting place per handler
// that says exactly what a payload must look like — while every failure is a
// correctly-typed ValidationError (audit H-3: user-facing 400, not a logged 500).
//
// USAGE:
//   import { v, validateFields } from './validate.js';
//   const clean = validateFields(req.payload, {
//     name:   v.string({ required: true, max: 120 }),
//     mobile: v.digits({ length: 10 }),            // optional unless required:true
//     year:   v.integer({ required: true, min: 2000, max: 2100 }),
//     role:   v.oneOf(['Admin', 'Subadmin', 'Superadmin'], { required: true }),
//   }, 'user');
//   // -> returns a NEW object with only the declared keys, coerced/trimmed.
//   // -> throws ValidationError('Mobile must be exactly 10 digits') on the first bad field.
//
// Design notes:
//   * A field is OPTIONAL unless `required: true`. An absent/blank optional field is
//     simply omitted from the result (never coerced to 0/'' — that silent coercion
//     is exactly the class of bug the audit flags).
//   * Validators return { ok, value } or { ok:false, message }. `label` prefixes the
//     field name in the message so errors read like the existing hand-written ones.
//   * This does NOT replace domain rules that need the DB (year-locked, role
//     permissions, id allocation) — those stay in the handlers. It replaces the
//     shape/type/format checks that were duplicated and easy to get subtly wrong.

import { ValidationError } from './auth.js';

const isBlank = (x) => x === undefined || x === null || x.toString().trim() === '';

// Turn a field name into a human label: 'fathersName' / 'fathers_name' -> "Fathers Name".
function humanize(name) {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// Each factory returns a validator: (raw) => { ok, value } | { ok:false, message }.
// `opts.required` and `opts.label` are handled by validateFields, so a validator
// only sees a NON-blank value (it is never called for an absent optional field).
export const v = {
  string({ required = false, min = 0, max = Infinity, pattern = null } = {}) {
    return { required, kind: 'string', run(raw) {
      const s = raw.toString().trim();
      if (s.length < min) return { ok: false, message: `must be at least ${min} characters` };
      if (s.length > max) return { ok: false, message: `must be at most ${max} characters` };
      if (pattern && !pattern.test(s)) return { ok: false, message: 'is not in the expected format' };
      return { ok: true, value: s };
    } };
  },

  integer({ required = false, min = -Infinity, max = Infinity } = {}) {
    return { required, kind: 'integer', run(raw) {
      const s = raw.toString().trim();
      if (!/^-?\d+$/.test(s)) return { ok: false, message: 'must be a whole number' };
      const n = parseInt(s, 10);
      if (n < min) return { ok: false, message: `must be at least ${min}` };
      if (n > max) return { ok: false, message: `must be at most ${max}` };
      return { ok: true, value: n };
    } };
  },

  number({ required = false, min = -Infinity, max = Infinity } = {}) {
    return { required, kind: 'number', run(raw) {
      const s = raw.toString().trim();
      const n = Number(s);
      if (!Number.isFinite(n)) return { ok: false, message: 'must be a number' };
      if (n < min) return { ok: false, message: `must be at least ${min}` };
      if (n > max) return { ok: false, message: `must be at most ${max}` };
      return { ok: true, value: n };
    } };
  },

  digits({ required = false, length = null } = {}) {
    return { required, kind: 'digits', run(raw) {
      const s = raw.toString().trim();
      if (length != null) {
        if (!new RegExp(`^\\d{${length}}$`).test(s)) return { ok: false, message: `must be exactly ${length} digits` };
      } else if (!/^\d+$/.test(s)) {
        return { ok: false, message: 'must be digits only' };
      }
      return { ok: true, value: s };
    } };
  },

  // audit P0-09/P0-12: money is NOT `v.number()`. A contribution, an expense and a
  // loan are all "an amount of rupees", and the old checks only asked
  // `isNaN(parseFloat(x))` — so -500, 1e21, '12.3456' and Infinity all passed, and
  // a negative expense silently inflated the surplus the lending budget is derived
  // from. This validator is the one place that says what an amount may be.
  money({ required = false, min = 0.01, max = 100000000, decimals = 2 } = {}) {
    return { required, kind: 'money', run(raw) {
      // Deliberately NO comma stripping: validatePayload only validates, the raw
      // value is what reaches D1. Accepting '1,200' here would store NaN in a REAL
      // column — worse than refusing it and letting the operator retype 1200.
      const s = raw.toString().trim();
      if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, message: 'must be a plain number of rupees, e.g. 1500 or 1500.50 (no commas)' };
      const n = Number(s);
      if (!Number.isFinite(n)) return { ok: false, message: 'must be a number of rupees' };
      const dp = s.includes('.') ? s.split('.')[1].length : 0;
      if (dp > decimals) return { ok: false, message: `may have at most ${decimals} decimal places` };
      if (n < min) {
        return {
          ok: false,
          message: min > 0 ? `must be more than zero (got ${s})` : `must be at least ${min}`,
        };
      }
      if (n > max) return { ok: false, message: `must be at most ${max.toLocaleString('en-IN')}` };
      return { ok: true, value: n };
    } };
  },

  oneOf(allowed, { required = false } = {}) {
    const set = allowed.map((a) => a.toString());
    return { required, kind: 'oneOf', run(raw) {
      const s = raw.toString().trim();
      if (!set.includes(s)) return { ok: false, message: `must be one of: ${set.join(', ')}` };
      return { ok: true, value: s };
    } };
  },

  boolean({ required = false } = {}) {
    return { required, kind: 'boolean', run(raw) {
      const s = raw.toString().trim().toLowerCase();
      if (['1', 'true', 'yes'].includes(s)) return { ok: true, value: true };
      if (['0', 'false', 'no'].includes(s)) return { ok: true, value: false };
      return { ok: false, message: 'must be true or false' };
    } };
  },
};

// Validate `payload` against a `schema` map { fieldName: validator }. Returns a NEW
// object containing only the declared fields (present ones coerced), so a handler
// can't accidentally pass through an un-vetted extra key. Throws ValidationError on
// the first problem, with a message like "Mobile must be exactly 10 digits".
export function validateFields(payload, schema, label) {
  const src = payload && typeof payload === 'object' ? payload : {};
  const out = {};
  const prefix = label ? `${label}: ` : '';

  for (const [field, validator] of Object.entries(schema)) {
    const raw = src[field];
    const name = humanize(field);
    if (isBlank(raw)) {
      if (validator.required) throw ValidationError(`${prefix}${name} is required`);
      continue; // optional + absent -> omit, never coerce
    }
    const res = validator.run(raw);
    if (!res.ok) throw ValidationError(`${prefix}${name} ${res.message}`);
    out[field] = res.value;
  }
  return out;
}


// ---------------------------------------------------------------------------
// audit Q-1 (adoption) — shared field validators that PRESERVE the exact
// user-facing messages the handlers already threw, so they are a true drop-in
// consolidation of duplicated logic (the /^\d{10}$/ phone check and the email
// regex appeared verbatim in account.js addLoginUser + updateLoginUser + crud.js).
// Callers pass the label so the message reads exactly as before, e.g.
// assertTenDigits(mobile, 'Mobile number') -> "Mobile number must be 10 digits".
// Returns the trimmed value; a blank/absent value is allowed (the callers decide
// separately whether the field is required) UNLESS required:true is passed.
// ---------------------------------------------------------------------------
const TEN_DIGITS = /^\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertTenDigits(value, label, { required = false } = {}) {
  const s = (value === undefined || value === null) ? '' : value.toString().trim();
  if (s === '') {
    if (required) throw ValidationError(`${label} must be 10 digits.`);
    return s; // blank allowed — caller's requiredness rules apply elsewhere
  }
  if (!TEN_DIGITS.test(s)) throw ValidationError(`${label} must be 10 digits.`);
  return s;
}

export function assertEmail(value, { required = false } = {}) {
  const s = (value === undefined || value === null) ? '' : value.toString().trim();
  if (s === '') {
    if (required) throw ValidationError('A valid Email is required.');
    return s;
  }
  if (!EMAIL_RE.test(s)) throw ValidationError('A valid Email is required.');
  return s;
}

// ---------------------------------------------------------------------------
// audit P0-09 — money and year, for every write that records or moves rupees.
// ---------------------------------------------------------------------------

// The smallest/largest amount the portal will record. The lower bound is what
// actually matters: a negative amount corrupts every total derived from it (the
// Home surplus, the yearly lending budget, the public portal's figures).
export const MIN_MONEY = 0.01;
export const MAX_MONEY = 100000000; // ₹10 crore — far above any real entry

// Returns the amount as a Number, or throws a ValidationError naming the field.
export function assertMoney(value, label, { required = true, min = MIN_MONEY } = {}) {
  const raw = (value === undefined || value === null) ? '' : value.toString().trim();
  if (raw === '') {
    if (required) throw ValidationError(`${label} is required.`);
    return null;
  }
  const res = v.money({ min, max: MAX_MONEY }).run(raw);
  if (!res.ok) throw ValidationError(`${label} ${res.message}.`);
  return res.value;
}

// A festival year: a 4-digit year the portal could plausibly run in. Financial
// rows MUST carry one — the year drives the lock check, the access check, the
// receipt number and every aggregate.
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export function assertYear(value, label = 'Year', { required = true } = {}) {
  const raw = (value === undefined || value === null) ? '' : value.toString().trim();
  if (raw === '') {
    if (required) throw ValidationError(`${label} is required.`);
    return null;
  }
  const res = v.integer({ min: MIN_YEAR, max: MAX_YEAR }).run(raw);
  if (!res.ok) throw ValidationError(`${label} ${res.message}.`);
  return res.value;
}

// ---------------------------------------------------------------------------
// audit P0-09 — fields the SERVER owns.
//
// toColumnPayload() accepts any key that is already snake_case, so a client could
// send `id`, `created_by`, `sl_no`, `id_code`, `loan_id`, `loan_status`,
// `announcedcount`, … and have it written straight through: rewriting a receipt
// number, re-attributing someone else's entry, or flipping a loan's status without
// going near the workflow that is supposed to do it.
//
// These are rejected when they arrive from a client. The server still sets them
// itself (it calls toColumnPayload with its own values), so nothing internal
// changes.
const SERVER_OWNED_FIELDS = {
  collections: ['id', 'sl_no', 'created_by', 'announced', 'announcedcount'],
  expenses: ['id', 'created_by'],
  users: ['id', 'id_code', 'created_by'],
  committee_members: ['id', 'created_by'],
  loans: ['id', 'loan_id', 'loan_status', 'created_by', 'cash_amount', 'online_amount', 'final_repayment_date'],
  loan_guarantors: ['id', 'loan_id', 'created_by'],
  login_users: ['id', 'password', 'totp_secret_enc', 'totp_pending_enc', 'totp_backup_codes', 'totp_recovery_hash', 'totp_enabled'],
};

// Compare keys ignoring case, spaces, dots and underscores, so 'Sl. No.',
// 'sl_no' and 'SLNO' are all recognised as the same protected column.
const foldKey = (k) => k.toString().toLowerCase().replace(/[^a-z0-9]/g, '');

// `allow` lists columns the CALLER already discards safely, so they may still be
// present. saveRecord passes the two generated ids (`id_code`, `sl_no`): it deletes
// them from the payload and allocates them inside the INSERT (audit H-9), and that
// silent-ignore contract is what stops a caller planting itself on an existing id.
// updateRecordByIdx does NOT allow them — there they would be a real rewrite of a
// member id or a receipt number.
export function assertNoServerOwnedFields(table, payload, { aliases = {}, allow = [] } = {}) {
  const owned = SERVER_OWNED_FIELDS[table];
  if (!owned || !payload || typeof payload !== 'object') return;

  const allowed = new Set(allow.map(foldKey));
  // Fold both the column names and their header aliases (e.g. 'Sl. No.' -> sl_no).
  const protectedKeys = new Set(owned.map(foldKey).filter((k) => !allowed.has(k)));
  for (const [header, column] of Object.entries(aliases)) {
    if (protectedKeys.has(foldKey(column))) protectedKeys.add(foldKey(header));
    if (allowed.has(foldKey(column))) allowed.add(foldKey(header));
  }
  for (const k of allowed) protectedKeys.delete(k);

  for (const key of Object.keys(payload)) {
    if (key === '__rowIndex') continue;
    if (protectedKeys.has(foldKey(key))) {
      throw ValidationError(
        `"${key}" is set by the server and cannot be sent from the browser. `
        + 'Please reload the page and try again.'
      );
    }
  }
}

export function _serverOwnedFieldsFor(table) {
  return SERVER_OWNED_FIELDS[table] || [];
}
