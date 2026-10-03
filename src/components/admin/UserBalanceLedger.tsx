import { useEffect, useState } from 'react';
import { Wallet, AlertTriangle, Check } from 'lucide-react';
import { usersApi, type BalanceLedgerResponse } from '../../api/users';
import { parseUTC, BATUMI_TZ } from '../../utils/dateUtils';
import { formatDayMonth, formatGel, formatTime } from '../../utils/format';
import { ruCountWord } from '../../utils/plural';
import { REASON_LABELS } from '../../utils/ledgerReasons';
import { ledgerRowLine, allocationHeadline } from '../../utils/balanceAllocation';
import { useClientAllocation } from '../../hooks/useBalanceAllocation';
import { SkeletonList } from '../ui/Skeleton';
import { ErrorBar } from '../ui/ErrorBar';
import { EmptyState } from '../ui/EmptyState';

/**
 * Лента движений баланса клиента.
 *
 * Сверка 19.08.2026 (Лиза): в карточке клиента был только блок кассовых
 * операций, и у Кристины Ропель он писал «Операций по счету не найдено» при
 * десятках строк в ленте. Списания за брони, возвраты, недельные скидки и
 * продления не показывались нигде — админ не мог свести баланс и сверял по
 * своему Excel, а расхождения списывались на «ошибку системы».
 *
 * Это ДРУГОЙ срез, чем кассовые операции: касса — про живые деньги в кассе,
 * лента — про депозит клиента. Инвариант «сумма ленты == баланс» показываем
 * прямо в шапке: если он сломан, значит баланс правили мимо кошелька.
 *
 * 03.10 (владелец: «чтобы на балансе было видно, что было начислено и куда
 * списалось»): под каждой строкой — серая строка раскладки ленты (самые старые
 * деньги — самым ранним броням): у начисления «ушло на: 05.10 14:00 Каб. 2 — 9 ₾»
 * / «на балансе: 5 ₾», у списания «из: скидка за неделю 9 ₾ + оплата 30.09 11 ₾»
 * / «в долг 20 ₾ → закрыто оплатой 05.10» / «в долг 20 ₾ — ещё не оплачено».
 * Сверху — сводка: из чего плюс на балансе и что он покроет, или из чего долг.
 */

export function UserBalanceLedger({ userId }: { userId: string }) {
    const [data, setData] = useState<BalanceLedgerResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [reloadTick, setReloadTick] = useState(0);
    // Раскладка — тем же ключом, что лента: баланс из ответа ленты (после оплаты
    // карточка перечитывает ленту — раскладка перечитается вместе с ней).
    const { data: alloc } = useClientAllocation(data ? userId : null, data ? data.balance : null, reloadTick);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        usersApi.getBalanceLedger(userId)
            .then((res) => { if (alive) { setData(res); setError(null); } })
            .catch(() => { if (alive) setError('Не удалось загрузить ленту'); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [userId, reloadTick]);

    if (loading) {
        return (
            <div className="bg-white p-6 rounded-2xl border border-gray-200">
                <SkeletonList count={3} cardHeight={56} label="Загружаем движения баланса" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="bg-white p-6 rounded-2xl border border-gray-200">
                <ErrorBar message={error || 'Не удалось загрузить ленту'} onRetry={() => setReloadTick(t => t + 1)} />
            </div>
        );
    }

    const { entries, balance, ledgerSum, reconciles, truncated } = data;
    const diff = Math.round((ledgerSum - balance) * 100) / 100;
    const allocRows = new Map((alloc && alloc.consistent ? alloc.rows : []).map(r => [r.id, r]));
    const headline = allocationHeadline(alloc);

    return (
        <div className="bg-white p-6 rounded-2xl border border-gray-200">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-1">
                <h3 className="font-bold text-lg flex items-center gap-2">
                    <Wallet size={20} className="text-ink-60" aria-hidden="true" />
                    Движения баланса
                </h3>
                <span className="text-xs text-ink-60">
                    {ruCountWord(entries.length, ['запись', 'записи', 'записей'])}
                    {truncated && ' (показаны последние)'}
                </span>

                {reconciles === true && (
                    <span className="ml-auto ui-badge ui-badge--ok">
                        <Check size={14} aria-hidden="true" /> Сходится с балансом
                    </span>
                )}
                {reconciles === false && (
                    <span className="ml-auto ui-badge ui-badge--danger">
                        <AlertTriangle size={14} aria-hidden="true" /> Расхождение {formatGel(diff, { sign: true })}
                    </span>
                )}
            </div>

            <p className="text-xs text-ink-60 mb-3">
                Всё, что двигало депозит клиента: списания за брони, возвраты, скидки,
                пополнения и правки. Баланс сейчас — <span className="num">{formatGel(balance)}</span>.
            </p>
            {headline && (
                <p data-alloc-headline className="text-sm text-unbox-dark mb-5 leading-snug">{headline}</p>
            )}

            {entries.length === 0 ? (
                <EmptyState compact title="Движений по балансу пока не было" />
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-xs text-ink-60 border-b border-gray-100">
                                <th className="font-medium py-3 pl-2">Дата</th>
                                <th className="font-medium py-3 text-right">Сумма</th>
                                <th className="font-medium py-3 text-right">Стало</th>
                                <th className="font-medium py-3 pl-4">За что</th>
                                <th className="font-medium py-3 pr-2 text-right">Кто</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {entries.map((e) => {
                                const d = e.date ? parseUTC(e.date) : null;
                                const isNegative = e.delta < 0;
                                const label = REASON_LABELS[e.reason] || (e.reason ? `Прочее (${e.reason})` : 'Прочее');
                                const allocLine = ledgerRowLine(allocRows.get(e.id));
                                return (
                                    <tr
                                        key={e.id}
                                        className="hover:bg-gray-50/50 border-b border-gray-50 last:border-0 transition-colors"
                                    >
                                        <td className="py-3 pl-2 align-top whitespace-nowrap">
                                            <div className="font-medium text-gray-900">
                                                {d ? formatDayMonth(d, { timeZone: BATUMI_TZ, withYear: 'auto' }) : '—'}
                                            </div>
                                            <div className="text-xs text-ink-60">
                                                {d ? formatTime(d, { timeZone: BATUMI_TZ }) : ''}
                                            </div>
                                        </td>
                                        <td className="py-3 align-top text-right whitespace-nowrap num">
                                            <span className={`font-bold ${isNegative ? 'text-[var(--status-danger-fg)]' : 'text-[var(--status-ok-fg)]'}`}>
                                                {formatGel(e.delta, { sign: true })}
                                            </span>
                                        </td>
                                        <td className="py-3 align-top text-right whitespace-nowrap num text-gray-500">
                                            {formatGel(e.balanceAfter)}
                                        </td>
                                        <td className="py-3 pl-4 align-top">
                                            <div className="text-gray-900">{label}</div>
                                            {e.description && e.description !== label && (
                                                <div className="text-xs text-ink-60">{e.description}</div>
                                            )}
                                            {allocLine && (
                                                <div data-alloc-line className="text-xs text-ink-60 mt-0.5 leading-snug">{allocLine}</div>
                                            )}
                                        </td>
                                        <td className="py-3 pr-2 align-top text-right text-xs text-ink-60 whitespace-nowrap">
                                            {e.actorName || '—'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
