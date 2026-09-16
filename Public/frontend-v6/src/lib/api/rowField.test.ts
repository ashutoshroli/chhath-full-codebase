// The public portal never showed a father's name — for anyone.
//
// The portal's column headers originate in the spreadsheet this system replaced, and some ended
// with a TRAILING SPACE. The public Worker's reverse map still emits them that way:
//
//     fathers_name: "Father's Name "
//
// while this app read `user["Father's Name"]` without one. Nothing errored. `fatherName` was
// simply always `''`, so `ContributorDetail`'s `{#if displayFather}` never rendered, and the
// field was invisible on every contributor on the site.
//
// Fixed on the READ side: renaming the wire key would be one line here and a breaking change
// for every other reader of that payload.

import { describe, it, expect } from 'vitest';
import { rowField } from './rowField';
import { contributorsForYear } from './derive';

describe('rowField tolerates the header spellings this data has carried', () => {
  it('reads the exact key', () => {
    expect(rowField({ Name: 'Amit' }, 'Name')).toBe('Amit');
  });

  it('reads the trailing-space variant the Worker actually sends', () => {
    // THE bug. This is the real payload shape.
    expect(rowField({ "Father's Name ": 'Ram Kumar' }, "Father's Name")).toBe('Ram Kumar');
    expect(rowField({ 'Mobile ': '9876543210' }, 'Mobile')).toBe('9876543210');
  });

  it('prefers the exact key when both are present', () => {
    expect(rowField({ "Father's Name": 'Exact', "Father's Name ": 'Spaced' }, "Father's Name")).toBe('Exact');
  });

  it('folds the curly apostrophe, which has also been seen', () => {
    expect(rowField({ 'Father\u2019s Name': 'Ram' }, "Father's Name")).toBe('Ram');
  });

  it('collapses inner whitespace', () => {
    expect(rowField({ "Father's  Name": 'Ram' }, "Father's Name")).toBe('Ram');
  });

  it('returns an empty string for a missing field, never undefined', () => {
    expect(rowField({}, 'Name')).toBe('');
    expect(rowField(null, 'Name')).toBe('');
    expect(rowField(undefined, 'Name')).toBe('');
    expect(rowField({ Name: null }, 'Name')).toBe('');
  });

  it('stringifies a numeric cell', () => {
    expect(rowField({ 'Mobile ': 9876543210 }, 'Mobile')).toBe('9876543210');
  });
});

describe('a contributor built from the real payload shape carries a father name', () => {
  const payload = {
    users: [
      {
        ID: 'USER0007',
        Name: 'Amit Kumar',
        // Exactly as the public Worker emits them — trailing spaces included.
        "Father's Name ": 'Ram Kumar',
        "Father's Name (Hindi)": 'राम कुमार',
        Village: 'Baragaon',
        'Village (Hindi)': 'बड़गाँव',
        Designation: 'Member',
      },
    ],
    collections: [
      { Year: 2026, Name: 'USER0007', Amount: 501, 'Contribution Type': '1', __rowIndex: 1 },
    ],
  } as any;

  it('fatherName is populated, so ContributorDetail can render its row', () => {
    const list = contributorsForYear(payload, 2026);
    const amit = list.find((c: any) => c.key === 'USER0007');
    expect(amit).toBeTruthy();
    // Before: '' for every contributor, so the row was never rendered.
    expect(amit!.fatherName).toBe('Ram Kumar');
    expect(amit!.fatherNameHindi).toBe('राम कुमार');
  });

  it('the other fields are unchanged', () => {
    const amit = contributorsForYear(payload, 2026).find((c: any) => c.key === 'USER0007')!;
    expect(amit.name).toBe('Amit Kumar');
    expect(amit.village).toBe('Baragaon');
    expect(amit.villageHindi).toBe('बड़गाँव');
    expect(amit.designation).toBe('Member');
    expect(amit.amount).toBe(501);
  });

  it('a contributor with no father name recorded still builds', () => {
    const noFather = JSON.parse(JSON.stringify(payload));
    delete noFather.users[0]["Father's Name "];
    const c = contributorsForYear(noFather, 2026).find((x: any) => x.key === 'USER0007')!;
    expect(c.fatherName).toBe('');
    expect(c.name).toBe('Amit Kumar');
  });
});
