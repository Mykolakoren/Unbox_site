import { format, addMinutes, parse } from 'date-fns';
import { ru } from 'date-fns/locale';
import { XCircle, RefreshCw, Calendar as CalendarIcon, MapPin, Box, User, Users, AlertTriangle, CheckCircle } from 'lucide-react';
import type { BookingHistoryItem } from '../../store/types';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import clsx from 'clsx';

interface UserBookingsTabProps {
    bookings: BookingHistoryItem[];
    onCancel: (bookingId: string) => void;
    onReschedule: (bookingId: string) => void;
}

import { useUserStore } from '../../store/userStore';
import { toast } from 'sonner';

export function UserBookingsTab({ bookings, onCancel: propOnCancel, onReschedule }: UserBookingsTabProps) {
    const { cancelBooking, currentUser } = useUserStore();

    // Use internal onCancel if provided, but wrapping logic here for permissions is better 
    // if we want to enforce it at the UI level closest to the button.
    // However, onCancel prop might be used by parent to refresh data.
    // Let's implement logic HERE and then call propOnCancel.

    const handleCancel = (id: string, date: string, startTime?: string) => {
        if (!confirm('Вы уверены, что хотите отменить это бронирование?')) return;

        let bookingTime = new Date(date).getTime();
        if (startTime) {
            const [h, m] = startTime.split(':').map(Number);
            const d = new Date(date);
            d.setHours(h, m, 0, 0);
            bookingTime = d.getTime();
        }

        const now = Date.now();
        const hoursUntilStart = (bookingTime - now) / (1000 * 60 * 60);

        if (hoursUntilStart < 24) {
            // Permission Check
            if (currentUser?.role === 'admin') {
                toast.error('Ошибка доступа: У вас нет прав на отмену бронирования менее чем за 24 часа.');
                return;
            }

            const reason = prompt('Отмена менее чем за 24 часа. Укажите причину (обязательно):');
            if (!reason) {
                toast.error('Отмена отклонена: причина обязательна для поздних отмен.');
                return;
            }

            cancelBooking(id, false, reason, currentUser || undefined);
            toast.success('Бронирование отменено (с фиксацией причины)');
        } else {
            cancelBooking(id);
            toast.success('Бронирование отменено');
        }

        if (propOnCancel) propOnCancel(id);
    };

    if (bookings.length === 0) {
        return (
            <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400">
                История бронирований пуста
            </div>
        );
    }

    const getStatusConfig = (status: BookingHistoryItem['status']) => {
        switch (status) {
            case 'confirmed': return { label: 'Забронировано', color: 'text-green-600 bg-green-50', icon: CheckCircle };
            case 'completed': return { label: 'Завершено', color: 'text-gray-600 bg-gray-50', icon: CheckCircle };
            case 'cancelled': return { label: 'Отменено', color: 'text-red-600 bg-red-50', icon: XCircle };
            case 'rescheduled': return { label: 'Перенесено', color: 'text-orange-600 bg-orange-50', icon: RefreshCw };
            case 're-rented': return { label: 'Пересдано', color: 'text-blue-600 bg-blue-50', icon: RefreshCw };
            case 'no_show': return { label: 'Неявка', color: 'text-red-600 bg-red-100', icon: AlertTriangle };
            default: return { label: status, color: 'text-gray-600 bg-gray-50', icon: CheckCircle };
        }
    };

    const getEndTime = (startTime: string | null | undefined, duration: number) => {
        if (!startTime) return '??:??';
        try {
            const startObj = parse(startTime, 'HH:mm', new Date());
            const endObj = addMinutes(startObj, duration);
            return format(endObj, 'HH:mm');
        } catch (e) {
            console.error('Error calculating end time', e);
            return '??:??';
        }
    };

    const formatDateSafe = (dateStr: string | Date | undefined) => {
        if (!dateStr) return 'Неизвестная дата';
        try {
            return format(new Date(dateStr), 'd MMMM yyyy', { locale: ru });
        } catch (e) {
            console.error('Error formatting date', e);
            return 'Ошибка даты';
        }
    };

    const getGoogleCalendarLink = (b: BookingHistoryItem) => {
        try {
            // Robust date cleaning
            let dateVal: string | Date = b.date;
            if (dateVal instanceof Date) {
                dateVal = dateVal.toISOString();
            }
            // Remove any time part or extra junk if present, take first part YYYY-MM-DD
            const cleanDateStr: string = typeof dateVal === 'string' ? dateVal.split('T')[0].split(' ')[0] : '';

            if (!cleanDateStr || !b.startTime) return '#';

            // Safe parsing for GCal link
            const startObj = parse(b.startTime, 'HH:mm', new Date());
            const endObj = addMinutes(startObj, b.duration);
            const endTimeStr = format(endObj, 'HH:mm');

            const start = new Date(`${cleanDateStr}T${b.startTime}`).toISOString().replace(/-|:|\.\d\d\d/g, "");
            const end = new Date(`${cleanDateStr}T${endTimeStr}`).toISOString().replace(/-|:|\.\d\d\d/g, "");

            const resource = RESOURCES.find(r => r.id === b.resourceId);
            const location = LOCATIONS.find(l => l.id === resource?.locationId);

            const text = `Бронь: ${resource?.name || 'Кабинет'}`;
            const details = `Клиент: ID ${b.userId}`;
            const loc = location?.address || '';

            return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(text)}&dates=${start}/${end}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(loc)}`;
        } catch (e) {
            console.error("Error generating GCal link", e);
            return '#';
        }
    };

    return (
        <div className="space-y-4">
            {bookings.map(booking => {
                const resource = RESOURCES.find(r => r.id === booking.resourceId);
                const location = LOCATIONS.find(l => l.id === resource?.locationId);
                const statusConfig = getStatusConfig(booking.status);
                const StatusIcon = statusConfig.icon;

                const endTime = getEndTime(booking.startTime, booking.duration);
                const formattedDate = formatDateSafe(booking.date);

                // Check if booking is in the past
                let isPastBooking = false;
                try {
                    const bookingDate = new Date(booking.date);
                    // If we have start time, use it for precise check, otherwise just use end of day
                    if (booking.startTime) {
                        const startObj = parse(booking.startTime, 'HH:mm', bookingDate);
                        const endObj = addMinutes(startObj, booking.duration);
                        isPastBooking = endObj < new Date();
                    } else {
                        // If no time, assume past if date is before today (ignoring time)
                        // Or maybe end of that day
                        const endOfDay = new Date(bookingDate);
                        endOfDay.setHours(23, 59, 59, 999);
                        isPastBooking = endOfDay < new Date();
                    }
                } catch (e) {
                    console.error('Error checking past booking', e);
                }

                return (
                    <div
                        key={booking.id}
                        className={clsx(
                            "bg-white border border-gray-100 rounded-xl p-4 transition-all",
                            isPastBooking ? "opacity-60 grayscale-[0.5] hover:opacity-100 hover:grayscale-0" : "hover:shadow-sm"
                        )}
                    >
                        <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
                            {/* Main Info */}
                            <div className="flex-1 space-y-2">
                                <div className="flex items-center gap-3">
                                    <div className="font-bold text-lg flex items-center gap-2">
                                        {formattedDate}
                                        <span className="text-gray-300">|</span>
                                        <span className="font-mono">{booking.startTime || '??:??'} - {endTime}</span>
                                    </div>
                                    <div className={clsx("px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1", statusConfig.color)}>
                                        <StatusIcon size={12} />
                                        {statusConfig.label}
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                                    <div className="flex items-center gap-1.5" title="Локация">
                                        <MapPin size={14} className="text-gray-400" />
                                        {location?.name || '—'}
                                    </div>
                                    <div className="flex items-center gap-1.5" title="Кабинет">
                                        <Box size={14} className="text-gray-400" />
                                        {resource?.name || '—'}
                                    </div>
                                    <div className="flex items-center gap-1.5" title="Формат">
                                        {booking.format === 'group' ? <Users size={14} className="text-gray-400" /> : <User size={14} className="text-gray-400" />}
                                        {booking.format === 'group' ? 'Группа' : 'Индивидуально'}
                                    </div>
                                    <div className="font-medium text-black">
                                        {booking.finalPrice} ₾
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 w-full lg:w-auto mt-2 lg:mt-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-50">
                                { /* Only show actions if NOT past and status is mutable */}
                                {!isPastBooking && (booking.status === 'confirmed' || booking.status === 'rescheduled') && (
                                    <>
                                        <button
                                            onClick={() => handleCancel(booking.id, booking.date instanceof Date ? booking.date.toISOString() : booking.date, booking.startTime || undefined)}
                                            className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors flex items-center gap-1.5"
                                        >
                                            <XCircle size={14} />
                                            Отменить
                                        </button>
                                        <button
                                            onClick={() => onReschedule(booking.id)}
                                            className="px-3 py-1.5 bg-gray-50 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors flex items-center gap-1.5"
                                        >
                                            <RefreshCw size={14} />
                                            Перенести
                                        </button>
                                    </>
                                )}

                                <a
                                    href={getGoogleCalendarLink(booking)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors flex items-center gap-1.5"
                                >
                                    <CalendarIcon size={14} />
                                    G-Cal
                                </a>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
