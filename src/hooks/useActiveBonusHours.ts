import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { bonusesApi, type Bonus } from '../api/bonuses';
import { activeBonusHours } from '../utils/paymentPriority';

/**
 * Бонусные часы того, ЗА КОГО бронь. Сервер тратит бонусы владельца брони
 * (порядок оплаты: бонус → абонемент → баланс), поэтому в режиме «админ за
 * клиента» читаем бонусы клиента, а не админа — иначе экран обещал бы одно,
 * а сервер делал другое.
 */
export function useActiveBonusHours(ownerId: string | null | undefined, isProxy: boolean): number {
    const [hours, setHours] = useState(0);
    useEffect(() => {
        if (!ownerId) {
            setHours(0);
            return;
        }
        let cancelled = false;
        const req: Promise<Bonus[]> = isProxy
            // Параметры запроса интерцептор не переводит в snake_case — пишем сами.
            ? api.get('/bonuses/', { params: { status: 'active', user_id: ownerId } })
                .then(r => (r.data as Bonus[]).filter(b => b.userId === ownerId))
            : bonusesApi.getMyBonuses();
        req.then(bs => { if (!cancelled) setHours(activeBonusHours(bs)); })
            .catch(() => { if (!cancelled) setHours(0); });
        return () => { cancelled = true; };
    }, [ownerId, isProxy]);
    return hours;
}
