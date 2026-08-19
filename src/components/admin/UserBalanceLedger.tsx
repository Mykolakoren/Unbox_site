import { useEffect, useState } from 'react';
import { Wallet, AlertTriangle, Check } from 'lucide-react';
import { ru } from 'date-fns/locale';
import { usersApi, type BalanceLedgerResponse } from '../../api/users';
import { parseUTC, formatBatumi } from '../../utils/dateUtils';

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
 */

const REASON_LABELS: Record<string, string> = {
    topup: 'Пополнение',
    baseline: 'Стартовый остаток',
    booking_charge: 'Списание за бронь',
    booking_refund: 'Возврат за бронь',
    booking_charge_revert: 'Откат списания',
    extend_charge: 'Доплата за продление',
    extras_charge: 'Допы',
    shorten_refund: 'Возврат за сокращение',
    weekly_rebate: 'Недельная скидка',
    consecutive_recompute: 'Пересчёт «часы подряд»',
    correction: 'Ручная корректировка',
    merge: 'Перенос со склеенного профиля',
    subscription_purchase: 'Оплата абонемента',
    booking_to_subscription: 'Бронь переведена на абонемент',
    double_charge_refund: 'Возврат двойного списания',
};

export function UserBalanceLedger({ userId }: { userId: string }) {
    const [data, setData] = useState<BalanceLedgerResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        usersApi.getBalanceLedger(userId)
            .then((res) => { if (alive) { setData(res); setError(null); } })
            .catch(() => { if (alive) setError('Не удалось загрузить ленту'); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [userId]);

    if (loading) {
        return (
            <div className="bg-white p-6 rounded-2xl border border-gray-200 text-sm text-gray-400">
                Загружаю движения баланса…
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="bg-white p-6 rounded-2xl border border-gray-200 text-sm text-gray-500">
                {error || 'Нет данных'}
            </div>
        );
    }

    const { entries, balance, ledgerSum, reconciles, truncated } = data;
    const diff = Math.round((ledgerSum - balance) * 100) / 100;

    return (
        <div className="bg-white p-6 rounded-2xl border border-gray-200">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-1">
                <h3 className="font-bold text-lg flex items-center gap-2">
                    <Wallet size={20} className="text-gray-400" />
                    Движения баланса
                </h3>
                <span className="text-xs text-gray-400">
                    {entries.length} {entries.length === 1 ? 'запись' : 'записей'}
                    {truncated && ' (показаны последние)'}
                </span>

                {reconciles === true && (
                    <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-green-100 text-green-700">
                        <Check size={11} /> Сходится с балансом
                    </span>
                )}
                {reconciles === false && (
                    <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-700">
                        <AlertTriangle size={11} /> Расхождение {diff > 0 ? '+' : ''}{diff} ₾
                    </span>
                )}
            </div>

            <p className="text-xs text-gray-400 mb-5">
                Всё, что двигало депозит клиента: списания за брони, возвраты, скидки,
                пополнения и правки. Баланс сейчас — {balance} ₾.
            </p>

            {entries.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-xl text-gray-500 text-sm">
                    Движений по балансу пока не было
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-xs text-gray-400 border-b border-gray-100">
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
                                const label = REASON_LABELS[e.reason] || e.reason;
                                return (
                                    <tr
                                        key={e.id}
                                        className="hover:bg-gray-50/50 border-b border-gray-50 last:border-0 transition-colors"
                                    >
                                        <td className="py-3 pl-2 align-top whitespace-nowrap">
                                            <div className="font-medium text-gray-900">
                                                {d ? formatBatumi(d, 'd MMM yyyy', ru) : '—'}
                                            </div>
                                            <div className="text-xs text-gray-400">
                                                {d ? formatBatumi(d, 'HH:mm') : ''}
                                            </div>
                                        </td>
                                        <td className="py-3 align-top text-right whitespace-nowrap tabular-nums">
                                            <span className={`font-bold ${isNegative ? 'text-red-600' : 'text-green-700'}`}>
                                                {isNegative ? '' : '+'}{e.delta.toFixed(2)} ₾
                                            </span>
                                        </td>
                                        <td className="py-3 align-top text-right whitespace-nowrap tabular-nums text-gray-500">
                                            {e.balanceAfter.toFixed(2)} ₾
                                        </td>
                                        <td className="py-3 pl-4 align-top">
                                            <div className="text-gray-900">{label}</div>
                                            {e.description && e.description !== label && (
                                                <div className="text-xs text-gray-400">{e.description}</div>
                                            )}
                                        </td>
                                        <td className="py-3 pr-2 align-top text-right text-xs text-gray-400 whitespace-nowrap">
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
