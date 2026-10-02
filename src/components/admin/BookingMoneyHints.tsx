import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { createIncomeWithDuplicateGuard, isDuplicateDeclined } from '../../utils/cashboxDuplicate';
import { paymentErrorText } from '../../utils/errors';
import { useUserStore } from '../../store/userStore';
import type { BookingHistoryItem, User } from '../../store/types';
import { dueLabel, type DueInfo } from '../../utils/dueAmounts';
import { AddFundsModal } from './modals/AddFundsModal';
import { formatDayMonth, formatGel } from '../../utils/format';
import { parseUTC, BATUMI_TZ } from '../../utils/dateUtils';
import { Button } from '../ui/Button';
import { cashBranchOfBooking } from '../../utils/cashBranch';

type Estimate = Awaited<ReturnType<typeof bookingsApi.getWeeklyEstimate>>;

const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace('.', ',');

/**
 * Денежные подсказки в попапе брони шахматки (просьба Егора 21.09):
 *  - ориентировочная цена с учётом недельной скидки за объём — она приходит
 *    кредитом в понедельник и в цене брони её не видно;
 *  - баланс клиента и кнопка «Принять оплату» — то же пополнение через кассу,
 *    что в карточке клиента, без перехода в неё.
 */
/**
 * Откуда взялась оплата брони — одной строкой (просьба владельца 02.10, случай
 * Тамрико: бронь «оплачено», а свежего платежа нет — деньги списаны с баланса,
 * внесённого раньше). Только подпись, суммы не считаем.
 */
export function paymentSourceLine(b: BookingHistoryItem, due?: DueInfo): string | null {
    const status = b.paymentStatus;
    const method = String(b.paymentMethod || '');
    if (!status || method === 'service') return null;
    if (status === 'waived') return `Штраф снят${b.waiverReason ? ` · ${b.waiverReason}` : ''}`;
    if (status === 'pending') return 'Спишется с баланса за 24 ч до начала';
    // paid
    const when = b.chargedAt ? formatDayMonth(parseUTC(b.chargedAt), { timeZone: BATUMI_TZ }) : '';
    const amount = b.chargeAmount != null ? ` · ${formatGel(b.chargeAmount)}` : '';
    if (method === 'subscription') return `Списано часами абонемента${when ? ` ${when}` : ''}`;
    if (method === 'bonus') return `Списано бонусным часом${when ? ` ${when}` : ''}`;
    // Бронь списана с баланса, но баланс в минусе (клиент должен): деньги НЕ получены.
    // 02.10: админ увидел «Оплачено с баланса» у брони Марии Кирдун, а клиент не платил.
    if (due && due.due > 0) return `Списано с баланса${when ? ` ${when}` : ''}${amount} · клиент ещё не оплатил`;
    return `Списано с баланса${when ? ` ${when}` : ''}${amount}`;
}

