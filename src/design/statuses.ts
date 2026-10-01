import type { StatusTone } from './tokens';

/**
 * ОДИН словарь статусов брони, оплаты и сессии CRM (wave 1, 30.09).
 *
 * Раньше один и тот же статус назывался тремя словами и красился шестью
 * цветами: «Подтверждена / Активно / ✅ Активно», «Ожидает / ⏳ Ожидает
 * подтверждения», «Завершена / Прошла», «Не пришёл / Неявка», а неизвестный
 * код выводился как есть («CANCELLED», «rescheduled»).
 *
 * Цвет — только по смыслу (PRODUCT.md): ok — зелёный «всё хорошо»,
 * pending — янтарный «ждём», danger — красный «долг / отмена», info —
 * «запланировано», muted — серый «прошло». Бирюза сюда не входит: она
 * значит «выбрано».
 *
 * Словарь на утверждение владельцу — менять слова только здесь.
 */
export type StatusKind = 'booking' | 'payment' | 'session';
export type StatusIcon = 'check' | 'clock' | 'x' | 'alert' | 'repeat' | 'move' | 'calendar' | 'undo' | 'minus';

export interface StatusDef {
    /** Как видит клиент/специалист о своей брони. */
    label: string;
    /** Как видит админ, если отличается («ждём» → «ждёт»). */
    staffLabel?: string;
    tone: StatusTone;
    icon: StatusIcon;
}

export const STATUS_DICTIONARY: Record<StatusKind, Record<string, StatusDef>> = {
    // Бронь кабинета (booking.status)
    booking: {
        confirmed:        { label: 'Подтверждена', tone: 'ok', icon: 'check' },
        pending_approval: { label: 'Ждём подтверждения', staffLabel: 'Ждёт подтверждения', tone: 'pending', icon: 'clock' },
        completed:        { label: 'Прошла', tone: 'muted', icon: 'check' },
        cancelled:        { label: 'Отменена', tone: 'danger', icon: 'x' },
        rescheduled:      { label: 'Перенесена', tone: 'muted', icon: 'move' },
        're-rented':      { label: 'Пересдана', tone: 'muted', icon: 'repeat' },
        // Псевдостатус: НЕ приходит с сервера. Это флаг isReRentListed на
        // подтверждённой (confirmed) брони — владелец выставил время
        // «Пересдать», пока его никто не забрал. Экраны передают этот код
        // сами, когда хотят показать «На пересдаче» вместо «Подтверждена».
        're-rent-listed': { label: 'На пересдаче', tone: 'pending', icon: 'repeat' },
        no_show:          { label: 'Неявка', tone: 'danger', icon: 'alert' },
    },
    // Оплата (booking.paymentStatus, оплата сессии CRM, долги)
    payment: {
        paid:     { label: 'Оплачено', tone: 'ok', icon: 'check' },
        unpaid:   { label: 'Не оплачено', tone: 'danger', icon: 'alert' },
        debt:     { label: 'Долг', tone: 'danger', icon: 'alert' },
        partial:  { label: 'Оплачено частично', tone: 'pending', icon: 'minus' },
        // Сервер списывает за сутки до начала — до этого «ждёт списания».
        pending:  { label: 'Ждёт списания', tone: 'pending', icon: 'clock' },
        // Бронь уже прошла, а списания так и не было (сбой крона) — для админа
        // «посмотрите», не «долг»: в суммы «к оплате» не входит (DueBadge).
        not_charged: { label: 'Не списана', tone: 'pending', icon: 'alert' },
        waived:   { label: 'Без оплаты', tone: 'muted', icon: 'minus' },
        refunded: { label: 'Возвращено', tone: 'muted', icon: 'undo' },
    },
    // Сессия с клиентом в Psy-CRM (CrmSession.status)
    session: {
        PLANNED:             { label: 'Запланирована', tone: 'info', icon: 'calendar' },
        COMPLETED:           { label: 'Прошла', tone: 'muted', icon: 'check' },
        CANCELLED_CLIENT:    { label: 'Отменил клиент', tone: 'danger', icon: 'x' },
        CANCELLED_THERAPIST: { label: 'Отменил специалист', tone: 'danger', icon: 'x' },
    },
};

/** Неизвестный код — нейтрально и по-русски; сам код уходит в title. */
const UNKNOWN: StatusDef = { label: 'Другой статус', tone: 'muted', icon: 'minus' };

export function getStatusDef(kind: StatusKind, code: string | null | undefined): StatusDef & { known: boolean } {
    const def = code ? STATUS_DICTIONARY[kind][code] : undefined;
    return def ? { ...def, known: true } : { ...UNKNOWN, known: false };
}

/** Подпись статуса. audience='staff' — формы для админки («Ждёт подтверждения»). */
export function statusLabel(kind: StatusKind, code: string | null | undefined, audience: 'client' | 'staff' = 'client'): string {
    const def = getStatusDef(kind, code);
    return audience === 'staff' && def.staffLabel ? def.staffLabel : def.label;
}
