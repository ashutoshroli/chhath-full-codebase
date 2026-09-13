import { describe, it, expect } from 'vitest';
import { isTruthyFlag } from './flags';
import { can, canEdit, canDelete, isSuperadmin, isAdminOrAbove, canAddView } from './permissions';

describe('isTruthyFlag (must match backend flags.js)', () => {
  it('accepts true/1/"1"/"true"/"yes" and trims whitespace', () => {
    for (const v of [true, 1, '1', 'true', 'TRUE', ' 1 ', 'True ', 'yes', 'YES']) {
      expect(isTruthyFlag(v), `${JSON.stringify(v)} should be truthy`).toBe(true);
    }
  });
  it('rejects false/0/null/undefined/other strings', () => {
    for (const v of [false, 0, '0', 'false', null, undefined, '', 'no', 'x']) {
      expect(isTruthyFlag(v), `${JSON.stringify(v)} should be falsy`).toBe(false);
    }
  });
});

describe('permissions (role gates)', () => {
  it('Superadmin can add/edit/delete', () => {
    expect(can('Superadmin', 'add')).toBe(true);
    expect(canEdit('Superadmin')).toBe(true);
    expect(canDelete('Superadmin')).toBe(true);
    expect(isSuperadmin('Superadmin')).toBe(true);
    expect(isAdminOrAbove('Superadmin')).toBe(true);
  });
  it('Admin can add/edit but not delete', () => {
    expect(can('Admin', 'add')).toBe(true);
    expect(canEdit('Admin')).toBe(true);
    expect(canDelete('Admin')).toBe(false);
    expect(isSuperadmin('Admin')).toBe(false);
    expect(isAdminOrAbove('Admin')).toBe(true);
  });
  it('Subadmin can only add, and only on users/home', () => {
    expect(can('Subadmin', 'add')).toBe(true);
    expect(canEdit('Subadmin')).toBe(false);
    expect(canDelete('Subadmin')).toBe(false);
    expect(canAddView('Subadmin', 'users')).toBe(true);
    expect(canAddView('Subadmin', 'home')).toBe(true);
    expect(canAddView('Subadmin', 'expenses')).toBe(false);
    expect(canAddView('Admin', 'expenses')).toBe(true);
  });
  it('unknown role has no permissions', () => {
    expect(can('Nobody', 'add')).toBe(false);
    expect(canAddView('Nobody', 'home')).toBe(false);
  });
});
