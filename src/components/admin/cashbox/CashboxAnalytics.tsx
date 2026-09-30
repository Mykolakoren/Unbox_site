import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useCashboxStore } from '../../../store/cashboxStore';
import { COLOR, SHADOW, STATUS } from '../../../design/tokens';
import { formatDayMonth, formatGel } from '../../../utils/format';

// Категории — монохром + бирюза (wave 1): без радуги красного/синего/фиолетового.
// Различаем оттенком, а точные суммы — в подсказке и легенде.
const COLORS = [COLOR.accent, COLOR.ink, COLOR.ink60, COLOR.ink30, COLOR.accentHover, COLOR.ink80, COLOR.ink40, COLOR.ink20];

export function CashboxAnalytics() {
    const { analytics } = useCashboxStore();

    if (!analytics) return null;

    const { dailyData, categoryBreakdown, totalIncome, totalExpense } = analytics;

    if (dailyData.length === 0 && categoryBreakdown.length === 0) {
        return null;
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Income vs Expense Area Chart */}
            <div className="lg:col-span-2 bg-card p-6 rounded-2xl border border-unbox-light/50">
                <h3 className="font-bold text-lg mb-1 text-unbox-dark">Динамика кассы</h3>
                <p className="text-xs text-gray-500 mb-6">
                    Приход: <span className="font-medium num text-[var(--status-ok-fg)]">{formatGel(totalIncome ?? 0)}</span>
                    {' / '}
                    Расход: <span className="font-medium num text-[var(--status-danger-fg)]">{formatGel(totalExpense ?? 0)}</span>
                </p>
                <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={STATUS.ok.fg} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={STATUS.ok.fg} stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={STATUS.danger.fg} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={STATUS.danger.fg} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLOR.ink10} />
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 12, fill: COLOR.ink60 }}
                                dy={10}
                                tickFormatter={(v: string) => formatDayMonth(v)} // «30 августа», было «08-30»
                            />
                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: COLOR.ink60 }} />
                            <Tooltip
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: SHADOW.pop }}
                                labelFormatter={(label: any) => formatDayMonth(String(label))}
                                formatter={(value: any, name: any) => [
                                    formatGel(Number(value)),
                                    name === 'income' ? 'Приход' : 'Расход',
                                ]}
                            />
                            <Area
                                type="monotone"
                                dataKey="income"
                                stroke={STATUS.ok.fg}
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorIncome)"
                                activeDot={{ r: 5, strokeWidth: 0, fill: STATUS.ok.fg }}
                            />
                            <Area
                                type="monotone"
                                dataKey="expense"
                                stroke={STATUS.danger.fg}
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorExpense)"
                                activeDot={{ r: 5, strokeWidth: 0, fill: STATUS.danger.fg }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Expense Breakdown Pie Chart */}
            <div className="bg-card p-6 rounded-2xl border border-unbox-light/50 flex flex-col">
                <h3 className="font-bold text-lg mb-2 text-unbox-dark">Расходы по категориям</h3>
                <p className="text-xs text-gray-500 mb-4">За выбранный период</p>
                {categoryBreakdown.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-ink-60 text-sm">
                        Нет данных
                    </div>
                ) : (
                    <div className="flex-1 min-h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={categoryBreakdown}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={55}
                                    outerRadius={75}
                                    paddingAngle={4}
                                    dataKey="total"
                                    nameKey="categoryName"
                                    stroke="none"
                                >
                                    {categoryBreakdown.map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: SHADOW.pop }}
                                    formatter={(value: any) => [formatGel(Number(value))]}
                                />
                                <Legend
                                    verticalAlign="bottom"
                                    height={36}
                                    iconType="circle"
                                    formatter={(value) => <span className="text-xs font-medium text-gray-700 ml-1">{value}</span>}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}
