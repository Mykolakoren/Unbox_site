import { useEffect, useMemo, useState } from 'react';
import { usersApi } from '../api/users';
import type { User } from '../store/types';

/**
 * Клиенты в архиве — только для подписи броней (волна 4, доработка 01.10).
 *
 * Склейка дублей переносит аккаунт в архив, а его брони остаются на старой
 * почте. Обычный список клиентов (fetchUsers) архив не отдаёт, поэтому в
 * «Сегодня» такая бронь показывалась началом почты («david.tsulaya») без
 * имени. В самой брони имени клиента нет — берём его из архивной записи.
 *
 * Только имя и телефон для показа. В деньги архив НЕ подмешиваем: «к оплате»
 * по-прежнему только из dueMap (computeDueByBooking по обычному списку), и
 * у такой брони записи нет — отметку не рисуем.
 *
 * Запрос один на всю вкладку и только если в ленте есть бронь без клиента
 * в обычном списке.
 */

let cache: Promise<Map<string, User>> | null = null;

function loadArchived(): Promise<Map<string, User>> {
    if (!cache) {
        cache = usersApi.getUsers(0, 5000, true)
            .then(list => {
                const idx = new Map<string, User>();
                for (const u of list || []) {
                    if (!u?.archivedAt) continue;
                    if (u.id) idx.set(String(u.id), u);
                    if (u.email) idx.set(u.email, u);
                }
                return idx;
            })
            .catch(() => {
                cache = null; // подпись необязательная — попробуем в другой раз
                return new Map<string, User>();
            });
    }
    return cache;
}

/** userId броней, которых нет в обычном списке → архивная запись (если есть). */
export function useArchivedClients(missingUserIds: string[]): Map<string, User> {
    const key = useMemo(() => [...new Set(missingUserIds.filter(Boolean))].sort().join('|'), [missingUserIds]);
    const [idx, setIdx] = useState<Map<string, User>>(() => new Map());
    useEffect(() => {
        if (!key) return;
        let cancelled = false;
        loadArchived().then(m => { if (!cancelled) setIdx(m); });
        return () => { cancelled = true; };
    }, [key]);
    return idx;
}