export function BookingMoneyHints({ booking, due }: { booking: BookingHistoryItem; due?: DueInfo }) {
    const users = useUserStore(s => s.users);
    const client = users.find(u => u.email === booking.userId || u.id === booking.userId);
    const [est, setEst] = useState<Estimate | null>(null);

    useEffect(() => {
        let cancelled = false;
        setEst(null);
        // Абонемент/обслуживание — недельная скидка к ним не применяется.
        const pm = String(booking.paymentMethod || '');
        if (pm === 'subscription' || pm === 'service') return;
        bookingsApi.getWeeklyEstimate(booking.id)
            .then(r => { if (!cancelled) setEst(r); })
            .catch(() => { /* подсказка необязательная */ });
        return () => { cancelled = true; };
    }, [booking.id, booking.paymentMethod]);

    const balance = client?.balance ?? null;
    const debt = balance !== null && balance < 0 ? -balance : 0;
    const price = booking.finalPrice ?? 0;
    const suggested = debt > 0 ? debt : (booking.paymentStatus === 'pending' ? price : 0);
    const suggestedHint = debt > 0
        ? `Подставлен долг клиента: ${formatGel(debt)}`
        : booking.paymentStatus === 'pending' && price > 0
            ? `Подставлена цена брони: ${formatGel(price)} (спишется с баланса за сутки до начала)`
            : undefined;

    // Долга по этой брони нет («оплачено» / «покрыто балансом») — кнопка рядом с
    // балансом не «Принять оплату» (админ принимал деньги за уже оплаченную с
    // баланса бронь), а «Пополнить баланс». Подсказка в окне — про предоплату;
    // если у клиента всё же минус на балансе, остаётся подсказка про долг.
    const noDebtOnBooking = !!due && due.due <= 0;
    const payLabel = noDebtOnBooking ? 'Пополнить баланс' : undefined;
    const payHint = noDebtOnBooking && debt <= 0
        ? 'Долга по этой брони нет — это предоплата, деньги лягут на баланс клиента'
        : suggestedHint;

    let weeklyLine: string | null = null;
    if (est && est.applies) {
        if (est.tierPercent > 0 && est.bookingRebate > 0) {
            weeklyLine = `≈ ${formatGel(est.bookingNetEstimate)} после недельной скидки ${est.tierPercent}% `
                + `(вернётся ${formatGel(est.bookingRebate)} в понедельник; за неделю ${fmt(est.totalHours)} ч)`;
        } else if (est.tierPercent > 0) {
            weeklyLine = `Неделя ${fmt(est.totalHours)} ч — скидка ${est.tierPercent}%, по этой брони уже учтена`;
        } else if (est.nextTierPercent) {
            weeklyLine = `Недельной скидки пока нет: ${fmt(est.totalHours)} ч за неделю, `
                + `ещё ${fmt(est.hoursToNextTier ?? 0)} ч — и будет ${est.nextTierPercent}%`;
        }
        if (weeklyLine && est.tierPercent > 0 && est.nextTierPercent) {
            weeklyLine += `. До ${est.nextTierPercent}% — ещё ${fmt(est.hoursToNextTier ?? 0)} ч`;
        }
    }

    const payLine = paymentSourceLine(booking, due);

    const rebateLine = est?.lastRebate && est.lastRebate.amount > 0
        ? `в т.ч. недельная скидка +${formatGel(est.lastRebate.amount)} от ${formatDayMonth(est.lastRebate.date)} — уже на балансе`
        : null;

    return (
        <>
            {due && (
                <div className="flex justify-between gap-3">
                    <span className="text-ink-60 shrink-0">К оплате</span>
                    <span className={`font-semibold text-right ${due.due > 0 ? 'text-[var(--status-danger-fg)]' : 'text-[var(--status-ok-fg)]'}`}
                        title="Считается из баланса клиента: долг — за самые свежие списанные брони, плюс на балансе (недельная скидка, предоплата) покрывает ближайшие брони.">
                        {due.due > 0 ? `${formatGel(due.due)}` : dueLabel(due)}
                        {due.due > 0 && due.due < due.price && (
                            <span className="block text-xs font-normal text-ink-60">из {formatGel(due.price)} — часть уже на балансе</span>
                        )}
                        {rebateLine && <span className="block text-xs font-normal text-[var(--status-ok-fg)]">{rebateLine}</span>}
                    </span>
                </div>
            )}
            {payLine && (
                <div className="flex justify-between gap-3">
                    <span className="text-ink-60 shrink-0">Оплата</span>
                    <span className="font-medium text-unbox-dark text-right">{payLine}</span>
                </div>
            )}
            {weeklyLine && (
                <div className="flex justify-between gap-3">
                    <span className="text-ink-60 shrink-0">С недельной</span>
                    <span className="font-medium text-unbox-dark text-right" title="Недельная скидка за объём начисляется кредитом на баланс в понедельник за прошлую неделю. Здесь — ориентир по уже записанным часам недели.">
                        {weeklyLine}
                    </span>
                </div>
            )}
            {client && balance !== null && (
                <div className="flex justify-between items-center gap-3">
                    <span className="text-ink-60 shrink-0">Баланс</span>
                    <span className="flex items-center gap-2">
                        <span className={`font-medium ${balance < 0 ? 'text-[var(--status-danger-fg)]' : 'text-unbox-dark'}`}>{formatGel(balance)}</span>
                        <AcceptPaymentButton client={client} defaultAmount={suggested} hint={payHint} label={payLabel} branch={cashBranchOfBooking(booking)} />
                    </span>
                </div>
            )}
        </>
    );
}

