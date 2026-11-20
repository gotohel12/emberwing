// ARVEX role-based access control. This file is the single source of truth for roles and permissions;
// every admin endpoint checks a permission here on the server, the panel only mirrors it.
export const PERMISSIONS = ['view_dashboard', 'view_users', 'manage_users', 'manage_staff', 'manage_reports', 'manage_tickets', 'moderate_players',
  'manage_releases', 'manage_patches', 'manage_announcements', 'manage_changelog', 'manage_servers', 'view_logs', 'manage_settings', 'manage_security'];
export const ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'MODERATOR', 'SUPPORT'];
const RANK = { OWNER: 5, ADMIN: 4, DEVELOPER: 3, MODERATOR: 2, SUPPORT: 1 };
const MATRIX = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS.filter(p => p !== 'manage_security'),
  DEVELOPER: ['view_dashboard', 'manage_releases', 'manage_patches', 'manage_changelog', 'manage_servers', 'view_logs', 'manage_settings'],
  MODERATOR: ['view_dashboard', 'view_users', 'manage_reports', 'moderate_players'],
  SUPPORT: ['view_dashboard', 'view_users', 'manage_tickets']
};
export const can = (role, perm) => !!MATRIX[role] && MATRIX[role].includes(perm);
export const permissionsOf = role => (MATRIX[role] || []).slice();
export const matrix = () => Object.fromEntries(ROLES.map(r => [r, permissionsOf(r)]));
/** staff may only manage accounts strictly below their own rank; nobody but an OWNER touches an OWNER */
export const outranks = (actorRole, targetRole) => (RANK[actorRole] || 0) > (RANK[targetRole] || 0);
export const isRole = r => ROLES.includes(r);
