import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { CashboxAnalytics as CashboxAnalyticsData } from '../../../api/cashbox';
import { COLOR, SHADOW, STATUS } from '../../../design/tokens';
import { formatDayMonthShort, formatDayMonth, formatGel } from '../../../utils/format';

interface Props {
    /** Аналитика периода УЖЕ без корректировок (см. cashMoney.excludeAdjustments). */
    analytics: CashboxAnalyticsData | null;
    /** «22–28 сент.» — тот же период, что в итогах наверху страницы. */
    periodLabel: string;
}

/**
 * «Динамика кассы» и «Расходы по категориям» за выбранный период (волна 4).
 * Раньше: сглаженные кривые за последние 30 дней при любом выбранном периоде
 * и подпись «За выбранный период» (G7-admin-core-M3, G7-19). Теперь — столбики
 * по дням ровно за период из фильтра; корректировки не считаются деньгами (N2).
 * Сервер считает аналитику по всей сети — так и подписываем: «все филиалы».
 */
export function CashboxAnalytics({ analytics, periodLabel }: Props) {
    if (!analytics) return null;

    const { dailyData, categoryBreakdown, totalIncome, totalExpense } = analytics;

    if (dailyData.length === 0 && categoryBreakdown.length === 0) {
        return <p className="text-small text-ink-60">За {periodLabel} движения денег нет.</p>;
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Приход и расход по дням */}
            <div className="lg:col-span-2 bg-card p-6 border border-ink-10">
                <h3 className="font-semibold text-title mb-1 text-ink">Динамика кассы</h3>
                <p className="text-small text-ink-60 mb-6">
                    За {periodLabel} · все филиалы · без корректировок ·{' '}
                    приход <span className="font-medium num text-[var(--status-ok-fg)]">{formatGel(totalIncome ?? 0, { sign: true })}</span>
                    {', '}
                    расход <span className="font-medium num text-[var(--status-danger-fg)]">{formatGel(-(totalExpense ?? 0))}</span>
                </p>
                <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLOR.ink10} />
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 12, fill: COLOR.ink60 }}
                                dy={10}
                                tickFormatter={(v: string) => formatDayMonthShort(v)} // «30 авг.», было «08-30»
                            />
                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: COLOR.ink60 }} />
                            <Tooltip
                                contentStyle={{ border: `1px solid ${COLOR.ink10}`, boxShadow: SHADOW.pop }}
                                labelFormatter={(label: any) => formatDayMonth(String(label))}
                                formatter={(value: any, name: any) => [
                                    formatGel(Number(value)),
                                    name === 'income' ? 'Приход' : 'Расход',
                                ]}
                            />
                            <Bar dataKey="income" fill={STATUS.ok.fg} radius={[2, 2, 0, 0]} />
                            <Bar dataKey="expense" fill={STATUS.danger.fg} radius={[2, 2, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Расходы по категориям — список с суммами и долями, без «бублика без цифр» */}
            <div className="bg-card p-6 border border-ink-10 flex flex-col">
                <h3 className="font-semibold text-title mb-1 text-ink">Расходы по категориям</h3>
                <p className="text-small text-ink-60 mb-4">За {periodLabel} · все филиалы</p>
                {categoryBreakdown.length === 0 ? (
                    <p className="text-small text-ink-60">Расходов за период нет.</p>
                ) : (
                    <ul className="space-y-3">
                        {categoryBreakdown.map(c => (
                            <li key={c.categoryName}>
                                <div className="flex justify-between gap-3 text-small">
                                    <span className="text-ink truncate">{c.categoryName}</span>
                                    <span className="num text-ink whitespace-nowrap">
                                        {formatGel(c.total, { fraction: 0 })} <span className="text-ink-60">· {c.percentage}%</span>
                                    </span>
                                </div>
                                <div className="mt-1 h-1.5 bg-sunken" aria-hidden="true">
                                    <div className="h-full bg-ink-60" style={{ width: `${Math.min(100, c.percentage)}%` }} />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
