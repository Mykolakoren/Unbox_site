import { Wallet, Banknote, CreditCard, Landmark } from 'lucide-react';
import { useCashboxStore } from '../../../store/cashboxStore';
import { useMemo } from 'react';
import type { CashboxTransaction, CashboxPeriodSummary } from '../../../api/cashbox';
import { formatGel, formatTime } from '../../../utils/format';
import { BATUMI_TZ } from '../../../utils/dateUtils';

interface Props {
    /** Операции выбранного периода и филиала (без фильтра типа журнала).
     *  Запасной расчёт итогов, пока сервер не ответил / если ответ не пришёл. */
    filteredTransactions: CashboxTransaction[];
    /** «22–28 сент.», «сегодня», «сентябрь 2026». */
    periodLabel: string;
    /** «Uni», «One» или «все филиалы». */
    branchLabel?: string;
    /** Итоги периода с сервера (/cashbox/summary) — по ВСЕМ операциям, без корректировок. */
    summary?: CashboxPeriodSummary | null;
    /** Сервер итогов не ответил — показываем запасной расчёт по журналу. */
    summaryFailed?: boolean;
    /** Сервер отдал потолок операций — запасные итоги могут быть неполными. */
    truncated?: boolean;
}

/**
 * Касса «Сейчас → Период» (волна 4, вариант владельца).
 *  1) «Сейчас в кассе на 10:42» — остатки по счетам. От периода НЕ зависят.
 *  2) «За 22–28 сент.: +1 087 ₾ · −38 ₾ · = +1 049 ₾» — итоги периода
 *     из getPeriodSummary (сервер считает все операции, корректировки отдельно).
 */
export function BalanceCard({ filteredTransactions, periodLabel, branchLabel, summary, summaryFailed, truncated }: Props) {
    const { balances } = useCashboxStore();

    // Запасной расчёт (пока нет ответа сервера). Корректировки
    // (payment_method='adjustment': правка баланса клиента, недельная скидка) —
    // бухгалтерские проводки, а не деньги в кассе: в итоги не входят.
    const local = useMemo(() => {
        let income = 0;
        let expense = 0;
        for (const tx of filteredTransactions) {
            if (tx.paymentMethod === 'adjustment') continue;
            if (tx.type === 'income') income += tx.amount;
            else expense += tx.amount;
        }
        return {
            income: Math.round(income * 100) / 100,
            expense: Math.round(expense * 100) / 100,
            net: Math.round((income - expense) * 100) / 100,
        };
    }, [filteredTransactions]);

    const stats = summary
        ? { income: Number(summary.income || 0), expense: Number(summary.expense || 0), net: Number(summary.net || 0) }
        : local;
    const adjCount = summary ? Number(summary.adjustmentCount || 0) : 0;

    const b: any = balances || {};
    const accounts = [
        // Счета различаем значком и подписью, не цветом (Grid House).
        { key: 'cash', label: 'Наличные', value: b.cash ?? 0, icon: Banknote },
        { key: 'tbc', label: 'Карта TBC', value: b.cardTbc ?? b.card_tbc ?? 0, icon: CreditCard },
        { key: 'bog', label: 'Карта BOG', value: b.cardBog ?? b.card_bog ?? 0, icon: Landmark },
        { key: 'total', label: 'Всего на счетах', value: b.balance ?? 0, icon: Wallet },
    ];
    const nowLabel = formatTime(new Date(), { timeZone: BATUMI_TZ });

    return (
        <div className="space-y-6">
            {/* 1. Сейчас — не зависит от периода */}
            <section aria-labelledby="cash-now-title">
                <h2 id="cash-now-title" className="text-small font-semibold text-ink mb-3">
                    Сейчас в кассе на {nowLabel}
                    {branchLabel && <span className="font-normal text-ink-60"> · {branchLabel}</span>}
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-l border-ink-10">
                    {accounts.map(acc => (
                        <div key={acc.key} className="bg-card border-r border-b border-ink-10 p-4 flex items-start gap-3">
                            <acc.icon size={16} className="text-ink-60 mt-0.5 shrink-0" aria-hidden="true" />
                            <div className="min-w-0">
                                <div className="text-caption text-ink-60">{acc.label}</div>
                                <div className={`num text-title font-semibold leading-tight ${Number(acc.value) < 0 ? 'text-[var(--status-danger-fg)]' : 'text-ink'}`}>
                                    {formatGel(Number(acc.value ?? 0))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* 2. Период — цифры со знаком и подписью периода */}
            <section aria-label={`Итоги за ${periodLabel}`} data-testid="cash-period-line">
                <p className="text-body text-ink">
                    <span className="font-semibold">За {periodLabel}:</span>{' '}
                    <span className="num text-[var(--status-ok-fg)]" title="Приход">{formatGel(stats.income, { sign: true, fraction: 0 })}</span>
                    <span className="text-ink-60"> · </span>
                    <span className="num text-[var(--status-danger-fg)]" title="Расход">{formatGel(-stats.expense, { fraction: 0 })}</span>
                    <span className="text-ink-60"> · = </span>
                    <span className="num font-semibold" title="Разница за период">{formatGel(stats.net, { sign: true, fraction: 0 })}</span>
                </p>
                <p className="text-caption text-ink-60 mt-1">
                    приход · расход · разница{branchLabel ? ` · ${branchLabel}` : ''} · без корректировок баланса
                    {adjCount > 0 && ` (их за период ${adjCount} — видны в журнале)`}
                </p>
                {!summary && (summaryFailed || truncated) && (
                    <p className="text-caption text-[var(--status-pending-fg)] font-medium mt-1">
                        {summaryFailed
                            ? 'Итоги с сервера не загрузились — посчитали по журналу ниже.'
                            : 'Операций больше, чем загрузилось, — итог неполный. Выберите период короче.'}
                    </p>
                )}
            </section>
        </div>
    );
}
