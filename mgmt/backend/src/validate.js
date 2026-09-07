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
