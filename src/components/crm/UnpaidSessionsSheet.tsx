import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBar } from '../ui/ErrorBar';
import { SkeletonList } from '../ui/Skeleton';
import { useConfirmDialog } from '../ui/ConfirmDialogProvider';
import { crmApi, type CrmClient, type CrmSession } from '../../api/crm';
import { useCrmStore } from '../../store/crmStore';
import { toastApiError } from '../../utils/errors';
import { formatDateLabel, formatMoney } from '../../utils/format';
import { utcNaiveToTbilisi } from '../../utils/crmNextSession';
import { partialPayment, sessionDebt } from '../../utils/sessionMoney';

/**
 * UnpaidSessionsSheet — «Долг клиента» (волна 3, шаг 0). Телефон и компьютер.
 *
 *   <UnpaidSessionsSheet open={open} onClose={…} client={client} onChanged={reload} />
 *
 * - Список — прошедшие неоплаченные сессии клиента (тот же отбор, что у
 *   сервера в mark-all-paid: не оплачена, не отменена, время уже наступило).
 * - «Отметить оплату · 140 ₾» у строки — ТОЛЬКО quickPaySession из стора:
 *   тот же путь, что в CrmClientDetail / шторке сессии (платёж пишется на
 *   счёт клиента по умолчанию), а повторный тап ловит _quickPayInFlight
 *   в сторе плюс блок кнопки здесь.
 * - «Отметить все (N) · 280 ₾» — существующий markAllPaid с тем же вопросом,
 *   что в десктопной карточке клиента.
 * - Суммы — раздельно по валютам («280 ₾ + 50 $»), без пересчёта.
 * - После любой оплаты — onChanged(): родитель перечитывает свои данные.
 */
export interface UnpaidSessionsSheetProps {
    open: boolean;
    onClose: () => void;
    client: CrmClient;
    /** Сессии клиента, если уже загружены. Нет — загрузим сами. */
    sessions?: CrmSession[];
    /** Что-то оплатили — родителю пора обновить долг/список. */
    onChanged?: () => void;
}

const CANCELLED = new Set(['CANCELLED_CLIENT', 'CANCELLED_THERAPIST']);

function utcMs(date: string): number {
    return new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(date) ? date : `${date}Z`).getTime();
}

/** Сколько осталось по сессии: цена минус уже внесённое (remaining с сервера), в её валюте. */
function amountOf(s: CrmSession, client: CrmClient): { amount: number; currency: string } {
    return sessionDebt(s, client);
}

/** «280 ₾ + 50 $» — по валютам, без пересчёта. */
function totalsLabel(items: { amount: number; currency: string }[]): string {
    const by = new Map<string, number>();
    for (const it of items) by.set(it.currency, (by.get(it.currency) ?? 0) + it.amount);
    return [...by.entries()]
        .filter(([, v]) => v > 0)
        .map(([cur, v]) => formatMoney(Math.round(v * 100) / 100, { currency: cur }))
        .join(' + ');
}

