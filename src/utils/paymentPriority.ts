/**
 * Порядок оплаты брони (владелец 29.09) — зеркало сервера
 * (backend pricing.resolve_payment_method + bookings/routes._resolve_with_bonus):
 *
 *   1) бонусные часы — если их хватает на ВСЮ бронь;
 *   2) иначе абонемент — если он покрывает бронь;
 *   3) иначе баланс.
 *
 * Клиент может сам переключиться между бонусами и абонементом — сервер
 * уважает явный выбор. «Баланс» для сервера значит «реши сам»: пока бонусы
 * или абонемент покрывают бронь, деньги с баланса он не возьмёт. Поэтому
 * экран не должен обещать «Спишется 45 ₾ с баланса», когда уйдут часы.
 *
 * Один источник правды для мобильного оформления и десктопного мастера.
 */
import type { BookingHistoryItem, Subscription } from '../store/types';
import type { Format } from '../types';
import { subscriptionLifecycle } from './subscription';

export type PayMethod = 'balance' | 'subscription' | 'bonus';

/** «1 ч», «1,5 ч» — без хвоста «,0», десятичная запятая. */
export function fmtHours(h: number): string {
    return `${String(Number((h || 0).toFixed(1))).replace('.', ',')} ч`;
}

/** Бонусные часы, которые сервер реально потратит: активные и не истёкшие
 *  (bonus_service.available_free_hours). Тип 'free_hour' — как в бэкенде,
 *  camelCase — на случай легаси-записей. */
export function activeBonusHours(
    bonuses: Array<{ status: string; type: string; quantity?: number; expiresAt?: string | null }>,
    now: Date = new Date(),
): number {
    return bonuses
        .filter(b => b.status === 'active' && (b.type === 'free_hour' || b.type === 'freeHour'))
        .filter(b => !(b.expiresAt && new Date(b.expiresAt).getTime() < now.getTime()))
        .reduce((s, b) => s + (b.quantity || 0), 0);
}

