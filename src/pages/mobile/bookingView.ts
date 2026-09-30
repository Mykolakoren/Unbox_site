import type { BookingHistoryItem } from '../../store/types';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { formatChargeAt } from '../../utils/chargeTime';
import { formatTimeRange } from '../../utils/format';
import { priceLabel } from './priceLabel';

/**
 * Общие подписи брони для клиентских экранов /m (волна 2).
 *
 * «Сегодня», «Мои брони» и шторка брони раньше каждая считала начало,
 * конец и место по-своему. Здесь — одно место. Деньги тут НЕ считаются:
 * сумма берётся из самой брони (priceLabel), время списания — из той же
 * formatChargeAt, что уже показывала шторка брони.
 */

/** Бронь ещё впереди и не отменена: подтверждённая или ждёт одобрения
 *  администратора («горячая» бронь). Раньше экраны брали только confirmed,
 *  и бронь на одобрении пропадала из «Сегодня» и «Моих броней». */
export function isLiveBooking(b: BookingHistoryItem): boolean {
    return b.status === 'confirmed' || b.status === 'pending_approval';
}

/** Начало брони в поясе браузера — как по всему коду: дата + «HH:MM». */
export function bookingStartDate(b: BookingHistoryItem): Date | null {
    try {
        const d = b.date instanceof Date ? b.date : new Date(b.date as any);
        if (isNaN(d.getTime()) || !b.startTime) return null;
        const [h, m] = b.startTime.split(':').map(Number);
        const out = new Date(d);
        out.setHours(h, m, 0, 0);
        return out;
    } catch {
        return null;
    }
}

export function bookingEndDate(b: BookingHistoryItem, start: Date): Date {
    return new Date(start.getTime() + (b.duration ?? 60) * 60000);
}

/** «09:00–10:30». */
export function bookingTimeRange(b: BookingHistoryItem, start: Date): string {
    return formatTimeRange(start, bookingEndDate(b, start));
}

/** Кабинет и центр брони. */
export function bookingPlace(b: BookingHistoryItem) {
    const resource = RESOURCES.find(r => r.id === b.resourceId);
    const location = LOCATIONS.find(l => l.id === resource?.locationId);
    const cabinet = resource?.name ?? b.resourceId;
    return {
        resource,
        location,
        /** «Кабинет 1 · Unbox One» */
        title: location ? `${cabinet} · ${location.name}` : cabinet,
        address: location?.address ?? '',
    };
}

/** Ссылка на карту по адресу центра (кнопка «Маршрут»). */
export function mapsUrl(location: { name: string; address: string } | undefined | null): string | null {
    if (!location) return null;
    const q = `${location.name}, ${location.address}, Батуми`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * Строка оплаты для карточки встречи:
 *   «Ждём подтверждения администратора»
 *   «Оплачено: 1,5 ч из абонемента»
 *   «Спишем завтра в 09:00: 20 ₾»
 * Сумма — priceLabel брони, время — formatChargeAt (за сутки до начала,
 * как сервер и как уже писала шторка брони).
 */
export function paymentLine(b: BookingHistoryItem, start: Date | null): string {
    if (b.status === 'pending_approval') return 'Ждём подтверждения администратора';
    const price = priceLabel(b);
    if (b.paymentStatus === 'paid') return `Оплачено: ${price}`;
    if (b.paymentStatus === 'waived') return 'Без оплаты';
    // Бонусный час уже потрачен при брони — «Спишем…» тут неправда.
    if (b.paymentMethod === 'bonus') return price;
    if (b.paymentStatus === 'pending' && start) return `Спишем ${formatChargeAt(start)}: ${price}`;
    return price;
}
