import type { User } from '../store/types';

const CRM_PERMISSIONS = ['crm.access', 'crm.clients', 'crm.sessions', 'crm.finances'];
const ADMIN_ROLES = ['owner', 'senior_admin', 'admin'];

/**
 * Check if user has a specific granular permission.
 * Specialists auto-have all crm.* permissions.
 * Admins/owners auto-have admin.access.
 */
export function hasPermission(user: User | null | undefined, permission: string): boolean {
    if (!user) return false;
    if (CRM_PERMISSIONS.includes(permission) && user.role === 'specialist') return true;
    if (permission === 'admin.access' && user.role && ADMIN_ROLES.includes(user.role)) return true;
    return (user.permissions ?? []).includes(permission);
}
