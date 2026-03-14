import type { User } from '../store/types';

const PSY_CRM_PERMISSIONS = ['psy_crm.access', 'psy_crm.clients', 'psy_crm.sessions', 'psy_crm.finances'];
const ADMIN_ROLES = ['owner', 'senior_admin', 'admin'];

/**
 * Check if user has a specific granular permission.
 * Specialists auto-have all psy_crm.* permissions.
 * Admins/owners auto-have admin.access.
 */
export function hasPermission(user: User | null | undefined, permission: string): boolean {
    if (!user) return false;
    if (PSY_CRM_PERMISSIONS.includes(permission) && user.role === 'specialist') return true;
    if (permission === 'admin.access' && user.role && ADMIN_ROLES.includes(user.role)) return true;
    return (user.permissions ?? []).includes(permission);
}
