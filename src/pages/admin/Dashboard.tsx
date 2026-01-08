import { useUserStore } from '../../store/userStore';
import { startOfToday, startOfWeek, startOfMonth, isAfter, isSameDay } from 'date-fns';
import { Users, CreditCard, Calendar, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';

export function AdminDashboard() {
    const { bookings, users } = useUserStore();

    // 1. Calculate Stats
    const now = new Date();
    const today = startOfToday();
    const thisWeek = startOfWeek(now, { weekStartsOn: 1 });
    const thisMonth = startOfMonth(now);

    const confirmedBookings = bookings.filter(b => b.status === 'confirmed');

    // Revenue
    const calculateRevenue = (fromDate: Date) => {
        return confirmedBookings
            .filter(b => isAfter(new Date(b.date), fromDate) || isSameDay(new Date(b.date), fromDate))
            .reduce((sum, b) => sum + (b.finalPrice || 0), 0);
    };

    const totalRevenue = confirmedBookings.reduce((sum, b) => sum + (b.finalPrice || 0), 0);
    const todayRevenue = calculateRevenue(today);
    const monthRevenue = calculateRevenue(thisMonth);

    // Counts
    const totalUsers = users.length;
    const activeBookingsCount = confirmedBookings.filter(b => isAfter(new Date(b.date), now)).length;
    const reRentedCount = bookings.filter(b => b.status === 're-rented').length;

    const stats = [
        {
            label: 'Выручка за сегодня',
            value: `${todayRevenue} ₾`,
            icon: TrendingUp,
            color: 'bg-green-100 text-green-600',
        },
        {
            label: 'Выручка за месяц',
            value: `${monthRevenue} ₾`,
            icon: CreditCard,
            color: 'bg-blue-100 text-blue-600',
        },
        {
            label: 'Активных броней',
            value: activeBookingsCount,
            icon: Calendar,
            color: 'bg-purple-100 text-purple-600',
        },
        {
            label: 'Всего клиентов',
            value: totalUsers,
            icon: Users,
            color: 'bg-orange-100 text-orange-600',
        },
    ];

    // Recent Bookings (Last 5 created)
    const recentBookings = [...bookings]
        .sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime())
        .slice(0, 5);

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div>
                <h1 className="text-2xl font-bold mb-2">Обзор</h1>
                <p className="text-gray-500">Статистика и сводка по сервису</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, i) => (
                    <div key={i} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
                        <div className={clsx("w-12 h-12 rounded-xl flex items-center justify-center", stat.color)}>
                            <stat.icon size={24} />
                        </div>
                        <div>
                            <div className="text-sm text-gray-500 font-medium">{stat.label}</div>
                            <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Recent Bookings List */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                    <h2 className="font-bold text-lg mb-4">Последние бронирования</h2>
                    <div className="space-y-4">
                        {recentBookings.map(booking => (
                            <div key={booking.id} className="flex items-center justify-between pb-4 border-b border-gray-50 last:border-0 last:pb-0">
                                <div>
                                    <div className="font-medium text-gray-900">
                                        {format(new Date(booking.date), 'dd.MM')} · {booking.startTime}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {users.find(u => u.email === booking.userId)?.name || booking.userId}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-gray-900">
                                        {booking.paymentMethod === 'subscription' ? 'Абн.' : `${booking.finalPrice} ₾`}
                                    </div>
                                    <div className={clsx(
                                        "text-[10px] px-2 py-0.5 rounded-full inline-block",
                                        {
                                            'bg-green-100 text-green-700': booking.status === 'confirmed',
                                            'bg-red-100 text-red-700': booking.status === 'cancelled',
                                            'bg-blue-100 text-blue-700': booking.status === 're-rented',
                                        }
                                    )}>
                                        {booking.status}
                                    </div>
                                </div>
                            </div>
                        ))}
                        {recentBookings.length === 0 && (
                            <div className="text-center text-gray-400 py-4">Нет бронирований</div>
                        )}
                    </div>
                </div>

                {/* Quick Actions (Future placeholder) */}
                <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 text-white shadow-lg">
                    <h2 className="font-bold text-lg mb-2">Быстрый старт</h2>
                    <p className="text-gray-400 text-sm mb-6">
                        Используйте панель администратора для управления всеми аспектами сервиса.
                    </p>

                    <div className="space-y-3">
                        <div className="flex items-center gap-3 bg-white/10 p-3 rounded-lg border border-white/10">
                            <CreditCard size={20} className="text-green-400" />
                            <div className="text-sm">
                                <div className="font-medium">Общая выручка</div>
                                <div className="text-gray-400">{totalRevenue} ₾ за все время</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 bg-white/10 p-3 rounded-lg border border-white/10">
                            <TrendingUp size={20} className="text-blue-400" />
                            <div className="text-sm">
                                <div className="font-medium">Пересдано броней</div>
                                <div className="text-gray-400">{reRentedCount} успешных возвратов</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
