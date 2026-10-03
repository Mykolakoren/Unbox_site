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
import { SUBSCRIPTION_PLANS } from './data';

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

/** «Перенести · ещё 2 бесплатно» — коротко: длинная подпись сжимала карточку брони. */
export function lateRescheduleLabel(left: number): string {
  return `Перенести · ещё ${left} бесплатно`;
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

// ── Заморозка по тарифу (владелец 01.10, «как на сайте») ─────────────────
// Зеркало backend services/subscription_perks.freeze_days_*: бюджет дней
// паузы — Регулярный 7, Профи+ 30, остальные 0; делится на несколько пауз.
// Сервер пишет freezeDaysLeft в абонемент; у старого пула без полей считаем
// так же, как сервер (по тарифу; пауза уже была — израсходовано 7 дней).

interface FreezeLike extends SubLike {
  planId?: string;
  freezeCount?: number;
  freezeDaysTotal?: number | null;
  freezeDaysUsed?: number | null;
  freezeDaysLeft?: number | null;
}

const LEGACY_FREEZE_DAYS = 7;
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

/** Бюджет заморозки: всего, израсходовано, осталось (дней). */
export function freezeBudget(sub: FreezeLike | null | undefined): { total: number; used: number; left: number } {
  if (!sub) return { total: 0, used: 0, left: 0 };
  const plan = SUBSCRIPTION_PLANS.find(p => p.id === sub.planId) as { freezeDays?: number } | undefined;
  const total = Math.max(0, num(sub.freezeDaysTotal) ?? plan?.freezeDays ?? 0);
  const used = Math.max(0, num(sub.freezeDaysUsed)
    ?? ((sub.freezeCount || 0) >= 1 && !sub.isFrozen ? LEGACY_FREEZE_DAYS : 0));
  const left = Math.max(0, num(sub.freezeDaysLeft) ?? total - used);
  return { total, used, left };
}

// ── Пауза снимается новой бронью (владелец 03.10) ─────────────────────────
// Зеркало backend subscription_perks.end_freeze: при снятии паузы срок
// абонемента продлевается — новая пауза (с frozenDaysGranted) на min(факт,
// выдано), старая (до 01.10) на весь факт. Если и с продлением срок уже вышел,
// бронь паузу не снимет (сервер: is_active после end_freeze).

interface PauseLike extends SubLike {
  frozenAt?: string | null;
  frozenDaysGranted?: number | null;
}

/** Срок абонемента, если снять паузу сейчас. null — срока нет. */
export function expiryAfterPauseLift(sub: PauseLike | null | undefined, now: Date = new Date()): Date | null {
  if (!sub?.expiryDate) return null;
  const expiry = parseUTC(sub.expiryDate);
  if (isNaN(expiry.getTime())) return null;
  if (!sub.isFrozen) return expiry;
  const at = sub.frozenAt ? parseUTC(sub.frozenAt) : null;
  const factDays = at && !isNaN(at.getTime()) ? Math.max(0, (now.getTime() - at.getTime()) / 86400000) : 0;
  const granted = num(sub.frozenDaysGranted);
  const extendDays = granted !== null ? Math.min(factDays, granted) : factDays;
  return new Date(expiry.getTime() + extendDays * 86400000);
}

/** На паузе, и даже с продлением срок уже вышел — бронь паузу не снимет. */
export function pauseLiftExpired(sub: PauseLike | null | undefined, now: Date = new Date()): boolean {
  if (!sub?.isFrozen || sub.flexible) return false;
  const exp = expiryAfterPauseLift(sub, now);
  return !!exp && now.getTime() > exp.getTime();
}

/** «7 дней», «2,5 дня» — дни паузы. */
export function fmtFreezeDays(days: number): string {
  const d = Math.round((days || 0) * 10) / 10;
  if (Number.isInteger(d)) return ruCountWord(d, ['день', 'дня', 'дней']);
  return `${String(d).replace('.', ',')} дня`;
}

/** Клиент может сам перенести/отменить бронь обычным порядком: подтверждена
 *  и до начала (по Батуми) больше 24 ч. Один расчёт для шахматки и карточек
 *  «Моих броней» — раньше карточка считала время без −4 ч и показывала
 *  обычный «Перенести» в последние 4 часа суток (ревью 01.10). */
export function clientCanModifyBooking(
  b: { status?: string; date: string | Date; startTime?: string | null },
  now: number = Date.now(),
): boolean {
  if (b.status !== 'confirmed' || !b.startTime) return false;
  return hoursUntilBookingStart(b, now) > 24;
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
