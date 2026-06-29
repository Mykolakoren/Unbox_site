/**
 * Единая трактовка формата работы специалиста (онлайн / очно).
 *
 * 2026-06-29 owner: в базе исторический зоопарк offline-кодов — OFFLINE,
 * OFFLINE_ROOM, OFFLINE_CAPSULE, OFFLINE_TBEL, OFFLINE_PALIASHVILI,
 * OFFLINE_NEO, OFFLINE_UNBOX_ONE/UNI/NEO_SCHOOL. Раньше каждое место
 * (шапка профиля, карточка каталога, фильтр, админка) проверяло свой
 * частичный набор → «Очно» терялось у большинства. Теперь — одна логика.
 */

/** Любой offline-код (начинается с OFFLINE). */
export function isOfflineFormat(f: unknown): boolean {
    return typeof f === 'string' && f.toUpperCase().startsWith('OFFLINE');
}

/** Капсула — единственный отдельный подтип очного. */
export function isCapsuleFormat(f: unknown): boolean {
    return typeof f === 'string' && f.toUpperCase() === 'OFFLINE_CAPSULE';
}

export function hasOnlineFormat(formats?: readonly string[] | null): boolean {
    return !!formats?.includes('ONLINE');
}

export function hasOfflineFormat(formats?: readonly string[] | null): boolean {
    return !!formats?.some(isOfflineFormat);
}

/** Очно «в кабинете» — любой не-капсульный offline-код. Generic OFFLINE
 *  и центр-специфичные коды считаем кабинетом. */
export function hasOfflineRoom(formats?: readonly string[] | null): boolean {
    return !!formats?.some(f => isOfflineFormat(f) && !isCapsuleFormat(f));
}

export function hasOfflineCapsule(formats?: readonly string[] | null): boolean {
    return !!formats?.some(isCapsuleFormat);
}
