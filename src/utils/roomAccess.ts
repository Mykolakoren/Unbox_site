import { useBookingStore } from '../store/bookingStore';

/**
 * Закреплённый кабинет (владелец 21.11.2026).
 *
 * Кабинет 1 в UNBOX 99 — практика владельца: в аренду не сдаётся, бронь там
 * может стоять только на людей из списка (Resource.allowedUserIds). Решает
 * сервер (services/staff_scope.py → check_availability); здесь — чтобы кабинет
 * не предлагался тем, кому в нём всё равно откажут.
 *
 * Список приходит с сервера вместе с кабинетами. В запасной копии utils/data.ts
 * закреплённого кабинета нет нарочно: экраны, которые берут кабинеты оттуда
 * (мастер брони, «Найти время», календарь на телефоне), его не показывают вовсе.
 */
type RoomLike = { id?: string; allowedUserIds?: string[] | null };

function allowedIds(room: RoomLike | string | undefined | null): string[] {
    if (!room) return [];
    const found = typeof room === 'string'
        ? useBookingStore.getState().resources.find(r => r.id === room)
        : room;
    return (found?.allowedUserIds ?? []).map(String);
}

/** Кабинет закреплён за конкретными людьми и не сдаётся. */
export function isPinnedRoom(room: RoomLike | string | undefined | null): boolean {
    return allowedIds(room).length > 0;
}

/** Можно ли поставить в кабинет бронь на этого человека. Обычный кабинет — всем. */
export function canBookRoomFor(room: RoomLike | string | undefined | null, userId: string | undefined | null): boolean {
    const ids = allowedIds(room);
    if (ids.length === 0) return true;
    return !!userId && ids.includes(String(userId));
}