export function UnpaidSessionsSheet({ open, onClose, client, sessions: sessionsProp, onChanged }: UnpaidSessionsSheetProps) {
    const quickPaySession = useCrmStore(s => s.quickPaySession);
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    const { confirm } = useConfirmDialog();

    const [loaded, setLoaded] = useState<CrmSession[] | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [loading, setLoading] = useState(false);
    const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const [markingAll, setMarkingAll] = useState(false);
    const markingRef = useRef(false);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(false);
        try {
            setLoaded(await crmApi.getSessions({ clientId: client.id }));
        } catch {
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    }, [client.id]);

    useEffect(() => {
        if (!open) return;
        setPaidIds(new Set());
        setBusyIds(new Set());
        if (!sessionsProp) { setLoaded(null); load(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, client.id]);

    const source = sessionsProp ?? loaded;
    const unpaid = useMemo(() => {
        if (!source) return null;
        const now = Date.now();
        return source
            .filter(s => s.clientId === client.id && !s.isPaid && !CANCELLED.has(s.status)
                && utcMs(s.date) <= now && !paidIds.has(s.id))
            .sort((a, b) => utcMs(a.date) - utcMs(b.date));
    }, [source, client.id, paidIds]);

    const total = unpaid ? totalsLabel(unpaid.map(s => amountOf(s, client))) : '';

    const payOne = async (s: CrmSession) => {
        if (busyIds.has(s.id) || markingRef.current) return;
        setBusyIds(prev => new Set(prev).add(s.id));
        try {
            const res = await quickPaySession(s.id);
            setPaidIds(prev => new Set(prev).add(s.id));
            const addedNow = res.added ?? res.amount;
            toast.success(addedNow
                ? `Оплата отмечена: ${formatMoney(addedNow, { currency: res.currency || 'GEL' })}`
                : 'Оплата отмечена');
            onChanged?.();
        } catch {
            // Тост об ошибке уже показал стор (quickPaySession).
        } finally {
            setBusyIds(prev => { const n = new Set(prev); n.delete(s.id); return n; });
        }
    };

    const payAll = async () => {
        if (!unpaid?.length || markingRef.current) return;
        const n = unpaid.length;
        // Тот же вопрос, что в десктопной карточке клиента (CrmClientDetail).
        const ok = await confirm({
            title: `Отметить оплату всех сессий с долгом (${n})?`,
            message: 'Будущие сессии не трогаем — только прошедшие без оплаты.',
            confirmLabel: `Отметить оплату (${n})`,
            cancelLabel: 'Оставить',
        });
        if (!ok) return;
        markingRef.current = true;
        setMarkingAll(true);
        try {
            const result = await crmApi.markAllPaid(client.id);
            toast.success(`Оплата отмечена: ${result.marked}`);
            setPaidIds(prev => { const next = new Set(prev); unpaid.forEach(s => next.add(s.id)); return next; });
            onChanged?.();
            onClose();
        } catch (e) {
            toastApiError(e, 'Не удалось отметить оплату');
        } finally {
            markingRef.current = false;
            setMarkingAll(false);
        }
    };

    const anyBusy = markingAll || busyIds.size > 0;

    return (
        <Sheet
            open={open}
            onClose={() => { if (!markingAll) onClose(); }}
            title="Неоплаченные сессии"
            description={total ? `${client.name} · долг ${total}` : client.name}
            width={480}
            footer={unpaid && unpaid.length > 1 ? (
                <>
                    <Button block loading={markingAll} disabled={anyBusy || viewingOther} onClick={payAll}>
                        {`Отметить все (${unpaid.length})${total ? ` · ${total}` : ''}`}
                    </Button>
                    <Button block variant="secondary" disabled={markingAll} onClick={onClose}>
                        Закрыть
                    </Button>
                </>
            ) : undefined}
        >
            {unpaid === null ? (
                loadError && !loading
                    ? <ErrorBar message="Не удалось загрузить сессии клиента" onRetry={load} />
                    : <SkeletonList count={3} cardHeight={56} label="Загружаем сессии" />
            ) : unpaid.length === 0 ? (
                <EmptyState compact title="Долгов нет" hint="Все прошедшие сессии этого клиента оплачены." />
            ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Сессии без оплаты">
                    {unpaid.map(s => {
                        const w = utcNaiveToTbilisi(s.date);
                        const { amount, currency } = amountOf(s, client);
                        const money = formatMoney(amount, { currency });
                        const partial = partialPayment(s, client);
                        return (
                            <li
                                key={s.id}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                                    padding: '12px 0', borderBottom: '1px solid var(--color-ink-10)',
                                }}
                            >
                                <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                    <div style={{ fontWeight: 500 }}>
                                        {w ? formatDateLabel(w.date, { capitalize: true, withYear: 'auto' }) : '—'}
                                    </div>
                                    <div className="num" style={{ fontSize: 'var(--text-small)', color: 'var(--color-ink-60)' }}>
                                        {w?.time ?? ''}{s.durationMinutes ? ` · ${s.durationMinutes} мин` : ''}
                                    </div>
                                    {partial && (
                                        <div className="num" style={{ fontSize: 'var(--text-small)', color: 'var(--color-ink-60)' }}>
                                            {`Оплачено ${formatMoney(partial.paid, { currency })} из ${formatMoney(partial.price, { currency })}`}
                                        </div>
                                    )}
                                </div>
                                <Button
                                    variant="secondary"
                                    loading={busyIds.has(s.id)}
                                    disabled={markingAll || viewingOther}
                                    onClick={() => payOne(s)}
                                >
                                    {partial ? `Доплатить · ${money}` : amount > 0 ? `Отметить оплату · ${money}` : 'Отметить оплату'}
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Sheet>
    );
}
