/**
 * Статус абонемента для отображения — зеркалит backend
 * subscription_pool.lifecycle_status.
 *
 * Единый источник правды на фронте: и админская карточка, и клиентская
 * должны одинаково понимать «активен / на паузе / завершён», иначе UI
 * покажет истёкший абонемент как активный (ровно это и было до 2026-07-15).
 *
 * Реальный денежный гейт живёт на бэкенде (is_active). Здесь — только показ.
 */

import { ruCountWord } from './plural';
import { parseUTC } from './dateUtils';

export type SubLifecycle = 'active' | 'frozen' | 'completed' | 'none';

interface SubLike {
  isFrozen?: boolean;
  flexible?: boolean;
  expiryDate?: string;
  status?: string;
}

export function subscriptionLifecycle(
  sub: SubLike | null | undefined,
  now: Date = new Date(),
): SubLifecycle {
  if (!sub) return 'none';
  if (sub.isFrozen) return 'frozen';
  // Особые условия (Светлана) — срок не действует, всегда активен.
  if (sub.flexible) return 'active';
  if (sub.expiryDate) {
    const expiry = new Date(sub.expiryDate);
    if (!isNaN(expiry.getTime()) && now > expiry) return 'completed';
  }
  return 'active';
}

// ── Переносы позже суток (владелец 01.10) ────────────────────────────────
// Зеркало backend services/subscription_perks.late_reschedule_refusal:
// клиент переносит бронь позже суток (но не позже чем за 3 ч) бесплатным
// переносом абонемента — Тёплый 1, Регулярный 2, Профи+ 3. Абонемент должен
// действовать; новую дату (в пределах срока абонемента) проверит сервер.

/** Позже этого бесплатный перенос абонемента не работает. */
export const LATE_RESCHEDULE_MIN_HOURS = 3;

/** Сколько бесплатных переносов можно потратить на бронь, до начала которой
 *  `hoursUntil` ч. 0 — перенести позже суток нельзя (или ещё рано: ≥ 24 ч —
 *  обычный перенос, счётчик не тратится). */
export function lateRescheduleLeft(
  sub: (SubLike & { freeReschedules?: number }) | null | undefined,
  hoursUntil: number,
  now: Date = new Date(),
): number {
  if (!sub || !Number.isFinite(hoursUntil)) return 0;
  if (hoursUntil >= 24 || hoursUntil < LATE_RESCHEDULE_MIN_HOURS) return 0;
  if (subscriptionLifecycle(sub, now) !== 'active') return 0;
  return Math.max(0, Math.floor(Number(sub.freeReschedules) || 0));
}

/** «Перенести (осталось 2 бесплатных переноса)». */
export function lateRescheduleLabel(left: number): string {
  return `Перенести (осталось ${ruCountWord(left, ['бесплатный перенос', 'бесплатных переноса', 'бесплатных переносов'])})`;
}

/** Часы до начала брони: дата — день по Тбилиси, время — по Тбилиси (UTC+4). */
export function hoursUntilBookingStart(
  b: { date: string | Date; startTime?: string | null },
  now: number = Date.now(),
): number {
  if (!b.startTime) return Infinity;
  const [h, m] = b.startTime.split(':').map(Number);
  const d = parseUTC(b.date);
  if (isNaN(d.getTime())) return Infinity;
  const startUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - 4, m, 0, 0);
  return (startUTC - now) / 3600000;
}

/** Плашка статуса: подпись + tailwind-классы. */
export function subscriptionBadge(sub: SubLike | null | undefined): {
  label: string;
  cls: string;
} {
  switch (subscriptionLifecycle(sub)) {
    case 'frozen':
      return { label: 'Заморожен', cls: 'bg-blue-200 text-blue-800' };
    case 'completed':
      return { label: 'Завершён', cls: 'bg-gray-200 text-gray-600' };
    default:
      return { label: 'Активен', cls: 'bg-green-200 text-green-800' };
  }
}
