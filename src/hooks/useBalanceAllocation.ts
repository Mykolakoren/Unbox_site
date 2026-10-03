import { useEffect, useMemo, useState } from 'react';
import { balanceAllocationApi } from '../api/balanceAllocation';
import { indexAllocation, type AllocationIndex, type ClientAllocation } from '../utils/balanceAllocation';
import { useUserStore } from '../store/userStore';
import { hasPermission } from '../utils/permissions';
import type { BookingHistoryItem, User } from '../store/types';

/**
 * Раскладка денег клиентов с сервера (03.10) — для «к оплате» и строк ленты.
 *
 * Сводка одна на вкладку: шахматка, список броней и «Сегодня» берут один и тот
 * же ответ. Перезапрос — когда меняются балансы клиентов или брони (после
 * оплаты, отмены, переноса экран и так перечитывает их). Пока сводки нет или
 * она не пришла — экраны считают «к оплате» по-старому (computeDueByBooking),
 * а клиента с устаревшей сводкой (баланс в сторе другой) applyAllocation
 * пропускает сам.
 */

const ADMIN_ROLES = ['owner', 'senior_admin', 'admin'];
const SUMMARY_TTL_MS = 60_000;
let summaryCache: { sig: string; at: number; promise: Promise<AllocationIndex | null> } | null = null;

/** Отпечаток ненулевых балансов — меняется после любой оплаты/списания. */
export function balanceSignature(users: ReadonlyArray<Pick<User, 'id' | 'balance'>>): string {
    const parts: string[] = [];
    for (const u of users || []) {
        const b = Math.round(Number(u?.balance ?? 0) * 100);
        if (b !== 0) parts.push(`${u.id}:${b}`);
    }
    parts.sort();
    return parts.join('|');
}

/** Отпечаток броней: id, время, статус, списание — перенос меняет порядок долга. */
export function bookingsSignature(bookings: ReadonlyArray<BookingHistoryItem>): string {
    let h = 0;
    for (const b of bookings || []) {
        const s = `${b.id}|${String(b.date).slice(0, 10)}|${b.startTime}|${b.status}|${b.paymentStatus ?? ''}|${b.finalPrice}`;
        for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    }
    return `${(bookings || []).length}:${h}`;
}

function loadSummary(sig: string): Promise<AllocationIndex | null> {
    const now = Date.now();
    if (summaryCache && summaryCache.sig === sig && now - summaryCache.at < SUMMARY_TTL_MS) {
        return summaryCache.promise;
    }
    const promise: Promise<AllocationIndex | null> = balanceAllocationApi.summary()
        .then(r => indexAllocation(r?.clients))
        .catch(() => {
            if (summaryCache && summaryCache.promise === promise) summaryCache = null;
            return null;
        });
    summaryCache = { sig, at: now, promise };
    return promise;
}

/** Сводка раскладки по всем клиентам (null — нет права/ещё грузится/сбой: «к оплате» по-старому). */
export function useAllocationIndex(
    users: ReadonlyArray<User>,
    bookings: ReadonlyArray<BookingHistoryItem>,
): AllocationIndex | null {
    const currentUser = useUserStore(s => s.currentUser);
    const enabled = !!currentUser && ADMIN_ROLES.includes(currentUser.role || '')
        && hasPermission(currentUser, 'crm.view_clients');
    const usersSig = useMemo(() => balanceSignature(users), [users]);
    const bookingsSig = useMemo(() => bookingsSignature(bookings), [bookings]);
    const sig = `${usersSig}#${bookingsSig}`;
    const [idx, setIdx] = useState<AllocationIndex | null>(null);
    useEffect(() => {
        if (!enabled || users.length === 0) return;
        let cancelled = false;
        const t = window.setTimeout(() => {
            loadSummary(sig).then(i => { if (!cancelled && i) setIdx(i); });
        }, 200);
        return () => { cancelled = true; window.clearTimeout(t); };
    }, [enabled, sig, users.length]);
    return enabled ? idx : null;
}

// ── Один клиент (карточка, попап брони) ─────────────────────────────────

const CLIENT_TTL_MS = 30_000;
const clientCache = new Map<string, { at: number; promise: Promise<ClientAllocation | null> }>();

export function loadClientAllocation(userId: string, balanceKey: string | number = ''): Promise<ClientAllocation | null> {
    const key = `${userId}|${balanceKey}`;
    const now = Date.now();
    const hit = clientCache.get(key);
    if (hit && now - hit.at < CLIENT_TTL_MS) return hit.promise;
    const promise: Promise<ClientAllocation | null> = balanceAllocationApi.forClient(userId)
        .catch(() => {
            clientCache.delete(key);
            return null;
        });
    clientCache.set(key, { at: now, promise });
    return promise;
}

/**
 * Раскладка одного клиента. balance — текущий баланс из стора: поменялся
 * (оплата, списание) — запрос заново. reloadKey — принудительный перезапрос.
 */
export function useClientAllocation(
    userId: string | null | undefined,
    balance?: number | null,
    reloadKey: unknown = 0,
): { data: ClientAllocation | null; failed: boolean; loading: boolean } {
    const balanceKey = balance === null || balance === undefined ? '' : Math.round(Number(balance) * 100);
    const key = userId ? `${userId}|${balanceKey}|${String(reloadKey)}` : '';
    // Ответ помечен своим ключом: сменился клиент/баланс — старый ответ не показываем
    // (без setState прямо в эффекте — правило react-hooks/set-state-in-effect).
    const [res, setRes] = useState<{ key: string; data: ClientAllocation | null } | null>(null);
    useEffect(() => {
        if (!userId) return;
        let alive = true;
        loadClientAllocation(userId, `${balanceKey}|${String(reloadKey)}`).then(d => {
            if (alive) setRes({ key: `${userId}|${balanceKey}|${String(reloadKey)}`, data: d });
        });
        return () => { alive = false; };
    }, [userId, balanceKey, reloadKey]);
    const current = res && key && res.key === key ? res : null;
    return { data: current?.data ?? null, failed: !!current && current.data === null, loading: !!key && !current };
}
