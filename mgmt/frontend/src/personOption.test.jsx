// The contributor picker in the LIVE React app showed only a name and a village.
//
// Reported from live use, with a screenshot of the Add Collection dropdown: two "Ajay
// Verma" (one Gardih, one Shaharpura), and an "Aarohi bharti" the reporter expected to
// carry the father's name to tell people apart. Village cannot separate two people of the
// same name in the SAME village — exactly when the wrong contributor is picked and money
// is recorded against the wrong person. The father's name was already on the row, unused.
//
// The Svelte app fixed this in personOption.ts; this is the same fix + tests for the React
// app, which is the one actually deployed as the mgmt portal.

import { describe, it, expect } from 'vitest';
import { personOption, personOptions, fatherNameOf } from './personOption.js';

const user = (over = {}) => ({
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
    const [a, b] = personOptions([
      user({ ID: 'U1', Name: 'Ajay Verma', "Father's Name": 'Ram Verma', Village: 'Gardih' }),
      user({ ID: 'U2', Name: 'Ajay Verma', "Father's Name": 'Shyam Verma', Village: 'Gardih' }),
    ]);
    expect(a.label).not.toBe(b.label);
    expect(a.label).toBe('Ajay Verma (Ram Verma)');
    expect(b.label).toBe('Ajay Verma (Shyam Verma)');
  });

  it('the father name is in the label, which is what SearchableSelect filters on', () => {
    // SearchableSelect.jsx matches `label` and `sub`, so a father's name typed in the
    // search box finds his sons.
    expect(personOption(user()).label.toLowerCase()).toContain('ram kumar');
  });

  it('renders NO brackets when no father name is recorded', () => {
    // "Aarohi bharti ( )" is worse than "Aarohi bharti" — it looks like data that failed
    // to load, which is how the original report read.
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
