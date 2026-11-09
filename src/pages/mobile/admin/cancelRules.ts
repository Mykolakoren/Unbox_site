/**
 * Отмена брони в мобильной админке — правила подписи (ревью 09.11, admin-ux №8).
 *
 * Без импортов: сторож (backend/tests/guard_admin_wave1_2026_11.py) гоняет файл
 * через node --experimental-strip-types. Только подписи — считает и возвращает
 * деньги сервер (_refund_booking_to_owner в bookings/routes.py).
 */
export interface CancelBookingInput {
    status: string;
    date?: unknown;
    startTime?: string | null;
    paymentMethod?: string | null;
    paymentStatus?: string | null;
    finalPrice?: number | null;
    chargeAmount?: number | null;
    hoursDeducted?: number | null;
}

const NAIVE_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** Часов до начала брони (день и «HH:MM» — по Тбилиси, UTC+4). Нет данных — null. */
export function hoursUntilStart(b: CancelBookingInput, now: number = Date.now()): number | null {
    // Дата строкой из базы — день по Тбилиси как есть; объект Date — переводим в день по Тбилиси.
    const raw = b.date instanceof Date
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(b.date)
        : String(b.date ?? '');
    const d = NAIVE_DAY.exec(raw);
    const m = /^(\d{1,2}):(\d{2})/.exec(b.startTime || '');
    if (!d || !m) return null;
    const startUtc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(m[1]) - 4, Number(m[2]));
    return (startUtc - now) / 3_600_000;
}

/** «2 ч», «1,5 ч». */
function hoursText(h: number): string {
    const r = Math.round(h * 100) / 100;
    return `${String(r).replace('.', ',')} ч`;
}

/**
 * Что вернётся клиенту при отмене с долей pct (0..1) — те же правила, что у
 * сервера: заявка «Ждёт подтверждения» — денег не брали; ещё не списанная
 * (pending / waived) — деньги не возвращаются, нечего; бонусные часы
 * возвращаются всегда той же долей; абонемент с вычтенными часами — часы × доля
 * (+ пиковая надбавка деньгами); остальное — фактически списанное
 * (charge_amount, иначе цена) × доля. Суммы пишет fmt (на экране — formatGel).
 */
export function refundPreview(b: CancelBookingInput, pct: number, fmt: (n: number) => string): string {
    if (b.status === 'pending_approval') return 'денег ещё не брали — возвращать нечего';
    if (pct <= 0) return 'без возврата';
    const notCharged = b.paymentStatus === 'pending' || b.paymentStatus === 'waived';
    const hd = Number(b.hoursDeducted ?? 0);
    const parts: string[] = [];
    if (b.paymentMethod === 'bonus' && hd > 0) parts.push(`${hoursText(hd * pct)} бонусных`);
    if (!notCharged) {
        let money = 0;
        if (b.paymentMethod === 'subscription' && hd > 0) {
            parts.push(`${hoursText(hd * pct)} абонемента`);
            money = Number(b.finalPrice ?? 0) * pct;
        } else {
            money = Number(b.chargeAmount ?? b.finalPrice ?? 0) * pct;
        }
        money = Math.round(money * 100) / 100;
        if (money >= 0.01) parts.push(fmt(money));
    }
    if (parts.length === 0) {
        return notCharged ? 'ещё не списано — с клиента ничего не спишется' : 'возвращать нечего';
    }
    return `вернём ${parts.join(' и ')}`;
}
