const ROLE_PERMISSIONS = {
  Superadmin: ['add', 'edit', 'delete'],
  Admin: ['add', 'edit'],
  Subadmin: ['add'],
};

const SUBADMIN_ADD_VIEWS = ['users', 'home'];

export const can = (role, action) => (ROLE_PERMISSIONS[role] || []).includes(action);
export const canEdit = (role) => can(role, 'edit');
export const canDelete = (role) => can(role, 'delete');
export const isSuperadmin = (role) => role === 'Superadmin';
export const isAdminOrAbove = (role) => role === 'Superadmin' || role === 'Admin';

export const canAddView = (role, viewKey) => {
  if (!can(role, 'add')) return false;
  if (role === 'Subadmin' && !SUBADMIN_ADD_VIEWS.includes(viewKey)) return false;
  return true;
};
