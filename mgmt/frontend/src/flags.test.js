// Regression suite for isTruthyFlag — the List Management "No values found." bug.
//
// LIVE root cause (Village tab showed nothing after the dropdown_lists id rebuild):
// the dropdown_lists.active column has TEXT affinity, and the D1 storage/rebuild path
// serialized the bound integer 1 as the decimal-formatted STRING "1.0" (not "1").
// useDropdownList.js filters rows through isTruthyFlag(r.Active); "1.0" was not in the
// accepted set, so every rebuilt/new row (Shaharpura, Gardih, id=1 "Lighting", ...) was
// dropped and the UI rendered "No values found." even though the data is correct in D1.
//
// The fix teaches isTruthyFlag to tolerate the decimal-number-as-text form: a string that
// parses to a finite NON-zero number is ON ("1.0" -> true), and "0.0" is OFF, without
// changing any previously accepted or rejected value.

import { describe, it, expect } from 'vitest';
import { isTruthyFlag } from './flags.js';

describe('isTruthyFlag: decimal-number-as-text from D1 (audit M-31 / live Village bug)', () => {
  it('treats the live "1.0" active flag as ON', () => {
    expect(isTruthyFlag('1.0')).toBe(true);
  });

  it('treats "0.0" as OFF', () => {
    expect(isTruthyFlag('0.0')).toBe(false);
  });

  it('tolerates surrounding whitespace on the decimal form (sheet-migrated data)', () => {
    expect(isTruthyFlag(' 1.0 ')).toBe(true);
  });

  it('does not widen scope: non-1 numeric strings stay OFF', () => {
    for (const v of ['2', '-1', '1.5', '2.0', '0.0']) {
      expect(isTruthyFlag(v)).toBe(false);
    }
  });
});

describe('isTruthyFlag: previously-accepted values stay ON', () => {
  for (const v of [true, 1, '1', 'true', 'True ', 'TRUE', 'yes', ' yes ', ' 1 ']) {
    it(`${JSON.stringify(v)} -> true`, () => {
      expect(isTruthyFlag(v)).toBe(true);
    });
  }
});

describe('isTruthyFlag: previously-rejected values stay OFF', () => {
  for (const v of [false, 0, '0', 'false', 'no', '', '   ', 'abc', null, undefined]) {
    it(`${JSON.stringify(v)} -> false`, () => {
      expect(isTruthyFlag(v)).toBe(false);
    });
  }
});
