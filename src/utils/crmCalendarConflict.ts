import type { CrmSession, CrmSessionCreate, CrmSessionUpdate } from '../api/crm';
import { confirmAction } from '../components/ui/ConfirmDialogProvider';

/**
 * «Почти совпало» в Google Календаре (01.10).
 *
 * POST /crm/sessions с pushToCalendar отвечает 409 `code: 'calendar_near'`,
 * если у клиента в календаре уже стоит встреча в пределах ±3 часов. Раньше
 * сервер молча создавал сессию без события — потом синк делал из того же
 * события вторую сессию. Теперь спрашиваем специалиста:
 *   «Перенести существующую» — двигаем ту сессию (и её событие) на новое время;
 *   «Всё равно создать»       — повтор с force: true, отдельная встреча.
 *
 * Тело ошибки НЕ проходит camelCase-конвертер (он только для успешных
 * ответов), поэтому поля здесь в snake_case.
 */
export interface CalendarNearConflict {
    message: string;
    conflictStart: string | null;   // Тбилиси, 'YYYY-MM-DDTHH:MM:SS'
    eventSummary: string | null;
    existingSessionId: string | null;
    existingHasBooking: boolean;
}

export function calendarNearConflict(err: unknown): CalendarNearConflict | null {
    const e = err as { response?: { status?: number; data?: { detail?: unknown } } } | null;
    if (e?.response?.status !== 409) return null;
    const d = e.response.data?.detail as Record<string, unknown> | undefined;
    if (!d || typeof d !== 'object' || d.code !== 'calendar_near') return null;
    return {
        message: typeof d.message === 'string' ? d.message : 'У клиента уже есть встреча в календаре рядом с этим временем',
        conflictStart: typeof d.conflict_start === 'string' ? d.conflict_start : null,
        eventSummary: typeof d.event_summary === 'string' ? d.event_summary : null,
        existingSessionId: typeof d.existing_session_id === 'string' ? d.existing_session_id : null,
        existingHasBooking: d.existing_has_booking === true,
    };
}

/** «HH:MM» из наивной строки даты 'YYYY-MM-DDTHH:MM…'. */
function hhmm(naive: string): string {
    return naive.slice(11, 16);
}

/**
 * Создать сессию; при near-конфликте — спросить специалиста.
 * Возвращает созданную/перенесённую сессию или null, если он отказался.
 * Любая другая ошибка пробрасывается как есть.
 */
export async function createSessionResolvingCalendar(
    create: (data: CrmSessionCreate) => Promise<CrmSession>,
    update: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>,
    data: CrmSessionCreate,
): Promise<CrmSession | null> {
    try {
        return await create(data);
    } catch (err) {
        const near = calendarNearConflict(err);
        if (!near) throw err;

        // Перенос существующей: только если она не держит СВОЮ бронь кабинета,
        // когда мы привязываем новую (иначе сдвинулась бы чужая бронь).
        const canMove = !!near.existingSessionId && !(data.bookingId && near.existingHasBooking);
        if (canMove) {
            const move = await confirmAction({
                title: 'У клиента уже есть встреча рядом',
                body: `${near.message} Перенести её на ${hhmm(data.date)}?`,
                confirmLabel: 'Перенести существующую',
                cancelLabel: 'Нет',
            });
            if (move) {
                const patch: CrmSessionUpdate = { date: data.date };
                if (data.durationMinutes) patch.durationMinutes = data.durationMinutes;
                if (data.bookingId) { patch.bookingId = data.bookingId; patch.isBooked = true; }
                if (data.price !== undefined) patch.price = data.price;
                return await update(near.existingSessionId as string, patch);
            }
        }
        const force = await confirmAction({
            title: 'Создать отдельную встречу?',
            body: `${near.message} Если это другая встреча — создадим ещё одну сессию и событие в календаре.`,
            confirmLabel: 'Всё равно создать',
            cancelLabel: 'Не создавать',
        });
        if (!force) return null;
        return await create({ ...data, force: true });
    }
}
