// The contributor picker showed only a name and a village.
//
// Reported from live use, with a screenshot of the Add Collection dropdown containing **two
// `Ajay Verma`** — one Gardih, one Shaharpura. Village separates those two. It does not
// separate two people with the same name in the SAME village, and that is exactly when the
// wrong contributor is selected and a contribution is recorded against the wrong person.
//
// The father's name was already on the row and unused.

import { describe, it, expect } from 'vitest';
import { personOption, personOptions, fatherNameOf } from './personOption';

const user = (over: Record<string, any> = {}) => ({
  ID: 'USER0007',
  Name: 'Aarohi bharti',
  "Father's Name": 'Ram Kumar',
  Village: 'Shaharpura',
  ...over,
});

describe('a picker option identifies the person, not just the name', () => {
  it('puts the father name beside the name, where it disambiguates at a glance', () => {
    expect(personOption(user()).label).toBe('Aarohi bharti (Ram Kumar)');
  });

  it('keeps the village as the secondary line, as before', () => {
    expect(personOption(user()).sub).toBe('Shaharpura');
  });

  it('two same-name people in the SAME village are now distinguishable', () => {
    // The case village cannot solve — and the reason this change is not cosmetic.
    const [a, b] = personOptions([
      user({ ID: 'U1', Name: 'Ajay Verma', "Father's Name": 'Ram Verma', Village: 'Gardih' }),
      user({ ID: 'U2', Name: 'Ajay Verma', "Father's Name": 'Shyam Verma', Village: 'Gardih' }),
    ]);
    expect(a.label).not.toBe(b.label);
    expect(a.label).toBe('Ajay Verma (Ram Verma)');
    expect(b.label).toBe('Ajay Verma (Shyam Verma)');
  });

  it('the father name is in the label, which is what SearchableSelect filters on', () => {
    // So typing a father's name finds his sons. SearchableSelect matches `label` and `sub`.
    const opt = personOption(user());
    expect(opt.label.toLowerCase()).toContain('ram kumar');
  });

  it('renders NO brackets when no father name is recorded', () => {
    // `Aarohi bharti ( )` is worse than `Aarohi bharti` — it looks like data that failed to
    // load, which is exactly how the original report read.
    expect(personOption(user({ "Father's Name": '' })).label).toBe('Aarohi bharti');
    expect(personOption(user({ "Father's Name": '   ' })).label).toBe('Aarohi bharti');
    const { ["Father's Name"]: _omit, ...withoutField } = user();
    expect(personOption(withoutField).label).toBe('Aarohi bharti');
  });

  it('carries the id as the value, so selection is unchanged', () => {
    expect(personOption(user()).value).toBe('USER0007');
  });

  it('a missing village yields no secondary line rather than an empty one', () => {
    expect(personOption(user({ Village: '' })).sub).toBeUndefined();
    expect(personOption(user({ Village: '  ' })).sub).toBeUndefined();
  });

  it('whitespace around the stored values is trimmed', () => {
    const opt = personOption(user({ Name: '  Aarohi bharti  ', "Father's Name": ' Ram Kumar ' }));
    expect(opt.label).toBe('Aarohi bharti (Ram Kumar)');
  });
});

describe('the trailing-space header is tolerated here too', () => {
  it('reads the spaced variant the public Worker emits', () => {
    // mgmt's own alias is exact, but this helper is correct against either payload — the
    // original sheet headers carried trailing spaces and the public Worker still sends them.
    expect(fatherNameOf({ "Father's Name ": 'Ram Kumar' })).toBe('Ram Kumar');
    expect(fatherNameOf({ "Father's Name": 'Ram Kumar' })).toBe('Ram Kumar');
  });

  it('is safe on an absent or empty row', () => {
    expect(fatherNameOf(null)).toBe('');
    expect(fatherNameOf(undefined)).toBe('');
    expect(fatherNameOf({})).toBe('');
    expect(fatherNameOf({ "Father's Name": null })).toBe('');
  });
});

describe('a list of users maps in order', () => {
  it('preserves order and length', () => {
    const opts = personOptions([user({ ID: 'A' }), user({ ID: 'B' }), user({ ID: 'C' })]);
    expect(opts.map((o) => o.value)).toEqual(['A', 'B', 'C']);
  });

  it('handles a null list', () => {
    expect(personOptions(null)).toEqual([]);
    expect(personOptions(undefined)).toEqual([]);
  });
});
