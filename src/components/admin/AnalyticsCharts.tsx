import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import { COLOR, SHADOW } from '../../design/tokens';
import { formatDayMonth, formatDayMonthShort, formatGel } from '../../utils/format';

interface AnalyticsChartsProps {
  /** Брони (для «Форматов»). Не переданы / пусто — блок форматов не рисуем. */
  bookings?: any[];
  /** Дневная выручка из кассы. Волна 4 (N2): передавать УЖЕ без корректировок
   *  (cashbox/cashMoney.excludeAdjustments) — недельная скидка и правка баланса
   *  клиента не деньги. */
  revenueDaily?: { date: string; income: number }[];
  /** Период. Не задан — последние 7 дней (как было на /admin). */
  from?: Date;
  to?: Date;
  /** «22–28 сент.» — подпись периода. */
  periodLabel?: string;
}

// Брони — дата приходит как 'YYYY-MM-DD' или 'YYYY-MM-DDT00:00:00' (день брони).
const bookingDay = (b: any) => String(b?.date || '').slice(0, 10);

/**
 * «Выручка по дням» и «Форматы бронирований» — переехали с /admin в «Финансы →
 * Аналитика» (волна 4). Столбики вместо сглаженной кривой (G7-19: изгибы
 * между точками были выдуманы), форматы — числами за тот же период, а не
 * бубликом без цифр «за всё время».
 */
export function AnalyticsCharts({ bookings = [], revenueDaily, from, to, periodLabel }: AnalyticsChartsProps) {
  const range = useMemo(() => {
    const end = startOfDay(to ?? new Date());
    const start = startOfDay(from ?? subDays(end, 6));
    // Защита от «Диапазона» с начала времён: не больше 92 столбиков.
    const safeStart = end.getTime() - start.getTime() > 92 * 86400000 ? subDays(end, 91) : start;
    return { start: safeStart, end };
  }, [from, to]);

  const label = periodLabel || 'последние 7 дней';

  const revenueData = useMemo(() => {
    if (!revenueDaily) return [];
    const byDay = new Map<string, number>();
    for (const d of revenueDaily) byDay.set(d.date, (byDay.get(d.date) || 0) + (d.income || 0));
    return eachDayOfInterval({ start: range.start, end: range.end }).map(day => {
      const key = format(day, 'yyyy-MM-dd');
      return { date: key, revenue: Math.round((byDay.get(key) || 0) * 100) / 100 };
    });
  }, [revenueDaily, range]);

  const formatRows = useMemo(() => {
    const from = format(range.start, 'yyyy-MM-dd');
    const to = format(range.end, 'yyyy-MM-dd');
    const counts = { individual: 0, group: 0, intervision: 0 };
    for (const b of bookings) {
      if (!(b.status === 'confirmed' || b.status === 'completed' || b.status === 're-rented')) continue;
      if (b.paymentMethod === 'service') continue; // обслуживание кабинета — не бронь клиента
      const day = bookingDay(b);
      if (day < from || day > to) continue;
      if (b.format === 'individual') counts.individual += 1;
      else if (b.format === 'group') counts.group += 1;
      else if (b.format === 'intervision') counts.intervision += 1;
    }
    const total = counts.individual + counts.group + counts.intervision;
    return {
      total,
      rows: [
        { name: 'Индивидуальные', value: counts.individual },
        { name: 'Групповые', value: counts.group },
        { name: 'Интервизия', value: counts.intervision },
      ].map(r => ({ ...r, pct: total ? Math.round((r.value / total) * 100) : 0 })),
    };
  }, [bookings, range]);

  const revenueTotal = revenueData.reduce((s, d) => s + d.revenue, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {revenueDaily && (
        <div className="lg:col-span-2 bg-card p-6 border border-ink-10">
          <h3 className="font-semibold text-title mb-1 text-ink">Выручка по дням</h3>
          <p className="text-small text-ink-60 mb-6">
            За {label} · все филиалы · без корректировок · всего <span className="num text-ink">{formatGel(revenueTotal, { fraction: 0 })}</span>
          </p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLOR.ink10} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: COLOR.ink60 }} dy={10}
                  tickFormatter={(v: string) => formatDayMonthShort(v)} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: COLOR.ink60 }} />
                <Tooltip
                  contentStyle={{ border: `1px solid ${COLOR.ink10}`, boxShadow: SHADOW.pop }}
                  formatter={(value: any) => [formatGel(value), 'Выручка']}
                  labelFormatter={(l: any) => formatDayMonth(String(l))}
                  labelStyle={{ color: COLOR.ink60, marginBottom: '4px' }}
                />
                <Bar dataKey="revenue" fill={COLOR.accent} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {formatRows.total > 0 && (
        <div className="bg-card p-6 border border-ink-10 flex flex-col">
          <h3 className="font-semibold text-title mb-1 text-ink">Форматы бронирований</h3>
          <p className="text-small text-ink-60 mb-4">За {label} · {formatRows.total} броней</p>
          <ul className="space-y-3">
            {formatRows.rows.map(r => (
              <li key={r.name}>
                <div className="flex justify-between gap-3 text-small">
                  <span className="text-ink">{r.name}</span>
                  <span className="num text-ink">{r.value} <span className="text-ink-60">· {r.pct}%</span></span>
                </div>
                <div className="mt-1 h-1.5 bg-sunken" aria-hidden="true">
                  <div className="h-full bg-accent" style={{ width: `${r.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
