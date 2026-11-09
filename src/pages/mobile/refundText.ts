import type { BookingHistoryItem } from '../../store/types';
import { formatGel } from '../../utils/format';
import { fmtHours } from '../../utils/paymentPriority';

/**
 * Честные подписи о возвратах (ревью клиентской части 09.11, №2, №7, №10).
 *
 * Раньше под «Пересдать» всегда было «вернём 50 % на баланс», у отменённой
 * брони висело зелёное «Оплачено», а причина отмены шла сырым текстом
 * сервера («User cancelled», «Auto-cancelled: slot re-rented… 10.00GEL»).
 *
 * Правила — зеркало сервера (bookings/routes._refund_booking_to_owner):
 *   • бонусные часы тратятся при создании брони — возвращаются той же долей
 *     всегда, даже если деньги ещё не списаны;
 *   • бронь ещё не списана (payment_status pending / waived) — денег и часов
 *     абонемента не брали, возвращать нечего: за это время просто не спишем;
 *   • абонемент с часами — возвращаются ЧАСЫ, а пиковая надбавка (final_price
 *     такой брони) — деньгами на баланс;
 *   • остальное — деньги на баланс от фактически списанного (charge_amount).
 * Денежную логику здесь не меняем — только описываем её словами.
 */

type Parts = { bonusH: number; subH: number; money: number };

