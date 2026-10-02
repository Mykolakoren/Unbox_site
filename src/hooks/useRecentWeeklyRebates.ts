import { useEffect, useState } from 'react';
import { cashboxApi } from '../api/cashbox';
import { rebateIndex } from '../utils/weeklyRebateNote';

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
        cashboxApi.getRecentWeeklyRebates()
            .then(r => { if (!cancelled) setIdx(rebateIndex(r?.items || [])); })
            .catch(() => { /* метка необязательная */ });
        return () => { cancelled = true; };
    }, [enabled]);
    return idx;
}
