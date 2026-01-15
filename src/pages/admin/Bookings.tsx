import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { RESOURCES } from '../../utils/data';
import { format } from 'date-fns';
import { Search, Clock } from 'lucide-react';
import clsx from 'clsx';

export function AdminBookings() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { bookings, users, fetchUsers, cancelBooking, listForReRent, setManualPrice } = useUserStore();
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [search, setSearch] = useState(searchParams.get('search') || '');

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    // helper to get user name by email
    const getUserName = (email: string) => {
        const u = users.find(u => u.email === email);
        return u ? u.name : email;
    };

    const filteredBookings = bookings
        .filter(b => {
            if (filterStatus !== 'all' && b.status !== filterStatus) return false;
            if (search) {
                const term = search.toLowerCase();
                const userName = (getUserName(b.userId) || '').toLowerCase();
                const userId = (b.userId || '').toLowerCase();
                const bookingId = (b.id || '').toLowerCase();

                return userName.includes(term) ||
                    userId.includes(term) ||
                    bookingId.includes(term);
            }
            return true;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const handleEditPrice = (bookingId: string, currentPrice: number) => {
        const newPriceString = prompt('Введите новую цену (GEL):', currentPrice.toString());
        if (newPriceString !== null) {
            const newPrice = parseFloat(newPriceString);
            if (!isNaN(newPrice)) {
                setManualPrice(bookingId, newPrice);
            }
        }
    };

    const handleCancel = (bookingId: string) => {
        if (confirm('Вы уверены, что хотите отменить это бронирование?')) {
            cancelBooking(bookingId);
        }
    };

    const handleReRent = (bookingId: string) => {
        if (confirm('Выставить этот слот на переаренду?')) {
            listForReRent(bookingId);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl font-bold">Бронирования</h1>

                <div className="flex gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:flex-none">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Поиск..."
                            className="pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black w-full sm:w-64"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <select
                        className="px-4 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-black"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                    >
                        <option value="all">Все статусы</option>
                        <option value="confirmed">Подтверждено</option>
                        <option value="cancelled">Отменено</option>
                        <option value="re-rented">Пересдано</option>
                    </select>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-unbox-light overflow-hidden shadow-sm overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                    <thead className="bg-unbox-light border-b border-unbox-light text-unbox-grey font-medium text-sm">
                        <tr>
                            <th className="p-4 pl-6">Создано</th>
                            <th className="p-4">Клиент</th>
                            <th className="p-4">Ресурс</th>
                            <th className="p-4">Дата и Время</th>
                            <th className="p-4 text-center">Статус</th>
                            <th className="p-4 text-right">Цена</th>
                            <th className="p-4 text-right">Действия</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-unbox-light">
                        {filteredBookings.map(booking => {
                            const resourceName = RESOURCES.find(r => r.id === booking.resourceId)?.name || booking.resourceId;

                            return (
                                <tr key={booking.id} className="hover:bg-unbox-light/30 transition-colors text-sm">
                                    <td className="p-4 pl-6 text-unbox-grey">
                                        {format(new Date(booking.createdAt), 'dd.MM HH:mm')}
                                    </td>
                                    <td className="p-4 font-medium text-unbox-dark">
                                        <div
                                            onClick={() => navigate(`/admin/users/${encodeURIComponent(booking.userId)}`)}
                                            className="cursor-pointer hover:text-unbox-green transition-colors group"
                                        >
                                            <div className="group-hover:underline">{getUserName(booking.userId)}</div>
                                            <div className="text-xs text-unbox-grey font-normal no-underline">{booking.userId}</div>
                                        </div>
                                    </td>
                                    <td className="p-4 text-unbox-dark">
                                        {resourceName}
                                        <div className="text-xs text-unbox-grey">{booking.locationId === 'unbox_one' ? 'Unbox One' : 'Unbox Uni'}</div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2 text-unbox-dark">
                                            <CalendarIcon size={14} className="text-unbox-grey" />
                                            {format(new Date(booking.date), 'dd.MM.yyyy')}
                                        </div>
                                        <div className="flex items-center gap-2 text-unbox-grey mt-1">
                                            <Clock size={14} className="text-unbox-grey" />
                                            {booking.startTime} ({booking.duration / 60}ч)
                                        </div>
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={clsx(
                                            "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                                            {
                                                'bg-unbox-light text-unbox-green': booking.status === 'confirmed',
                                                'bg-gray-100 text-unbox-grey': booking.status === 'cancelled',
                                                'bg-white border border-unbox-green text-unbox-green': booking.status === 're-rented',
                                            }
                                        )}>
                                            {booking.status === 'confirmed' && 'Active'}
                                            {booking.status === 'cancelled' && 'Cancelled'}
                                            {booking.status === 're-rented' && 'Re-rented'}
                                        </span>
                                        {booking.isReRentListed && booking.status === 'confirmed' && (
                                            <div className="mt-1 text-[10px] text-unbox-green font-medium bg-unbox-light px-1 rounded border border-unbox-green/20">
                                                Listed for Re-Rent
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-4 text-right font-medium">
                                        {booking.paymentMethod === 'subscription' ? (
                                            <span className="text-unbox-green">Абонемент</span>
                                        ) : (
                                            <span className="text-unbox-dark">{booking.finalPrice} ₾</span>
                                        )}
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            {booking.status === 'confirmed' && (
                                                <>
                                                    <button
                                                        onClick={() => handleEditPrice(booking.id, booking.finalPrice)}
                                                        className="text-unbox-grey hover:text-unbox-green text-xs underline"
                                                    >
                                                        Цена
                                                    </button>
                                                    {!booking.isReRentListed && (
                                                        <button
                                                            onClick={() => handleReRent(booking.id)}
                                                            className="text-unbox-grey hover:text-unbox-green text-xs underline"
                                                        >
                                                            Пересдать
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleCancel(booking.id)}
                                                        className="text-unbox-grey hover:text-red-600 text-xs underline"
                                                    >
                                                        Отмена
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>

                {filteredBookings.length === 0 && (
                    <div className="p-12 text-center text-unbox-grey">
                        Бронирований не найдено
                    </div>
                )}
            </div>
        </div>
    );
}

// Icon helper since 'Calendar' name conflict with Date type often happens if not careful, 
// but here we are safe. Wait, lucide-react exports Calendar.
const CalendarIcon = ({ size, className }: { size: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></svg>
);
