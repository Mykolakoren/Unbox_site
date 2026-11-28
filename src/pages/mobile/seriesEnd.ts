/**
 * «Серия скоро закончится» на «Сегодня» (28.11, шаг 1 плана мобильной брони).
 *
 * Если человек в шторке брони выбрал «Пусть завершится в срок», строку про эту
 * серию больше не показываем. Сервер этот выбор наружу не отдаёт, поэтому
 * помним его на устройстве. Хранилище может быть недоступно (приватный режим) —
 * тогда строка просто останется, это не страшно.
 */
const KEY = 'unbox.mobile.seriesEndDismissed';

function read(): string[] {
    try {
        const raw = localStorage.getItem(KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

/** Серии, про которые человек сказал «не продлевать» (читаем хранилище один раз). */
export function dismissedSeriesEnds(): Set<string> {
    return new Set(read());
}

export function dismissSeriesEnd(groupId: string): void {
    try {
        const next = [...read().filter(x => x !== groupId), groupId].slice(-50);
        localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
        /* приватный режим / нет места */
    }
}

/** Серию продлили — напоминание снова имеет смысл, когда подойдёт новый конец. */
export function restoreSeriesEnd(groupId: string): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(read().filter(x => x !== groupId)));
    } catch {
        /* приватный режим / нет места */
    }
}
