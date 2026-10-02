import { useEffect, useState } from 'react';
import { cashboxReportsApi } from '../api/cashbox';
import { rebateIndex } from '../utils/weeklyRebateNote';

// Один запрос на несколько экранов («Сегодня», список броней, шторка брони):
// ответ живёт 5 минут. Сбой — без кэша (метка необязательная, попробуем снова).
const TTL_MS = 5 * 60_000;
let cache: { at: number; promise: Promise<Map<string, number>> } | null = null;

function loadRebates(): Promise<Map<string, number>> {
    const now = Date.now();
    if (!cache || now - cache.at > TTL_MS) {
        const promise = cashboxReportsApi.getRecentWeeklyRebates()
            .then(r => rebateIndex(r?.items || []))
            .catch(() => { cache = null; return new Map<string, number>(); });
        cache = { at: now, promise };
    }
    return cache.promise;
}

/**
 * Недельные скидки, начисленные с последнего понедельника (по Тбилиси), —
 * для метки у клиента в «Сегодня»: «скидка за неделю +9 ₾ уже учтена в «к оплате»».
 *
 * Один запрос на экран; без права на отчёты кассы (enabled=false) не ходим.
 * Ошибка — просто без меток: подсказка необязательная, суммы «к оплате» от неё
 * не зависят (они из баланса, где скидка уже лежит).
 */
export function useRecentWeeklyRebates(enabled: boolean): Map<string, number> {
    const [idx, setIdx] = useState<Map<string, number>>(() => new Map());
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        loadRebates().then(m => { if (!cancelled) setIdx(m); });
        return () => { cancelled = true; };
    }, [enabled]);
    return idx;
}
