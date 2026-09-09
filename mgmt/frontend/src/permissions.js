// Mirrors backend/Code.js ROLE_PERMISSIONS. Superadmin: add/edit/delete,
// Admin: add/edit, Subadmin: add only. Legacy free-text roles (from before
// this system) match nothing here, so they lose edit/delete until reassigned.
const ROLE_PERMISSIONS = {
  Superadmin: ['add', 'edit', 'delete'],
  Admin: ['add', 'edit'],
  Subadmin: ['add'],
};

// Subadmin can only add on these views (User, Contribution/Collection).
// Mirrors backend SUBADMIN_ADD_SHEETS — keep in sync.
const SUBADMIN_ADD_VIEWS = ['users', 'home'];

export const can = (role, action) => (ROLE_PERMISSIONS[role] || []).includes(action);
export const canEdit = (role) => can(role, 'edit');
export const canDelete = (role) => can(role, 'delete');
export const isSuperadmin = (role) => role === 'Superadmin';
// Admin or Superadmin. Used for actions Admins may now perform (verify a loan
// consent, mark a loan disbursed) — guarantor edit/replace stays Superadmin-only.
export const isAdminOrAbove = (role) => role === 'Superadmin' || role === 'Admin';

// viewKey: 'home' (collections), 'expenses', 'loans', 'users', 'committee'
export const canAddView = (role, viewKey) => {
  if (!can(role, 'add')) return false;
  if (role === 'Subadmin' && !SUBADMIN_ADD_VIEWS.includes(viewKey)) return false;
  return true;
};
