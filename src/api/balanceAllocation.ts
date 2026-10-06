import { api } from './client';
import type { AllocSummaryResponse, ClientAllocation } from '../utils/balanceAllocation';

/** «Чем оплачено» одной брони (06.10): «наличные в кассу», «на счёт TBC», «в долг 15 ₾»… */
export interface PaidViaItem {
    bookingId: string;
    kind: 'subscription' | 'bonus' | 'paid' | 'debt' | 'pending' | 'free' | 'none';
    via: string[];
}

/**
 * Куда ушли деньги клиента (03.10) — только чтение.
 *  • summary — значки «к оплате» по всем клиентам с ненулевым балансом
 *    (партии плюса и долги по броням, в т.ч. вне окна админки);
 *  • forClient — карточка клиента и попап брони: раскладка каждой строки ленты.
 * Ответы — массивы объектов (не словари по id/почте): общий toCamelCase
 * переписал бы ключи с «_».
 */
export const balanceAllocationApi = {
    summary: async (): Promise<AllocSummaryResponse> => {
        const { data } = await api.get<AllocSummaryResponse>('/balance-allocation/summary');
        return data;
    },
    /** Таблица броней: сервер берёт до 200 id за раз — длинный список кусками. */
    paidVia: async (ids: string[]): Promise<PaidViaItem[]> => {
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
        const parts = await Promise.all(chunks.map(async (part) => {
            const { data } = await api.get<{ items: PaidViaItem[] }>('/balance-allocation/paid-via', {
                params: { ids: part.join(',') },
            });
            return data?.items ?? [];
        }));
        return parts.flat();
    },
    forClient: async (userId: string): Promise<ClientAllocation> => {
        const { data } = await api.get<ClientAllocation>(
            `/users/${encodeURIComponent(userId)}/balance-allocation`,
        );
        return data;
    },
};
