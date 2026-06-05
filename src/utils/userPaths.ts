/**
 * Smart paths по роли — куда вести юзера в зависимости от его «основного
 * рабочего стола». После архитектурного коллапса /dashboard и /crm
 * (2026-06-05) специалист живёт в /crm, админ/владелец — в /admin, чистый
 * клиент — в /dashboard. Все «Мои бронирования», «Профиль» и т.д. должны
 * вести в шелл, где юзер уже находится, а не дёргать его между шеллами.
 *
 * Использование:
 *   const path = getMyBookingsPath(currentUser);
 *   navigate(path);
 *   // или
 *   <Link to={path}>Мои брони</Link>
 */

type RoleLike = {
    role?: string | null;
    isAdmin?: boolean | null;
} | null | undefined;

function isAdmin(user: RoleLike): boolean {
    if (!user) return false;
    return user.role === 'owner'
        || user.role === 'senior_admin'
        || user.role === 'admin'
        || !!user.isAdmin;
}

function isSpecialist(user: RoleLike): boolean {
    if (!user) return false;
    return user.role === 'specialist';
}

/** «Мои бронирования» — куда вести в зависимости от роли. */
export function getMyBookingsPath(user: RoleLike): string {
    if (isAdmin(user)) return '/admin/bookings';
    if (isSpecialist(user)) return '/crm/bookings';
    return '/dashboard/bookings';
}

/** Личный профиль (логин, пароль, контакты). */
export function getMyAccountPath(user: RoleLike): string {
    if (isAdmin(user)) return '/admin/account';
    if (isSpecialist(user)) return '/crm/account';
    return '/dashboard/profile';
}

/** Абонементы. */
export function getMySubscriptionPath(user: RoleLike): string {
    if (isAdmin(user)) return '/admin/subscription';
    if (isSpecialist(user)) return '/crm/subscription';
    return '/subscriptions';
}

/** Бонусы. */
export function getMyBonusesPath(user: RoleLike): string {
    if (isAdmin(user)) return '/admin/bonuses';
    if (isSpecialist(user)) return '/crm/bonuses';
    return '/dashboard/bonuses';
}

/** Слежу за слотами. */
export function getMyWaitlistPath(user: RoleLike): string {
    if (isAdmin(user)) return '/admin/my-waitlist';
    if (isSpecialist(user)) return '/crm/waitlist';
    return '/dashboard/waitlist';
}

/** Главный «домашний» путь — куда отправлять «На кабинет» / логин-эхо. */
export function getHomePath(user: RoleLike): string {
    if (isAdmin(user)) return '/admin';
    if (isSpecialist(user)) return '/crm';
    return '/dashboard';
}