/** Что вернётся владельцу при возврате доли `pct` (0..1) — без учёта текста причины. */
function refundParts(b: BookingHistoryItem, pct: number): { parts: Parts; notCharged: boolean } {
    const method = b.paymentMethod;
    const hours = Number(b.hoursDeducted) || 0;
    const parts: Parts = { bonusH: 0, subH: 0, money: 0 };
    if (method === 'bonus' && hours > 0) parts.bonusH = round2(hours * pct);
    const notCharged = b.paymentStatus === 'pending' || b.paymentStatus === 'waived';
    if (notCharged) return { parts, notCharged };
    if (method === 'subscription' && hours > 0) {
        parts.subH = round2(hours * pct);
        // У абонементной брони final_price — это деньги сверх часов (пиковая надбавка, допуслуги).
        parts.money = refundMoney(Number(b.finalPrice) || 0, pct);
    } else {
        const charged = b.chargeAmount != null ? Number(b.chargeAmount) : Number(b.finalPrice) || 0;
        parts.money = refundMoney(charged, pct);
    }
    return { parts, notCharged };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * Денежный возврат долей `pct` — зеркало сервера (_partial_refund_gel, владелец
 * 09.11): частичный — вверх до 50 тетри (50 % от 17,5 = 9, а не 8,75), но не
 * больше списанного; полный — ровно списанное.
 */
export function refundMoney(charged: number, pct: number): number {
    const full = Math.max(0, charged);
    if (pct >= 1 || full <= 0) return round2(full * Math.min(pct, 1));
    if (pct <= 0) return 0;
    const raw = round2(full * pct);
    return round2(Math.min(Math.ceil(raw * 2 - 1e-9) / 2, full));
}

function partsText(p: Parts): string[] {
    const out: string[] = [];
    if (p.bonusH > 0.001) out.push(`${fmtHours(p.bonusH)} бонуса`);
    if (p.subH > 0.001) out.push(`${fmtHours(p.subH)} в абонемент`);
    if (p.money >= 0.01) out.push(`${formatGel(p.money)} на баланс`);
    return out;
}

/** Подпись под «Пересдать»: что вернём, если время займут — по способу оплаты брони. */
export function reRentCaption(b: BookingHistoryItem): string {
    const { parts, notCharged } = refundParts(b, 0.5);
    const txt = partsText(parts);
    if (txt.length > 0) return `Если её займут — вернём 50 %: ${txt.join(' и ')}`;
    if (notCharged) return 'Если её займут до списания — за это время ничего не спишем';
    return 'Если её займут — время освободится, возвращать нечего';
}

/** Текст для окна «Пересдать бронь?» — то же правило, развёрнуто. */
export function reRentConfirmBody(b: BookingHistoryItem): string {
    const { parts, notCharged } = refundParts(b, 0.5);
    const txt = partsText(parts);
    const what = txt.length > 0
        ? `Если его заберут — вернём 50 % стоимости занятого времени: ${txt.join(' и ')}.`
        : notCharged
            ? 'Если его заберут до списания — за занятое время ничего не спишем.'
            : 'Если его заберут — время просто освободится.';
    return `Слот появится у других как свободный. ${what} Займут часть — вернём за эту часть. Что не заберут — останется за вами.`;
}

/** Тост после постановки на пересдачу. */
export function reRentToast(b: BookingHistoryItem): string {
    const { parts, notCharged } = refundParts(b, 0.5);
    const txt = partsText(parts);
    if (txt.length > 0) return `Бронь на пересдаче. Если её займут, вернём ${txt.join(' и ')}.`;
    return notCharged ? 'Бронь на пересдаче. Если её займут до списания, за это время ничего не спишем.' : 'Бронь на пересдаче.';
}

// Сервер пишет причину пересдачи по-старому — ищем и английское, и оба русских корня.
const RE_RENT_RE = /re-rent|пере(?:сда|аренд)/i;

function isReRentReason(reason: string): boolean {
    return RE_RENT_RE.test(reason);
}

/** Доля возврата по тексту причины, который пишет сервер. */
function refundShare(b: BookingHistoryItem): number {
    const reason = b.cancellationReason || '';
    if (isReRentReason(reason)) {
        const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(reason);
        return m ? parseFloat(m[1].replace(',', '.')) / 100 : 0.5;
    }
    const m = /\((\d+(?:[.,]\d+)?)\s*%\s*возврат\)/i.exec(reason);
    if (m) return parseFloat(m[1].replace(',', '.')) / 100;
    // «User cancelled», «Series cancelled», отклонённая заявка, админ без
    // штрафа — возврат полный (клиент сам отменяет только раньше суток).
    return 1;
}

export interface CancelledRefund {
    /** Код статуса оплаты для StatusBadge (слово из statuses.ts) или null. */
    badge: 'refunded' | 'waived' | null;
    /** Строка в блоке «Оплата»: «Вернули 20 ₾ на баланс», «Без возврата». */
    text: string;
}

/** Отменённая бронь: что вернули (вместо «Оплачено»). */
export function cancelledRefund(b: BookingHistoryItem): CancelledRefund {
    const reason = b.cancellationReason || '';
    const share = refundShare(b);
    const { parts, notCharged } = refundParts(b, share);
    // Пересдача: сумму денег пишет сам сервер («· 10.00GEL») — она точнее.
    if (isReRentReason(reason) && !notCharged) {
        const m = /([0-9]+(?:\.[0-9]+)?)\s*GEL/i.exec(reason);
        const fromServer = m ? parseFloat(m[1]) : NaN;
        if (Number.isFinite(fromServer) && fromServer > 0 && parts.subH === 0) parts.money = fromServer;
    }
    const txt = partsText(parts);
    const pctNote = share > 0 && share < 1 ? `${Math.round(share * 100)} %: ` : '';
    if (txt.length > 0) return { badge: 'refunded', text: `Вернули ${pctNote}${txt.join(' и ')}` };
    if (notCharged) return { badge: 'waived', text: 'Оплата не списывалась' };
    if (share <= 0) return { badge: null, text: 'Без возврата' };
    return { badge: null, text: 'Бронь была бесплатной' };
}

/** Причина отмены по-человечески (как разбирает компьютерная версия, MyBookingsPage). */
export function cancellationReasonText(b: BookingHistoryItem): string | null {
    const raw = (b.cancellationReason || '').trim();
    if (!raw) return null;
    if (isReRentReason(raw) && /^auto-cancelled/i.test(raw)) return 'Время пересдали другому специалисту';
    if (/^user cancelled$/i.test(raw)) return 'Вы отменили бронь';
    const stripped = raw.replace(/\s*\(\d+(?:[.,]\d+)?\s*%\s*возврат\)\s*$/i, '').trim();
    if (/^series cancelled$/i.test(stripped)) return 'Отменена вместе с серией';
    const rej = /^Отклонено админом(?:\s*\([^)]*\))?\s*:?\s*(.*)$/i.exec(stripped);
    if (rej) return rej[1] ? `Администратор не подтвердил заявку: ${rej[1]}` : 'Администратор не подтвердил заявку';
    // Служебный английский текст, который не узнали, — не показываем как есть.
    if (/^[\x20-\x7E]+$/.test(stripped)) return 'Отменена';
    return stripped || null;
}

/**
 * 09.11 (владелец): пересдача — только когда до начала меньше суток. Больше
 * суток — пересдавать не нужно, бронь отменяют с полным возвратом. Подсказка на
 * месте кнопки «Пересдать» (шторка брони, компьютерная «Мои бронирования»).
 */
export const RE_RENT_TOO_EARLY_HINT = 'Больше суток до начала — отмените бронь, деньги вернутся полностью';
