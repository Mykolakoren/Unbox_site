import { api } from './client';

/**
 * Блокировки кабинета («Закрыть кабинет», обслуживание) — волна 4, шаг 0.
 *
 * Сервер: backend/app/api/v1/maintenance.py. Блок — это строка Booking с
 * payment_method='service'. Решение владельца В1 (01.10): поверх брони клиента
 * блок не ставится — сервер отвечает 409 со списком броней, ничего не создаёт.
 * Экран ловит это через isMaintenanceConflict(e) и показывает
 * MaintenanceConflictSheet со списком.
 *
 * Ответы успеха интерцептор уже перевёл в camelCase; ответ ошибки — нет
 * (detail приходит snake_case), поэтому конфликты разбираем здесь сами.
 */

export interface MaintenanceBlock {
    id: string;
    resourceId: string;
    locationId: string;
    /** Naive-дата из базы с временем начала («2026-10-02T10:00:00»), день по Батуми. */
    date: string;
    startTime: string;
    duration: number;
    reason: string;
    createdAt: string;
    /** Серия (несколько дат одним запросом) — общий id; одиночный блок — null. */
    recurringGroupId?: string | null;
}

export interface MaintenanceCreateInput {
    resourceId: string;
    locationId: string;
    /** «YYYY-MM-DD» */
    dateFrom: string;
    /** «YYYY-MM-DD», включительно. Нет — один день. */
    dateTo?: string | null;
    /** «HH:MM» */
    startTime: string;
    /** Минуты, 15…600. */
    duration: number;
    reason?: string;
    /** 0 = пн … 6 = вс. Нет — каждый день диапазона. */
    recurringWeekdays?: number[] | null;
}

/** Бронь клиента, мешающая закрыть кабинет. */
export interface MaintenanceConflict {
    bookingId: string;
    resourceId: string;
    /** «YYYY-MM-DD» — день по Батуми. */
    date: string;
    startTime: string;
    duration: number;
    status: string;
    client: { name: string | null; email: string | null };
    /** pending — ещё не списана, paid — оплачена/списана, waived — прощена. */
    paymentStatus: string | null;
    finalPrice: number;
}

/** Ошибка 409 «в это время есть брони» — с разобранным списком. */
export class MaintenanceConflictError extends Error {
    readonly conflicts: MaintenanceConflict[];
    /** Исходная ошибка axios (для toastApiError и т.п.). */
    readonly original: unknown;

    constructor(message: string, conflicts: MaintenanceConflict[], original: unknown) {
        super(message);
        this.name = 'MaintenanceConflictError';
        this.conflicts = conflicts;
        this.original = original;
    }
}

export function isMaintenanceConflict(e: unknown): e is MaintenanceConflictError {
    return e instanceof MaintenanceConflictError;
}

const pick = (o: any, snake: string, camel: string) => (o?.[snake] !== undefined ? o[snake] : o?.[camel]);

function toConflict(c: any): MaintenanceConflict {
    const client = c?.client || {};
    return {
        bookingId: String(pick(c, 'booking_id', 'bookingId') ?? ''),
        resourceId: String(pick(c, 'resource_id', 'resourceId') ?? ''),
        date: String(c?.date ?? ''),
        startTime: String(pick(c, 'start_time', 'startTime') ?? ''),
        duration: Number(c?.duration ?? 0),
        status: String(c?.status ?? ''),
        client: { name: client.name ?? null, email: client.email ?? null },
        paymentStatus: pick(c, 'payment_status', 'paymentStatus') ?? null,
        finalPrice: Number(pick(c, 'final_price', 'finalPrice') ?? 0),
    };
}

/** 409 с {message, conflicts} → MaintenanceConflictError; иначе null. */
export function parseMaintenanceConflict(e: unknown): MaintenanceConflictError | null {
    const res = (e as any)?.response;
    if (res?.status !== 409) return null;
    const detail = res?.data?.detail;
    if (!detail || typeof detail !== 'object' || !Array.isArray(detail.conflicts)) return null;
    const message = typeof detail.message === 'string' ? detail.message : 'В это время есть брони';
    return new MaintenanceConflictError(message, detail.conflicts.map(toConflict), e);
}

export const maintenanceApi = {
    /** Блокировки, по желанию с даты/до даты (включительно) и по кабинету. */
    list: async (params: { dateFrom?: string; dateTo?: string; resourceId?: string } = {}): Promise<MaintenanceBlock[]> => {
        const { data } = await api.get<MaintenanceBlock[]>('/maintenance-blocks/', {
            params: {
                date_from: params.dateFrom || undefined,
                date_to: params.dateTo || undefined,
                resource_id: params.resourceId || undefined,
            },
        });
        return data;
    },

    /**
     * Закрыть кабинет (одна дата или серия). Пересечение с бронями →
     * бросает MaintenanceConflictError (ничего не создано). Прочие ошибки —
     * как есть (axios), их показывает toastApiError.
     */
    create: async (input: MaintenanceCreateInput): Promise<MaintenanceBlock[]> => {
        try {
            const { data } = await api.post<MaintenanceBlock[]>('/maintenance-blocks/', {
                resourceId: input.resourceId,
                locationId: input.locationId,
                dateFrom: input.dateFrom,
                dateTo: input.dateTo || null,
                startTime: input.startTime,
                duration: input.duration,
                reason: input.reason ?? '',
                recurringWeekdays: input.recurringWeekdays && input.recurringWeekdays.length > 0
                    ? input.recurringWeekdays : null,
            });
            return data;
        } catch (e) {
            throw parseMaintenanceConflict(e) ?? e;
        }
    },

    /** Снять одну блокировку. */
    remove: async (id: string): Promise<void> => {
        await api.delete(`/maintenance-blocks/${id}`);
    },

    /** Снять всю серию. Сервер удаляет только блокировки, брони клиентов не трогает. */
    removeGroup: async (groupId: string): Promise<{ deleted: number }> => {
        const { data } = await api.delete<{ ok: boolean; groupId: string; deleted: number }>(
            `/maintenance-blocks/group/${groupId}`,
        );
        return { deleted: Number(data?.deleted ?? 0) };
    },
};
