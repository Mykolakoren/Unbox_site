/**
 * Порядок оплаты брони (владелец 29.09) — зеркало сервера
 * (backend pricing.resolve_payment_method + bookings/routes._resolve_with_bonus):
 *
 *   1) бонусные часы — если их хватает на ВСЮ бронь;
 *   2) иначе абонемент — если он покрывает бронь;
 *   3) иначе баланс.
 *
 * Приветственный час без абонемента (владелец 01.10): если действующего
 * абонемента нет, бонус тратится сам и ЧАСТИЧНО — «1 ч бонусом + 20 ₾».
 * При действующем абонементе — только если покрывает бронь целиком.
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
import { extraAvailable, extraKindLabel, extraPool, type ResourceKind } from './subscriptionHours';

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
    /** Абонемент действует (есть, не на паузе, не истёк) — формат и остаток
     *  не важны. Как subscription_pool.is_active на сервере: при действующем
     *  абонементе бонус частично сам не тратится. */
    active: boolean;
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
    /** Из `remaining`/`pool` — часы доп. пула (капсула / «индивидуально»),
     *  которые подходят этой брони (владелец 01.10; сервер тратит их первыми). */
    extra: number;
    /** Название доп. пула для подписи: «Капсула» / «Индивидуально». */
    extraLabel?: string;
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
        /** Капсула или кабинет (utils/subscriptionHours.cartResourceKind). Не
         *  задан / корзина смешанная — доп. пул не учитываем, как и сервер. */
        resourceKind?: ResourceKind;
    },
): SubscriptionHours {
    const empty = { remaining: 0, pool: 0, reserved: 0, free: 0, extra: 0 };
    if (!sub) return { ok: false, active: false, reason: 'Нет абонемента', ...empty };
    const life = subscriptionLifecycle(sub as any, opts.now);
    if (life === 'frozen') return { ok: false, active: false, reason: 'Абонемент заморожен', ...empty };
    if (life === 'completed') return { ok: false, active: false, reason: 'Срок абонемента закончился', ...empty };
    const formats = sub.includedFormats || ['individual'];
    // Доп. пул (зеркало pricing/subscription_pool.plan_split): часы капсулы —
    // на капсулу, «4 ч индивидуально» — на индивидуальную бронь в кабинете. Они
    // идут первыми и годятся, даже когда формат не входит в основной пул.
    const extra = extraAvailable(sub, opts.resourceKind, opts.format);
    const extraLabel = extra > 0 ? extraKindLabel(extraPool(sub)!.kind) : undefined;
    const mainRemaining = Math.max(0, Number(sub.remainingHours) || 0);
    if (!formats.includes(opts.format)) {
        if (extra > 0) {
            // Формат не входит в основной пул — платить может только доп. пул.
            return { ok: true, active: true, reason: '', remaining: extra, pool: extra, reserved: 0, free: extra, extra, extraLabel };
        }
        return {
            ok: false,
            active: true,
            reason: `Абонемент только для ${formats.includes('individual') ? 'индивидуальной' : 'групповой'} работы`,
            remaining: mainRemaining, pool: mainRemaining, reserved: 0, free: mainRemaining, extra: 0,
        };
    }
    const remaining = mainRemaining + extra;

    const weekly = !!sub.weeklyPackage;
    const week = mondayKey(opts.bookingDate);
    let pool = mainRemaining;
    if (weekly && sub.packageWeek && week > sub.packageWeek) {
        pool = Number(sub.weeklyHours) || Number(sub.totalHours) || mainRemaining;
    }

    const reserved = reservedSubscriptionHours(sub, opts.bookings, opts.ownerEmail, {
        weekOf: opts.bookingDate,
        excludeBookingId: opts.excludeBookingId,
    });

    return {
        ok: true,
        active: true,
        reason: '',
        remaining,
        pool: pool + extra,
        reserved,
        free: Math.max(0, pool + extra - reserved),
        extra,
        extraLabel,
    };
}

/** Подпись остатка: «Осталось 6 ч» или «Свободно 2 ч из 6 — 4 ч уже в бронях». */
export function subscriptionHoursLabel(s: SubscriptionHours): string {
    // «из них 1 ч капсулы» — часы доп. пула идут первыми (владелец 01.10).
    const x = s.extra > 0.01 ? ` (из них ${fmtHours(s.extra)} — ${(s.extraLabel || '').toLowerCase()})` : '';
    if (s.reserved > 0.01) {
        return `Свободно ${Number(s.free.toFixed(1))} из ${fmtHours(s.pool)}${x} — ${fmtHours(s.reserved)} уже в бронях`;
    }
    return `Осталось ${fmtHours(s.pool)}${x}`;
}

