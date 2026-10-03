import { toast } from 'sonner';

/**
 * 03.10 (решение владельца): бронь клиента, чей абонемент на паузе, снимает
 * паузу, если пошла часами абонемента (сервер: bookings/routes.py,
 * _lift_pause_for_booking). Мастер предупреждает заранее строкой
 * pauseLiftNote; по факту брони — этот короткий тост.
 *
 * Звать только для СВОЕЙ брони (не «за клиента»): wasFrozen — снимок до
 * брони, after — currentUser после fetchCurrentUser. Нет after (сессия
 * истекла, 401 обнулил пользователя) — молчим, а не «пауза снята».
 */
export const PAUSE_LIFTED_TOAST = 'Пауза абонемента снята — неиспользованные дни паузы сохранились';

export const isFrozenSub = (user: unknown): boolean =>
    !!(user as { subscription?: { isFrozen?: boolean } } | null | undefined)?.subscription?.isFrozen;

export function notifyIfPauseLifted(wasFrozen: boolean, after: unknown): void {
    if (wasFrozen && after && !isFrozenSub(after)) toast.success(PAUSE_LIFTED_TOAST);
}
