// isTruthyFlag must tolerate the decimal-number-as-text form D1 produces.
//
// LIVE bug: after the dropdown_lists id rebuild, the active flag came back as the STRING
// "1.0" (D1 TEXT affinity serialized the bound integer 1 as a decimal). The mgmt frontend
// filters dropdown rows through isTruthyFlag(r.Active), so "1.0" being unrecognised made
// the List Management Village tab show "No values found." for rows (Shaharpura, Gardih,
// id=1 "Lighting") that were correctly stored in D1. This pins the accepted/rejected sets
// including the new decimal forms. The three-copy parity check lives in
// l13-q4-helper-parity.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTruthyFlag } from '../src/flags.js';

test('isTruthyFlag: decimal-number-as-text forms from the D1 rebuild', () => {
  assert.equal(isTruthyFlag('1.0'), true, '"1.0" must be ON — this is the live Village-tab bug');
  assert.equal(isTruthyFlag('0.0'), false, '"0.0" must be OFF');
  assert.equal(isTruthyFlag(' 1.0 '), true, 'sheet-migrated whitespace around "1.0" must be tolerated');
});

test('isTruthyFlag: non-1 numeric strings are still OFF (no scope creep past the live form)', () => {
  // The M-31 table in frontend-medium-batch.test.mjs documents '2' -> false; keep it that way.
  for (const v of ['2', '-1', '1.5', '2.0', '0.0']) {
    assert.equal(isTruthyFlag(v), false, `${JSON.stringify(v)} must stay OFF`);
  }
});

test('isTruthyFlag: previously-accepted values are preserved (ON)', () => {
  for (const v of [true, 1, '1', 'true', 'True ', 'TRUE', 'yes', ' yes ', ' 1 ']) {
    assert.equal(isTruthyFlag(v), true, `${JSON.stringify(v)} must stay ON`);
  }
});

test('isTruthyFlag: previously-rejected values are preserved (OFF)', () => {
  for (const v of [false, 0, '0', 'false', 'no', '', '   ', 'abc', null, undefined]) {
    assert.equal(isTruthyFlag(v), false, `${JSON.stringify(v)} must stay OFF`);
  }
});