/**
 * «Принять оплату» — пополнение баланса клиента через кассу (волна 4: вынесено
 * из BookingMoneyHints, чтобы та же кнопка стояла и в «Сегодня»). handleConfirm
 * перенесён без единой правки: те же поля createTransaction (category_id
 * 'cat-topup', credit_user_balance: true), тот же fetchUsers и тосты. Сумму по
 * умолчанию передаёт экран: в попапе брони — долг или цена брони, в «Сегодня» —
 * весь долг клиента (решение владельца В3).
 *
 * Филиал (доработка 01.10): экран передаёт филиал по кабинету брони
 * (cashBranchOfBooking), окно подставляет его. Не определился — окно не
 * запишет без выбора (requireBranch): приход без филиала не попадает в
 * остаток ни Uni, ни One. onPaid — экрану перечитать свои цифры (строка
 * кассы в «Сегодня»); handleConfirm при этом не меняется.
 */
export function AcceptPaymentButton({
    client, defaultAmount, hint, branch, onPaid, label = 'Принять оплату', appearance = 'chip', className,
}: {
    client: User | null | undefined;
    defaultAmount?: number;
    hint?: string;
    /** Филиал кассы по брони; undefined — админ выберет сам. */
    branch?: string;
    /** После попытки оплаты — перечитать то, что экран показывает сам. */
    onPaid?: () => void;
    label?: ReactNode;
    /** chip — маленькая кнопка в попапе брони; primary/secondary — общая Button. */
    appearance?: 'chip' | 'primary' | 'secondary';
    className?: string;
}) {
    const fetchUsers = useUserStore(s => s.fetchUsers);
    const [payOpen, setPayOpen] = useState(false);

    const handleConfirm = async (amount: number, method: 'cash' | 'tbc' | 'bog', branch?: string) => {
        if (!client) return;
        const methodMap: Record<string, string> = { cash: 'cash', tbc: 'card_tbc', bog: 'card_bog' };
        try {
            // 01.10: через защиту от дубля (409 duplicate_recent → «Записать ещё одну?»).
            await createIncomeWithDuplicateGuard({
                type: 'income',
                amount,
                payment_method: methodMap[method] || 'cash',
                category_id: 'cat-topup',
                description: `Пополнение баланса: ${client.name}`,
                branch: branch || undefined,
                client_id: client.id || client.email,
                credit_user_balance: true,
            } as any);
        } catch (e: any) {
            // Не подтвердили повтор — не ошибка, ничего не пишем и не ругаемся.
            if (isDuplicateDeclined(e)) return;
            toast.error(paymentErrorText(e, 'Не удалось принять оплату'));
            return;
        }
        // Платёж уже записан: сбой обновления списка не должен выглядеть как
        // «оплата не прошла» (01.10 — из-за этого внесли второй раз).
        try { await fetchUsers(); } catch { /* список обновится сам */ }
        toast.success(`Оплата принята: ${formatGel(amount)} на баланс ${client.name}`);
    };

    return (
        <>
            {appearance === 'chip' ? (
                <button
                    type="button"
                    onClick={() => setPayOpen(true)}
                    disabled={!client}
                    className={clsx('px-2.5 py-1 text-xs font-semibold rounded-lg bg-unbox-green/15 text-unbox-dark hover:bg-unbox-green/25 transition-colors', className)}
                >
                    {label}
                </button>
            ) : (
                <Button
                    variant={appearance}
                    size="compact"
                    disabled={!client}
                    className={className}
                    onClick={() => setPayOpen(true)}
                >
                    {label}
                </Button>
            )}
            {/* Портал: попап брони маленький и анимируется (transform) —
                окно внутри него обрезалось бы и позиционировалось криво. */}
            {payOpen && createPortal(
                <div onClick={e => e.stopPropagation()}>
                    <AddFundsModal
                        isOpen={payOpen}
                        onClose={() => setPayOpen(false)}
                        onConfirm={async (amount, method, b) => { await handleConfirm(amount, method, b); onPaid?.(); }}
                        userName={client?.name}
                        defaultAmount={defaultAmount}
                        hint={hint}
                        defaultBranch={branch}
                        requireBranch
                    />
                </div>,
                document.body,
            )}
        </>
    );
}
