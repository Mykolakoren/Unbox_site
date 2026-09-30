import type { User } from '../../store/types';
import { ADMIN_ROLES, hasPermission } from '../../utils/permissions';

/**
 * Кому открыта Psy-CRM (волна 2, X2-ia-navigation-M3).
 *
 * То же правило, что на сервере (backend deps.require_specialist):
 * роли specialist / owner / senior_admin — всегда; остальным — только с
 * правом psy_crm.access. Раньше телефон пускал в CRM любого админа
 * (role 'admin' или legacy isAdmin), а сервер отвечал ему 403 — человек
 * видел пустую «Сегодня» и не понимал, что сломалось.
 */
const PSY_CRM_ROLES = ['specialist', 'owner', 'senior_admin'];

export function canUsePsyCrm(user: User | null | undefined): boolean {
    if (!user) return false;
    if (PSY_CRM_ROLES.includes((user.role || '').toLowerCase())) return true;
    return hasPermission(user, 'psy_crm.access');
}

/** Админ для правил брони — как на сервере (core/permissions.ADMIN_ROLES):
 *  owner / senior_admin / admin. Им можно отменять и переносить бронь
 *  меньше чем за 24 часа; клиенту и специалисту — нет. */
export function isBookingAdmin(user: Pick<User, 'role'> | null | undefined): boolean {
    return !!user && ADMIN_ROLES.includes((user.role || '').toLowerCase());
}
