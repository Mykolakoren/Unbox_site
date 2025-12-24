import { useUserStore } from '../store/userStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { BadgeCheck, XCircle, Clock } from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Link } from 'react-router-dom';

export function MyBookingsPage() {
    const bookings = useUserStore(s => s.bookings);

    if (bookings.length === 0) {
        return (
            <div className="text-center py-20 text-gray-500">
                <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Clock size={32} />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">У вас пока нет бронирований</h2>
                <p className="mb-6">Самое время забронировать кабинет!</p>
                <Link to="/">
                    <Button>Забронировать</Button>
                </Link>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h1 className="text-2xl font-bold">Мои бронирования</h1>

            <div className="space-y-4">
                {bookings.map((booking) => (
                    <Card key={booking.id} className="p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <div className="text-xs text-gray-500 font-bold uppercase mb-1">
                                    {format(new Date(booking.dateCreated), 'd MMM yyyy', { locale: ru })}
                                </div>
                                <h3 className="font-bold text-lg">
                                    {booking.locationId === 'one' ? 'Unbox One' : 'Unbox Uni'} · {booking.format === 'individual' ? 'Индивидуальный' : 'Групповой'}
                                </h3>
                                <div className="text-gray-500 mt-1 flex items-center gap-2">
                                    <Clock size={14} />
                                    {format(new Date(booking.date), 'd MMM', { locale: ru })}, {booking.startTime} ({booking.duration / 60}ч)
                                </div>
                            </div>

                            <div className={clsx(
                                "px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1",
                                {
                                    'bg-green-100 text-green-700': booking.status === 'confirmed',
                                    'bg-red-100 text-red-700': booking.status === 'cancelled',
                                    'bg-gray-100 text-gray-600': booking.status === 'completed',
                                }
                            )}>
                                {booking.status === 'confirmed' && <><BadgeCheck size={12} /> Подтверждено</>}
                                {booking.status === 'cancelled' && <><XCircle size={12} /> Отменено</>}
                                {booking.status === 'completed' && 'Завершено'}
                            </div>
                        </div>

                        <div className="flex justify-between items-center text-sm pt-4 border-t border-gray-100">
                            <span className="text-gray-500">Итоговая стоимость</span>
                            <span className="font-bold text-lg">{booking.finalPrice} ₾</span>
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
}
