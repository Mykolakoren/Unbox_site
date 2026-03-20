import type { User } from '../store/types';

const PSY_CRM_PERMISSIONS = ['psy_crm.access', 'psy_crm.clients', 'psy_crm.sessions', 'psy_crm.finances'];
export const ADMIN_ROLES = ['owner', 'senior_admin', 'admin'];

// Default permissions granted automatically by role
const ADMIN_DEFAULT_PERMISSIONS: string[] = [
    'admin.access', 'admin.dashboard',
    'crm.view_clients', 'crm.create_client', 'crm.edit_client', 'crm.manage_status',
    'bookings.view_all', 'bookings.cancel_any', 'bookings.reschedule_any', 'bookings.manage_rerent',
    'subscriptions.manage', 'subscriptions.request_discount',
    'finance.topup_balance', 'finance.set_credit_limit', 'finance.view_reports',
    'content.edit_locations', 'content.edit_rooms', 'content.set_hours',
    'specialists.verify',
];

const SENIOR_ADMIN_EXTRA_PERMISSIONS: string[] = [
    'bookings.override_24h',
    'subscriptions.set_discount',
    'finance.manage_cashbox',
    'content.add_locations', 'content.add_rooms', 'content.edit_pricing',
    'bonuses.grant',
    'admin.assign_roles', 'admin.accept_requests',
];

const SENIOR_ADMIN_DEFAULT_PERMISSIONS = [...ADMIN_DEFAULT_PERMISSIONS, ...SENIOR_ADMIN_EXTRA_PERMISSIONS];

/**
 * Check if user has a specific granular permission.
 * Owner auto-has ALL permissions.
 * Senior_admin auto-has admin defaults + senior extras.
 * Admin auto-has admin defaults.
 * Specialists auto-have all psy_crm.* permissions.
 */
export function hasPermission(user: User | null | undefined, permission: string): boolean {
    if (!user) return false;
    // Owner has all permissions
    if (user.role === 'owner') return true;
    // Senior admin defaults
    if (user.role === 'senior_admin' && SENIOR_ADMIN_DEFAULT_PERMISSIONS.includes(permission)) return true;
    // Admin defaults
    if (user.role === 'admin' && ADMIN_DEFAULT_PERMISSIONS.includes(permission)) return true;
    // Specialist auto-has psy_crm.*
    if (PSY_CRM_PERMISSIONS.includes(permission) && user.role === 'specialist') return true;
    // Explicit permissions in user record (overrides/extras)
    return (user.permissions ?? []).includes(permission);
}
