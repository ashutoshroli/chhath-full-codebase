// audit Q-1 — the zero-dependency request validator (src/validate.js).
//
// Q-1 asked for zod at the router boundary. We did not add zod (the mgmt Worker has
// zero runtime deps by design); validate.js is a dependency-free, zod-shaped helper
// that gives the same "one declarative schema per handler" win with correctly-typed
// ValidationError failures. These tests pin its behaviour so handlers can adopt it
// with confidence.
//
// Run: node --test mgmt/backend/test/q1-validate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v, validateFields } from '../src/validate.js';

// A thrown ValidationError is a plain Error with expected=true (auth.js).
function expectValidationError(fn, messageRe) {
  try {
    fn();
  } catch (e) {
    assert.equal(e.expected, true, 'must be a typed ValidationError (expected=true), not a raw Error');
    assert.equal(e.authError, false);
    if (messageRe) assert.match(e.message, messageRe);
    return;
  }
  assert.fail('expected a ValidationError to be thrown');
}

test('required fields: missing/blank throws, present passes', () => {
  const schema = { name: v.string({ required: true }) };
  expectValidationError(() => validateFields({}, schema, 'user'), /user: Name is required/);
  expectValidationError(() => validateFields({ name: '   ' }, schema, 'user'), /Name is required/);
  assert.deepEqual(validateFields({ name: '  Ramesh ' }, schema), { name: 'Ramesh' }, 'trims and keeps');
});

test('optional absent fields are OMITTED, never coerced', () => {
  const schema = { note: v.string(), count: v.integer(), flag: v.boolean() };
  // The whole point: an absent optional field does not become 0/""/false.
  assert.deepEqual(validateFields({}, schema), {});
  assert.deepEqual(validateFields({ count: '' }, schema), {}, 'blank optional omitted, not 0');
});

test('integer: rejects non-integers and enforces min/max', () => {
  const schema = { year: v.integer({ required: true, min: 2000, max: 2100 }) };
  expectValidationError(() => validateFields({ year: '20.5' }, schema), /whole number/);
  expectValidationError(() => validateFields({ year: 'abc' }, schema), /whole number/);
  expectValidationError(() => validateFields({ year: '1999' }, schema), /at least 2000/);
  expectValidationError(() => validateFields({ year: '3000' }, schema), /at most 2100/);
  assert.deepEqual(validateFields({ year: '2026' }, schema), { year: 2026 }, 'coerced to Number');
});

test('number: accepts fractions, rejects NaN', () => {
  const schema = { amount: v.number({ required: true, min: 0 }) };
  assert.deepEqual(validateFields({ amount: '501.5' }, schema), { amount: 501.5 });
  expectValidationError(() => validateFields({ amount: '-1' }, schema), /at least 0/);
  expectValidationError(() => validateFields({ amount: 'xyz' }, schema), /must be a number/);
});

test('digits: exact-length phone check (mirrors the app 10-digit rule)', () => {
  const schema = { mobile: v.digits({ length: 10 }) };
  assert.deepEqual(validateFields({ mobile: '9876543210' }, schema), { mobile: '9876543210' });
  expectValidationError(() => validateFields({ mobile: '12345' }, schema), /exactly 10 digits/);
  expectValidationError(() => validateFields({ mobile: '98765abcde' }, schema), /exactly 10 digits/);
  // optional: absent is fine
  assert.deepEqual(validateFields({}, schema), {});
});

test('oneOf: enum membership', () => {
  const schema = { role: v.oneOf(['Admin', 'Subadmin', 'Superadmin'], { required: true }) };
  assert.deepEqual(validateFields({ role: 'Admin' }, schema), { role: 'Admin' });
  expectValidationError(() => validateFields({ role: 'Treasurer' }, schema), /must be one of: Admin, Subadmin, Superadmin/);
});

test('boolean: accepts the flag forms the DB uses', () => {
  const schema = { active: v.boolean() };
  assert.deepEqual(validateFields({ active: 'true' }, schema), { active: true });
  assert.deepEqual(validateFields({ active: '1' }, schema), { active: true });
  assert.deepEqual(validateFields({ active: 'no' }, schema), { active: false });
  expectValidationError(() => validateFields({ active: 'maybe' }, schema), /must be true or false/);
});

test('string: min/max/pattern', () => {
  const schema = { code: v.string({ required: true, min: 2, max: 5, pattern: /^[A-Z]+$/ }) };
  assert.deepEqual(validateFields({ code: 'ABC' }, schema), { code: 'ABC' });
  expectValidationError(() => validateFields({ code: 'A' }, schema), /at least 2 characters/);
  expectValidationError(() => validateFields({ code: 'ABCDEF' }, schema), /at most 5 characters/);
  expectValidationError(() => validateFields({ code: 'abc' }, schema), /expected format/);
});

test('result contains ONLY declared keys (un-vetted extras are dropped)', () => {
  const schema = { name: v.string({ required: true }) };
  const clean = validateFields({ name: 'X', sneaky: 'DROP TABLE', role: 'Superadmin' }, schema);
  assert.deepEqual(clean, { name: 'X' }, 'extra keys never pass through');
});

test('field names are humanised in messages (snake_case + camelCase)', () => {
  expectValidationError(() => validateFields({}, { fathers_name: v.string({ required: true }) }), /Fathers Name is required/);
  expectValidationError(() => validateFields({}, { loanId: v.string({ required: true }) }), /Loan Id is required/);
});
