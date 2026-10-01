import type { BookingHistoryItem } from '../store/types';

/**
 * «Сколько взять с клиента за эту бронь» — для шахматки (вариант В, владелец 29.09).
 *
 * Админы берут оплату по цене в ячейке и баланс не смотрят. А деньги на сайте
 * живут на балансе: недельная скидка, предоплата и возвраты приходят туда, а
 * брони списываются с баланса за сутки до начала. Поэтому показываем по каждой
 * брони остаток «к оплате», посчитанный из баланса клиента:
 *
 *  • долг (минус на балансе) — это неоплаченные САМЫЕ СВЕЖИЕ списанные брони:
 *    оплаты закрывают брони по порядку, от старых к новым;
 *  • плюс на балансе (недельная скидка, предоплата) заранее покрывает
 *    БЛИЖАЙШИЕ ещё не списанные брони.
 *
 * Итог по клиенту всегда сходится: сумма «к оплате» = долг + ещё не покрытые
 * будущие брони. Только отображение — денег не трогает.
 *
 * Прошедшие брони (решение владельца В2, 01.10). Сервер отдаёт прошедшую
 * confirmed как 'completed' (enrich_booking_status) — раньше она сюда не
 * попадала, у неё не было записи, и в клетке висела цена без «✓», которую
 * читали как «взять». Теперь completed считается как остальные: списанная
 * встаёт в очередь по времени, долг ложится на самые свежие, а у покрытых
 * прошедших — запись с due = 0 («✓ оплачено»). Прошедшая, но не списанная
 * (completed + pending) записи не получает. Долг клиента (минус на балансе)
 * от этого не меняется — меняется только то, на какие брони он разложен.
 */
export interface DueInfo {
    /** Сколько взять за эту бронь, ₾. */
    due: number;
    /** Цена брони, ₾ (то, что спишется/списано). */
    price: number;
    /** true — списана с баланса (за сутки до начала), false — ещё нет. */
    charged: boolean;
}

const MONEY_METHODS = new Set(['balance', 'bonus', '', undefined, null]);
/** Брони, за которые берём деньги: будущие, ждущие подтверждения и прошедшие (В2). */
const DUE_STATUSES = new Set<string>(['confirmed', 'pending_approval', 'completed']);

function startKey(b: BookingHistoryItem): string {
    const raw: any = b.date;
    const d = typeof raw === 'string' ? raw.slice(0, 10) : new Date(raw).toISOString().slice(0, 10);
    return `${d} ${b.startTime || '00:00'}`;
}

export function computeDueByBooking(
    bookings: BookingHistoryItem[],
    balanceOf: (userId: string) => number | null,
): Map<string, DueInfo> {
    const out = new Map<string, DueInfo>();
    const byClient = new Map<string, BookingHistoryItem[]>();
    for (const b of bookings) {
        if (!b || !DUE_STATUSES.has(b.status)) continue;
        // Прошедшая, но так и не списанная (сбой крона) — на балансе её нет. Не даём
        // ей забрать плюс баланса у будущих броней: их суммы остаются прежними (В2).
        if (b.status === 'completed' && b.paymentStatus === 'pending') continue;
        if (!b.userId) continue;
        const price = Number(b.finalPrice || 0);
        // Абонемент без пиковой доплаты, обслуживание, прощённые — к оплате нечего.
        if (price <= 0 || b.paymentStatus === 'waived') continue;
        if (!MONEY_METHODS.has(b.paymentMethod as any) && b.paymentMethod !== 'subscription') continue;
        const list = byClient.get(b.userId) || [];
        list.push(b);
        byClient.set(b.userId, list);
    }
    for (const [userId, list] of byClient) {
        const bal = balanceOf(userId);
        if (bal === null) continue;
        list.sort((a, b) => startKey(a).localeCompare(startKey(b)));
        const charged = list.filter(b => b.paymentStatus !== 'pending' && b.status !== 'pending_approval');
        const pending = list.filter(b => b.paymentStatus === 'pending' || b.status === 'pending_approval');

        let debt = Math.max(0, -bal);
        for (let i = charged.length - 1; i >= 0; i--) {
            const b = charged[i];
            const price = Number(b.finalPrice || 0);
            const due = Math.min(price, debt);
            debt = Math.round((debt - due) * 100) / 100;
            out.set(b.id, { due: Math.round(due * 100) / 100, price, charged: true });
        }
        let credit = Math.max(0, bal);
        for (const b of pending) {
            const price = Number(b.finalPrice || 0);
            const covered = Math.min(price, credit);
            credit = Math.round((credit - covered) * 100) / 100;
            out.set(b.id, { due: Math.round((price - covered) * 100) / 100, price, charged: false });
        }
    }
    return out;
}

export function dueLabel(info: DueInfo | undefined): string {
    if (!info) return '';
    const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace('.', ',');
    if (info.due <= 0) return info.charged ? 'оплачено' : 'покрыто балансом';
    if (info.due < info.price) return `к оплате ${fmt(info.due)} ₾ из ${fmt(info.price)}`;
    return `к оплате ${fmt(info.due)} ₾`;
}