export interface PaymentPlan {
    hours: number;
    bonusHours: number;
    /** Бронь и так ничего не стоит (персональные 100 %) — бонус на неё
     *  сервер не тратит, и мы его не предлагаем. */
    free: boolean;
    /** Бонусов хватает на всю бронь. */
    bonusCovers: boolean;
    /** Бонусов меньше, чем бронь, и действующего абонемента нет — сервер сам
     *  потратит их частично: бонус-часы бесплатно, остальное деньгами. */
    bonusPartial: boolean;
    /** Сколько часов брони покроет бонус (0, если бонус не пойдёт). */
    bonusCovered: number;
    /** Сколько деньгами при оплате бонусом: непокрытая доля цены (0 при
     *  полном покрытии). Та же формула, что _resolve_with_bonus. */
    bonusMoney: number;
    /** Несколько слотов и частичный бонус: сумма — оценка (≈). Сервер идёт по
     *  слотам (бонус целиком закрывает первые, остальные — деньгами) и после
     *  создания пересчитывает цепочку смежных часов (consecutive_pricing) —
     *  точная сумма видна после брони. */
    bonusApprox: boolean;
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
    /** Слоты корзины в порядке отправки на сервер (часы и цена деньгами).
     *  Бонус тратится по слотам так же, как на сервере. */
    items?: Array<{ hours: number; price: number }>;
}): PaymentPlan {
    const { hours, bonusHours, sub } = opts;
    const subCovers = sub.ok && hours > 0 && sub.remaining >= hours - 0.01;
    // Как на сервере (pricing.resolve_payment_method): бонус не тратится на
    // бронь, которая ничего не стоит, — если её не покрывает абонемент.
    const free = !subCovers && opts.moneyPrice !== undefined && opts.moneyPrice <= 0;
    const bonusCovers = !opts.isSeries && !free && hours > 0 && bonusHours > 0 && bonusHours >= hours - 0.01;
    // Как на сервере (владелец 01.10): без действующего абонемента бонус идёт
    // и частично, если бронь чего-то стоит. Серию считает «примерка» сервера.
    const moneyPrice = Math.max(0, opts.moneyPrice ?? 0);
    const bonusPartial = !opts.isSeries && !bonusCovers && !sub.active && !free
        && hours > 0 && bonusHours > 0.001 && moneyPrice > 0;
    const bonusCovered = bonusCovers ? hours : bonusPartial ? Math.min(bonusHours, hours) : 0;
    const multi = (opts.items?.length ?? 0) > 1;
    const bonusMoney = !bonusPartial
        ? 0
        : multi
            ? bonusBySlots(opts.items!, bonusHours).money
            : Math.round(moneyPrice * ((hours - bonusCovered) / hours) * 100) / 100;
    const bonusApprox = bonusPartial && multi;
    const subFreeCovers = subCovers && sub.free >= hours - 0.01;
    const auto: PayMethod = bonusCovers ? 'bonus' : subCovers ? 'subscription' : bonusPartial ? 'bonus' : 'balance';
    return { hours, bonusHours, free, bonusCovers, bonusPartial, bonusCovered, bonusMoney, bonusApprox, sub, subCovers, subFreeCovers, auto };
}

/** Бонус по слотам, как сервер (multi-slot / по одной брони подряд): слот,
 *  который бонус покрывает целиком, — бесплатно; слот, где бонуса меньше, —
 *  бонус-часы бесплатно, остаток его цены деньгами; дальше — деньгами. */
export function bonusBySlots(
    items: Array<{ hours: number; price: number }>,
    bonusHours: number,
): { covered: number; money: number } {
    let left = Math.max(0, bonusHours);
    let covered = 0;
    let money = 0;
    for (const it of items) {
        const h = Math.max(0, it.hours);
        const price = Math.max(0, it.price);
        const c = h > 0 ? Math.min(left, h) : 0;
        left -= c;
        covered += c;
        money += h > 0 ? price * ((h - c) / h) : price;
    }
    return { covered: Math.round(covered * 100) / 100, money: Math.round(money * 100) / 100 };
}

/** «20 ₾» или «≈ 20 ₾» (мультислот с частичным бонусом — точная после брони). */
export function bonusMoneyText(plan: PaymentPlan, gel: (n: number) => string): string {
    return `${plan.bonusApprox ? '≈ ' : ''}${gel(plan.bonusMoney)}`;
}

/** Можно ли выбрать способ. «Баланс» разовой брони доступен, только когда
 *  ни бонусы, ни абонемент её не покрывают — иначе сервер всё равно возьмёт
 *  их. В серии «Баланс» = «реши сам»: сначала бонусы и абонемент, потом деньги. */
export function isSelectable(method: PayMethod, plan: PaymentPlan, isSeries = false): boolean {
    if (method === 'bonus') return plan.bonusCovers || plan.bonusPartial;
    if (method === 'subscription') return plan.subCovers;
    return isSeries || (!plan.bonusCovers && !plan.subCovers && !plan.bonusPartial);
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
    if (plan.bonusCovers || plan.bonusPartial) return 'Сначала тратятся бонусные часы';
    if (plan.subCovers) return 'Сначала тратятся часы абонемента';
    return '';
}

/** Деньгами при оплате бонусом (частичный бонус) — для итога, проверки
 *  баланса и подписи. 0 — бронь целиком бонусом. */
export function bonusMoneyDue(plan: PaymentPlan): number {
    return plan.bonusPartial ? plan.bonusMoney : 0;
}
