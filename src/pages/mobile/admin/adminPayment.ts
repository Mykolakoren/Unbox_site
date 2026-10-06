import { useMemo } from 'react';
import type { BookingHistoryItem, User } from '../../../store/types';
import { computeDueByBooking, type DueInfo } from '../../../utils/dueAmounts';
import { applyAllocation } from '../../../utils/balanceAllocation';
import { useAllocationIndex } from '../../../hooks/useBalanceAllocation';
import { futureChargedDue, todayRows, byClient, bookingDayKey, batumiDayKey } from '../../../utils/adminToday';
import { branchOfBooking } from '../../../utils/cashBranch';

// Филиал по кабинету — общий с компьютером (src/utils/cashBranch.ts).
export { branchOfBooking };

/**
 * «К оплате» в мобильной админке (волна 4, пакет A) — только чтение.
 *
 * dueMap — та же computeDueByBooking, что в шахматке на компьютере (своих
 * формул нет). acceptPaymentFor — что подставить в TopupSheet по брони
 * (решение владельца В3): сумма по умолчанию — весь долг клиента
 * (adminToday.byClient → total), «из них за сегодня» — только для сегодняшней.
 */
export function useAdminDueMap(bookings: BookingHistoryItem[], users: User[]): Map<string, DueInfo> {
    // 03.10: поверх — раскладка ленты с сервера (applyAllocation), как на компьютере.
    const allocIndex = useAllocationIndex(users || [], bookings || []);
    return useMemo(() => {
        const bal = new Map<string, number>();
        for (const u of users || []) {
            const v = Number(u.balance ?? 0);
            if (u.email) bal.set(u.email, v);
            if (u.id) bal.set(String(u.id), v);
        }
        const balanceOf = (uid: string) => (bal.has(uid) ? bal.get(uid)! : null);
        return applyAllocation(computeDueByBooking(bookings, balanceOf), bookings, allocIndex, balanceOf);
    }, [bookings, users, allocIndex]);
}

export interface AcceptPayment {
    user: User;
    /** Сумма по умолчанию — весь долг (В3). */
    total: number;
    /** Сколько из неё за сегодняшние брони (0 — не сегодня). */
    today: number;
    /** Филиал брони — подставляем в шторку. */
    branch?: string;
}

/** Что взять с клиента этой брони. null — клиента нет в списке или брать нечего. */
export function acceptPaymentFor(
    b: BookingHistoryItem,
    bookings: BookingHistoryItem[],
    users: User[],
    dueMap: Map<string, DueInfo>,
): AcceptPayment | null {
    const user = users.find(u => u.email === b.userId || String(u.id) === b.userId);
    if (!user) return null;
    const dayKey = bookingDayKey(b.date as any) ?? batumiDayKey();
    const rows = todayRows({ bookings: bookings as any, users, dueMap, dayKey });
    const key = String(user.id || user.email);
    const mine = byClient(rows, users, futureChargedDue(bookings, dueMap, batumiDayKey())).find(c => c.userId === key);
    const balance = Number(user.balance ?? 0);
    const total = mine ? mine.total : Math.max(0, -balance);
    if (!(total > 0)) return null;
    const isToday = dayKey === batumiDayKey();
    return {
        user,
        total,
        today: isToday && mine ? mine.today : 0,
        branch: branchOfBooking(b),
    };
}
