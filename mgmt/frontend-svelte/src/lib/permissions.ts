// Ported verbatim from mgmt/frontend/src/permissions.js — role-based gates.
type Role = string;

const ROLE_PERMISSIONS: Record<string, string[]> = {
  Superadmin: ['add', 'edit', 'delete'],
  Admin: ['add', 'edit'],
  Subadmin: ['add']
};

const SUBADMIN_ADD_VIEWS = ['users', 'home'];

export const can = (role: Role, action: string): boolean =>
  (ROLE_PERMISSIONS[role] || []).includes(action);
export const canEdit = (role: Role): boolean => can(role, 'edit');
export const canDelete = (role: Role): boolean => can(role, 'delete');
export const isSuperadmin = (role: Role): boolean => role === 'Superadmin';
export const isAdminOrAbove = (role: Role): boolean => role === 'Superadmin' || role === 'Admin';

export const canAddView = (role: Role, viewKey: string): boolean => {
  if (!can(role, 'add')) return false;
  if (role === 'Subadmin' && !SUBADMIN_ADD_VIEWS.includes(viewKey)) return false;
  return true;
};
