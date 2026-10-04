import { api } from './client';
import type { AllocSummaryResponse, ClientAllocation } from '../utils/balanceAllocation';

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
    forClient: async (userId: string): Promise<ClientAllocation> => {
        const { data } = await api.get<ClientAllocation>(
            `/users/${encodeURIComponent(userId)}/balance-allocation`,
        );
        return data;
    },
};
