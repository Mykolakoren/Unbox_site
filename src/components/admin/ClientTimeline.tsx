import { useMemo } from 'react';
import type {
    User,
    Transaction,
    BookingHistoryItem
} from '../../store/types';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
    Calendar,
    CreditCard,
    MessageSquare,
    Percent,
    UserPlus,
    AlertCircle,
    CheckCircle2,
    XCircle,
    Clock,
    Coins
} from 'lucide-react';
import clsx from 'clsx';
import { RESOURCES } from '../../utils/data';

interface ClientTimelineProps {
    user: User;
    transactions: Transaction[];
    bookings: BookingHistoryItem[];
}

type EventType =
    | 'registration'
    | 'booking_created'
    | 'booking_visit'
    | 'booking_cancelled'
    | 'transaction'
    | 'discount_change'
    | 'comment';

interface TimelineEvent {
    id: string;
    date: Date;
    type: EventType;
    title: string;
    description?: string;
    icon: any;
    color: string;
    bg: string;
    amount?: number; // for transactions
}

export function ClientTimeline({ user, transactions, bookings }: ClientTimelineProps) {
    const getSafeDate = (date: string | Date | undefined): Date => {
        if (!date) return new Date();
        try {
            if (date instanceof Date) return date;
            // Handle corrupted strings like "2025-12-25T... 12:00"
            const clean = date.replace(' 12:00', '').split(' ')[0];
            const d = new Date(clean);
            return isNaN(d.getTime()) ? new Date() : d;
        } catch {
            return new Date();
        }
    };

    const events = useMemo(() => {
        const list: TimelineEvent[] = [];

        // 1. Registration
        if (user.registrationDate) {
            list.push({
                id: 'reg',
                date: getSafeDate(user.registrationDate),
                type: 'registration',
                title: 'Клиент создан',
                description: `Регистрация в системе`,
                icon: UserPlus,
                color: 'text-unbox-grey',
                bg: 'bg-gray-100'
            });
        }

        // 2. Bookings
        bookings.forEach(b => {
            const createdDate = getSafeDate(b.createdAt);

            // Event: Created
            list.push({
                id: `booking-create-${b.id}`,
                date: createdDate,
                type: 'booking_created',
                title: 'Создана бронь',
                description: `${RESOURCES.find(r => r.id === b.resourceId)?.name || 'Кабинет'} · ${b.date} ${b.startTime}`,
                icon: Clock,
                color: 'text-unbox-green', // Was blue
                bg: 'bg-unbox-light'
            });

            // Event: Visit (actual date)
            // If b.date is corrupted "2025... 12:00", handle it
            let visitDate = new Date();
            try {
                const rawDate: any = b.date;
                const cleanDate = (rawDate instanceof Date) ? rawDate.toISOString().split('T')[0] : (typeof rawDate === 'string' ? rawDate.split('T')[0].split(' ')[0] : '');
                if (cleanDate && b.startTime) {
                    visitDate = new Date(`${cleanDate}T${b.startTime}`);
                } else {
                    visitDate = getSafeDate(b.date);
                }
                if (isNaN(visitDate.getTime())) visitDate = new Date();
            } catch {
                visitDate = new Date();
            }

            if (b.status === 'completed') {
                list.push({
                    id: `booking-visit-${b.id}`,
                    date: visitDate,
                    type: 'booking_visit',
                    title: 'Посещение',
                    description: `${RESOURCES.find(r => r.id === b.resourceId)?.name || 'Кабинет'} · ${b.duration} мин`,
                    icon: CheckCircle2,
                    color: 'text-unbox-green', // Was green (aligned with brand)
                    bg: 'bg-white border border-unbox-green'
                });
            } else if (b.status === 'cancelled') {
                list.push({
                    id: `booking-cancel-${b.id}`,
                    date: visitDate,
                    type: 'booking_cancelled',
                    title: 'Отмена брони',
                    description: `${RESOURCES.find(r => r.id === b.resourceId)?.name || 'Кабинет'} ${b.cancellationReason ? `(Причина: ${b.cancellationReason})` : ''} ${b.cancelledBy ? `[${b.cancelledBy}]` : ''}`.trim(),
                    icon: XCircle,
                    color: 'text-unbox-grey', // Was red (Strict palette forbids aggressive red)
                    bg: 'bg-gray-100' // Was red-50
                });
            }
        });

        // 3. Transactions
        transactions.forEach(t => {
            let title = 'Транзакция';
            let icon = Coins;
            let color = 'text-unbox-grey';
            let bg = 'bg-gray-100';

            if (t.type === 'deposit') {
                title = 'Пополнение баланса';
                icon = CreditCard;
                color = 'text-unbox-green'; // Was green
                bg = 'bg-unbox-light';
            } else if (t.type === 'booking_payment') {
                title = 'Оплата бронирования';
                icon = Coins;
                color = 'text-unbox-dark'; // Was blue
                bg = 'bg-gray-50';
            } else if (t.type === 'manual_correction') {
                title = 'Ручная коррекция';
                icon = AlertCircle;
                color = 'text-unbox-dark'; // Was orange
                bg = 'bg-gray-100';
            } else if (t.type === 'subscription_purchase') {
                title = 'Покупка абонемента';
                icon = Calendar;
                color = 'text-unbox-dark'; // Was purple
                bg = 'bg-unbox-light';
            }

            list.push({
                id: `trans-${t.id}`,
                date: new Date(t.date),
                type: 'transaction',
                title: title,
                description: t.description || `${t.amount} ₾`,
                amount: t.amount,
                icon: icon,
                color: color,
                bg: bg
            });
        });

        // 4. Discounts
        user.discountHistory?.forEach(d => {
            list.push({
                id: d.id,
                date: new Date(d.date),
                type: 'discount_change',
                title: 'Изменение скидки',
                description: `${d.oldValue}% → ${d.newValue}% (${d.reason})`,
                icon: Percent,
                color: 'text-unbox-dark', // Was indigo
                bg: 'bg-gray-50'
            });
        });

        // 5. Comments
        user.commentHistory?.forEach(c => {
            list.push({
                id: c.id,
                date: new Date(c.date),
                type: 'comment',
                title: 'Комментарий',
                description: c.text,
                icon: MessageSquare,
                color: 'text-unbox-dark', // Was yellow
                bg: 'bg-unbox-light'
            });
        });

        // Sort by date desc
        return list.sort((a, b) => b.date.getTime() - a.date.getTime());
    }, [user, transactions, bookings]);

    if (events.length === 0) {
        return <div className="p-8 text-center text-gray-400">История событий пуста</div>;
    }

    return (
        <div className="space-y-6">
            <h2 className="text-xl font-bold px-1">Журнал событий</h2>
            <div className="relative border-l-2 border-gray-100 ml-4 space-y-8 pb-8">
                {events.map((event, index) => {
                    const isNewDay = index === 0 ||
                        events[index - 1].date.toDateString() !== event.date.toDateString();

                    return (
                        <div key={event.id} className="relative pl-8 animate-in slide-in-from-left-2 duration-300" style={{ animationDelay: `${index * 50}ms` }}>
                            {/* Date Header if new day */}
                            {isNewDay && (
                                <div className="absolute -left-[21px] -top-8 flex items-center mb-4 mt-2">
                                    <div className="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-1 rounded-md border border-gray-200 uppercase tracking-wider">
                                        {format(event.date, 'd MMMM yyyy', { locale: ru })}
                                    </div>
                                </div>
                            )}

                            {/* Timeline Node */}
                            <div className={clsx(
                                "absolute -left-[9px] top-1 w-5 h-5 rounded-full border-4 border-white flex items-center justify-center",
                                event.bg
                            )}>
                                <div className={clsx("w-2 h-2 rounded-full", event.color.replace('text-', 'bg-'))} />
                            </div>

                            {/* Content Card */}
                            <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
                                <div className="flex justify-between items-start mb-1">
                                    <div className="flex items-center gap-2">
                                        <div className={clsx("p-1.5 rounded-lg", event.bg, event.color)}>
                                            <event.icon size={16} />
                                        </div>
                                        <span className="font-bold text-gray-900">{event.title}</span>
                                    </div>
                                    <span className="text-xs text-gray-400 font-mono">
                                        {format(event.date, 'HH:mm')}
                                    </span>
                                </div>

                                <div className="text-sm text-gray-600 pl-[38px]">
                                    {event.description}
                                    {event.type === 'transaction' && event.amount && (
                                        <span className="font-bold ml-1 text-gray-900">
                                            {event.amount > 0 ? '+' : ''}{event.amount} ₾
                                        </span>
                                    )}
                                </div>

                                {/* Custom renderer for comments to show full text nicely */}
                                {event.type === 'comment' && (
                                    <div className="mt-2 ml-[38px] p-2 bg-yellow-50/50 rounded-lg text-sm text-gray-700 italic border border-yellow-100/50">
                                        "{event.description}"
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
