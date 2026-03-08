import { useMemo } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { ru } from 'date-fns/locale';

interface AnalyticsChartsProps {
  bookings: any[];
}

export function AnalyticsCharts({ bookings }: AnalyticsChartsProps) {
  // 1. Revenue over the last 7 days (Area Chart)
  const revenueData = useMemo(() => {
    const data = [];
    const today = startOfDay(new Date());
    
    // Generate last 7 days array
    for (let i = 6; i >= 0; i--) {
      const date = subDays(today, i);
      
      // Calculate revenue for this specific day
      const dayRevenue = bookings
        .filter(b => b.status === 'confirmed')
        .filter(b => isSameDay(new Date(b.createdAt), date))
        .reduce((sum, b) => sum + (b.finalPrice || 0), 0);
        
      data.push({
        date: format(date, 'dd MMM', { locale: ru }),
        revenue: dayRevenue
      });
    }
    return data;
  }, [bookings]);

  // 2. Bookings by Format (Pie Chart)
  const formatData = useMemo(() => {
    const formats = {
      individual: 0,
      group: 0
    };
    
    bookings.forEach(b => {
      if (b.status === 'confirmed' || b.status === 're-rented') {
        if (b.format === 'individual') formats.individual += 1;
        if (b.format === 'group') formats.group += 1;
      }
    });
    
    return [
      { name: 'Индивидуальные', value: formats.individual, color: '#476D6B' }, // unbox-green
      { name: 'Групповые', value: formats.group, color: '#2C3240' } // unbox-dark
    ];
  }, [bookings]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
      {/* Revenue Area Chart */}
      <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-unbox-light/50 shadow-sm glass-card">
        <h3 className="font-bold text-lg mb-6 text-unbox-dark">Выручка за последние 7 дней</h3>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenueData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#476D6B" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#476D6B" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9CA3AF' }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9CA3AF' }} />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}
                formatter={(value: any) => [`${value} ₾`, 'Выручка']}
                labelFormatter={(label) => `Дата: ${label}`}
                labelStyle={{ color: '#6B7280', marginBottom: '4px' }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#476D6B"
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorRevenue)" 
                activeDot={{ r: 6, strokeWidth: 0, fill: '#476D6B' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bookings Format Pie Chart */}
      <div className="bg-white p-6 rounded-2xl border border-unbox-light/50 shadow-sm glass-card flex flex-col">
        <h3 className="font-bold text-lg mb-2 text-unbox-dark">Форматы бронирований</h3>
        <p className="text-xs text-gray-500 mb-6">Распределение подтвержденных записей</p>
        <div className="flex-1 min-h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={formatData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {formatData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}
                itemStyle={{ color: '#1F2937', fontWeight: 500 }}
              />
              <Legend 
                verticalAlign="bottom" 
                height={36} 
                iconType="circle"
                formatter={(value) => <span className="text-sm font-medium text-gray-700 ml-1">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
