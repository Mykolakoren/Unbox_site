import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useCashboxStore } from '../../../store/cashboxStore';

const COLORS = ['#476D6B', '#2C3240', '#E57373', '#FFB74D', '#81C784', '#64B5F6', '#BA68C8', '#90A4AE'];

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
            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-unbox-light/50 shadow-sm">
                <h3 className="font-bold text-lg mb-1 text-unbox-dark">Динамика кассы</h3>
                <p className="text-xs text-gray-500 mb-6">
                    Приход: <span className="font-medium text-green-700">{totalIncome.toFixed(2)} ₾</span>
                    {' / '}
                    Расход: <span className="font-medium text-red-600">{totalExpense.toFixed(2)} ₾</span>
                </p>
                <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#476D6B" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#476D6B" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#E57373" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#E57373" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                                dy={10}
                                tickFormatter={(v: string) => v.slice(5)} // MM-DD
                            />
                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9CA3AF' }} />
                            <Tooltip
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}
                                formatter={(value: any, name: any) => [
                                    `${Number(value).toFixed(2)} ₾`,
                                    name === 'income' ? 'Приход' : 'Расход',
                                ]}
                            />
                            <Area
                                type="monotone"
                                dataKey="income"
                                stroke="#476D6B"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorIncome)"
                                activeDot={{ r: 5, strokeWidth: 0, fill: '#476D6B' }}
                            />
                            <Area
                                type="monotone"
                                dataKey="expense"
                                stroke="#E57373"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorExpense)"
                                activeDot={{ r: 5, strokeWidth: 0, fill: '#E57373' }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Expense Breakdown Pie Chart */}
            <div className="bg-white p-6 rounded-2xl border border-unbox-light/50 shadow-sm flex flex-col">
                <h3 className="font-bold text-lg mb-2 text-unbox-dark">Расходы по категориям</h3>
                <p className="text-xs text-gray-500 mb-4">За выбранный период</p>
                {categoryBreakdown.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
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
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}
                                    formatter={(value: any) => [`${Number(value).toFixed(2)} ₾`]}
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