/** Понедельник недели (локальная дата yyyy-mm-dd) — как package_week у пакета. */
function mondayKey(d: Date): string {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export interface SubscriptionHours {
    /** Абонемент может покрыть бронь: есть, не на паузе, не истёк, формат входит. */
    ok: boolean;
    /** Почему не может (для подписи). */
    reason: string;
    /** Остаток пула — ровно то, что видит сервер при создании брони. */
    remaining: number;
    /** Пул, из которого бронь будет оплачена за сутки до начала (у недельного
     *  пакета для будущей недели — её полный объём). */
    pool: number;
    /** Часы будущих броней «с абонемента», которые ещё не списаны
     *  (спишутся за сутки до начала). */
    reserved: number;
    /** Свободно для новой брони: пул минус уже забронированное. */
    free: number;
}

/**
 * Часы абонемента, уже обещанные будущим броням: бронь «с абонемента» ещё не
 * списана (payment_status=pending) — часы снимутся за сутки до начала.
 * У недельного пакета считаем только брони недели `weekOf`: пул каждой недели
 * выдаётся заново.
 */
export function reservedSubscriptionHours(
    sub: Subscription | null | undefined,
    bookings: BookingHistoryItem[],
    ownerEmail: string | null | undefined,
    opts: { weekOf?: Date; excludeBookingId?: string | null } = {},
): number {
    if (!sub || !ownerEmail) return 0;
    const weekly = !!sub.weeklyPackage;
    const week = mondayKey(opts.weekOf ?? new Date());
    return (bookings || [])
        .filter(b => b.userId === ownerEmail)
        .filter(b => b.id !== opts.excludeBookingId)
        .filter(b => b.paymentMethod === 'subscription' && b.paymentStatus === 'pending')
        .filter(b => b.status === 'confirmed' || b.status === 'pending_approval' || b.status === 'completed')
        .filter(b => !weekly || mondayKey(new Date(b.date as any)) === week)
        .reduce((s, b) => s + (Number(b.hoursDeducted) || (b.duration ?? 60) / 60), 0);
}

/**
 * Честный остаток абонемента. Сервер списывает часы за сутки до встречи, а до
 * того бронь висит «не списано» — и «Осталось 6 ч» обманывало: часть из них
 * уже обещана будущим броням (G4-client-mobile-M1). Как и когда часы
 * списываются, здесь не меняется — это только показ и выбор по умолчанию.
 *
 * Недельный пакет: пул выдаётся заново каждую неделю, поэтому считаем только
 * брони той же недели, а для будущей недели берём полный недельный объём.
 */
export function subscriptionHours(
    sub: Subscription | null | undefined,
    opts: {
        format: Format;
        bookingDate: Date;
        bookings: BookingHistoryItem[];
        ownerEmail?: string | null;
        excludeBookingId?: string | null;
        now?: Date;
    },
): SubscriptionHours {
    const empty = { remaining: 0, pool: 0, reserved: 0, free: 0 };
    if (!sub) return { ok: false, reason: 'Нет абонемента', ...empty };
    const life = subscriptionLifecycle(sub as any, opts.now);
    if (life === 'frozen') return { ok: false, reason: 'Абонемент заморожен', ...empty };
    if (life === 'completed') return { ok: false, reason: 'Срок абонемента закончился', ...empty };
    const formats = sub.includedFormats || ['individual'];
    const remaining = Math.max(0, Number(sub.remainingHours) || 0);
    if (!formats.includes(opts.format)) {
        return {
            ok: false,
            reason: `Абонемент только для ${formats.includes('individual') ? 'индивидуальной' : 'групповой'} работы`,
            remaining, pool: remaining, reserved: 0, free: remaining,
        };
    }

    const weekly = !!sub.weeklyPackage;
    const week = mondayKey(opts.bookingDate);
    let pool = remaining;
    if (weekly && sub.packageWeek && week > sub.packageWeek) {
        pool = Number(sub.weeklyHours) || Number(sub.totalHours) || remaining;
    }

    const reserved = reservedSubscriptionHours(sub, opts.bookings, opts.ownerEmail, {
        weekOf: opts.bookingDate,
        excludeBookingId: opts.excludeBookingId,
    });

    return {
        ok: true,
        reason: '',
        remaining,
        pool,
        reserved,
        free: Math.max(0, pool - reserved),
    };
}

/** Подпись остатка: «Осталось 6 ч» или «Свободно 2 ч из 6 — 4 ч уже в бронях». */
export function subscriptionHoursLabel(s: SubscriptionHours): string {
    if (s.reserved > 0.01) {
        return `Свободно ${Number(s.free.toFixed(1))} из ${fmtHours(s.pool)} — ${fmtHours(s.reserved)} уже в бронях`;
    }
    return `Осталось ${fmtHours(s.pool)}`;
}

export interface PaymentPlan {
    hours: number;
    bonusHours: number;
    /** Бронь и так ничего не стоит (персональные 100 %) — бонус на неё
     *  сервер не тратит, и мы его не предлагаем. */
    free: boolean;
    /** Бонусов хватает на всю бронь (частичный бонус не предлагаем). */
    bonusCovers: boolean;
    sub: SubscriptionHours;
    /** Сервер возьмёт бронь абонементом (его проверка — по остатку пула). */
    subCovers: boolean;
    /** Хватает и свободных часов — тех, что не обещаны другим броням. */
    subFreeCovers: boolean;
    /** Что выберет сервер сам: бонус → абонемент → баланс. */
    auto: PayMethod;
}

export function paymentPlan(opts: {
    hours: number;
    bonusHours: number;
    sub: SubscriptionHours;
    /** Серия: бонус как явный выбор не предлагаем (сервер сам потратит его
     *  на первые даты, если хватит на встречу целиком). */
    isSeries?: boolean;
    /** Цена брони деньгами (без абонемента). 0 — бронь бесплатна. */
    moneyPrice?: number;
}): PaymentPlan {
    const { hours, bonusHours, sub } = opts;
    const subCovers = sub.ok && hours > 0 && sub.remaining >= hours - 0.01;
    // Как на сервере (pricing.resolve_payment_method): бонус не тратится на
    // бронь, которая ничего не стоит, — если её не покрывает абонемент.
    const free = !subCovers && opts.moneyPrice !== undefined && opts.moneyPrice <= 0;
    const bonusCovers = !opts.isSeries && !free && hours > 0 && bonusHours > 0 && bonusHours >= hours - 0.01;
    const subFreeCovers = subCovers && sub.free >= hours - 0.01;
    const auto: PayMethod = bonusCovers ? 'bonus' : subCovers ? 'subscription' : 'balance';
    return { hours, bonusHours, free, bonusCovers, sub, subCovers, subFreeCovers, auto };
}

/** Можно ли выбрать способ. «Баланс» разовой брони доступен, только когда
 *  ни бонусы, ни абонемент её не покрывают — иначе сервер всё равно возьмёт
 *  их. В серии «Баланс» = «реши сам»: сначала бонусы и абонемент, потом деньги. */
export function isSelectable(method: PayMethod, plan: PaymentPlan, isSeries = false): boolean {
    if (method === 'bonus') return plan.bonusCovers;
    if (method === 'subscription') return plan.subCovers;
    return isSeries || (!plan.bonusCovers && !plan.subCovers);
}

/** Способ, который уйдёт на сервер: выбранный, если он доступен, иначе тот,
 *  что сервер выберет сам. Для серии — абонемент или «реши сам» (balance). */
export function resolveFinalMethod(selected: PayMethod | undefined, plan: PaymentPlan, isSeries = false): PayMethod {
    if (isSeries) return selected === 'subscription' && plan.subCovers ? 'subscription' : 'balance';
    if (selected && isSelectable(selected, plan)) return selected;
    return plan.auto;
}

/** Почему «Баланс» сейчас недоступен (подпись под вариантом). */
export function balanceLockedReason(plan: PaymentPlan): string {
    if (plan.bonusCovers) return 'Сначала тратятся бонусные часы';
    if (plan.subCovers) return 'Сначала тратятся часы абонемента';
    return '';
}
