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

/** Ответ на near-конфликт: перенести существующую / создать отдельную / пропустить. */
export type CalendarNearDecision = 'move' | 'force' | 'skip';

/**
 * Память ответа для СЕРИИ (ревизор 01.10): при 24 датах не задаём 24 вопроса.
 * После первого ответа спрашиваем «Применить ко всем датам серии?»; «да» —
 * дальше решение применяется молча (в т.ч. «Не создавать» — оставшиеся
 * конфликтные даты пропускаются), «нет» — спрашиваем по каждой дате.
 * Создайте один объект `{}` на весь цикл серии и передавайте в каждый вызов.
 */
export interface SeriesCalendarChoice {
    decision?: CalendarNearDecision;
    asked?: boolean;
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
    series?: SeriesCalendarChoice,
): Promise<CrmSession | null> {
    try {
        return await create(data);
    } catch (err) {
        const near = calendarNearConflict(err);
        if (!near) throw err;

        // Перенос существующей: только если она не держит СВОЮ бронь кабинета,
        // когда мы привязываем новую (иначе сдвинулась бы чужая бронь).
        const canMove = !!near.existingSessionId && !(data.bookingId && near.existingHasBooking);

        let decision: CalendarNearDecision | undefined = series?.decision;
        // Запомненное «перенести» на дату, где переносить нечего, — спросим заново.
        if (decision === 'move' && !canMove) decision = undefined;

        if (!decision) {
            if (canMove && await confirmAction({
                title: 'У клиента уже есть встреча рядом',
                body: `${near.message} Перенести её на ${hhmm(data.date)}?`,
                confirmLabel: 'Перенести существующую',
                cancelLabel: 'Нет',
            })) {
                decision = 'move';
            } else {
                decision = await confirmAction({
                    title: 'Создать отдельную встречу?',
                    body: `${near.message} Если это другая встреча — создадим ещё одну сессию и событие в календаре.`,
                    confirmLabel: 'Всё равно создать',
                    cancelLabel: 'Не создавать',
                }) ? 'force' : 'skip';
            }
            if (series && !series.asked) {
                series.asked = true;
                const label = decision === 'move' ? '«Перенести существующую»'
                    : decision === 'force' ? '«Всё равно создать»' : '«Не создавать»';
                if (await confirmAction({
                    title: 'Применить этот ответ ко всем датам серии?',
                    body: `Если на других датах серии рядом тоже окажется встреча клиента — ответим ${label} без вопросов.`,
                    confirmLabel: 'Да, ко всем датам',
                    cancelLabel: 'Спрашивать по каждой',
                })) {
                    series.decision = decision;
                }
            }
        }

        if (decision === 'move') {
            const patch: CrmSessionUpdate = { date: data.date };
            if (data.durationMinutes) patch.durationMinutes = data.durationMinutes;
            if (data.bookingId) { patch.bookingId = data.bookingId; patch.isBooked = true; }
            if (data.price !== undefined) patch.price = data.price;
            return await update(near.existingSessionId as string, patch);
        }
        if (decision === 'force') return await create({ ...data, force: true });
        return null;
    }
}
