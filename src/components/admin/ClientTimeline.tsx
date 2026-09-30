import { useMemo } from 'react';
import type {
    User,
    Transaction,
    BookingHistoryItem
} from '../../store/types';
import { formatDayMonth, formatGel, formatTime } from '../../utils/format';
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
    Coins,
    KeyRound
} from 'lucide-react';
import clsx from 'clsx';
import { RESOURCES } from '../../utils/data';

// Цвета событий — только статусные токены (wave 1). Точка узла строится
// заменой text- → bg-, поэтому классы точек перечислены здесь, чтобы
// Tailwind их собрал: bg-[var(--status-ok-fg)] bg-[var(--status-pending-fg)]
// bg-[var(--status-danger-fg)]
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
    | 'comment'
    | 'crm_access';

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
                color: 'text-ink-60',
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
                description: `${RESOURCES.find(r => r.id === b.resourceId)?.name || 'Кабинет'} · ${formatDayMonth(typeof (b.date as unknown) === 'string' ? String(b.date).split('T')[0].split(' ')[0] : b.date)} ${b.startTime ?? ''}`.trim(),
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
                // Use updatedAt (cancel time) instead of booking date
                const cancelDate = b.updatedAt ? getSafeDate(b.updatedAt) : visitDate;
                list.push({
                    id: `booking-cancel-${b.id}`,
                    date: cancelDate,
                    type: 'booking_cancelled',
                    title: 'Отмена брони',
                    description: `${RESOURCES.find(r => r.id === b.resourceId)?.name || 'Кабинет'} · ${formatDayMonth(visitDate)}, ${formatTime(visitDate)} ${b.cancellationReason ? `(${b.cancellationReason})` : ''} ${b.cancelledBy ? `[${b.cancelledBy}]` : ''}`.trim(),
                    icon: XCircle,
                    color: 'text-ink-60', // Was red (Strict palette forbids aggressive red)
                    bg: 'bg-gray-100' // Was red-50
                });
            }
        });

        // 3. Transactions
        transactions.forEach(t => {
            let title = 'Транзакция';
            let icon = Coins;
            let color = 'text-ink-60';
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
                date: getSafeDate(t.date),
                type: 'transaction',
                title: title,
                description: t.description || formatGel(t.amount),
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
                date: getSafeDate(d.date),
                type: 'discount_change',
                title: 'Изменение скидки',
                description: `${d.oldValue}% → ${d.newValue}% (${d.reason})`,
                icon: Percent,
                color: 'text-unbox-dark', // Was indigo
                bg: 'bg-gray-50'
            });
        });

        // 5. Comments & CRM events
        user.commentHistory?.forEach(c => {
            if (c.type === 'crm_access_requested') {
                list.push({
                    id: c.id || `crm-req-${c.date}`,
                    date: getSafeDate(c.date),
                    type: 'crm_access',
                    title: 'Запрос на CRM',
                    description: c.text,
                    icon: KeyRound,
                    color: 'text-[var(--status-pending-fg)]',
                    bg: 'bg-[var(--status-pending-bg)]'
                });
            } else if (c.type === 'crm_access_approved') {
                list.push({
                    id: c.id || `crm-${c.date}`,
                    date: getSafeDate(c.date),
                    type: 'crm_access',
                    title: 'CRM доступ одобрен',
                    description: `${c.adminName}: ${c.text}`,
                    icon: KeyRound,
                    color: 'text-[var(--status-ok-fg)]',
                    bg: 'bg-[var(--status-ok-bg)]'
                });
            } else if (c.type === 'crm_access_rejected') {
                list.push({
                    id: c.id || `crm-${c.date}`,
                    date: getSafeDate(c.date),
                    type: 'crm_access',
                    title: 'CRM запрос отклонён',
                    description: `${c.adminName}: ${c.text}`,
                    icon: KeyRound,
                    color: 'text-[var(--status-danger-fg)]',
                    bg: 'bg-[var(--status-danger-bg)]'
                });
            } else {
                list.push({
                    id: c.id,
                    date: getSafeDate(c.date),
                    type: 'comment',
                    title: c.type === 'permissions_update' ? 'Обновление прав' : c.type === 'subscription_topup' ? 'Пополнение абонемента' : 'Комментарий',
                    description: c.adminName ? `${c.adminName}: ${c.text}` : c.text,
                    icon: MessageSquare,
                    color: 'text-unbox-dark',
                    bg: 'bg-unbox-light'
                });
            }
        });

        // Sort by date desc
        return list.sort((a, b) => b.date.getTime() - a.date.getTime());
    }, [user, transactions, bookings]);

    if (events.length === 0) {
        return <div className="p-8 text-center text-ink-60">Событий по клиенту пока нет</div>;
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
                                        {formatDayMonth(event.date, { withYear: 'auto' })}
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
                                    <span className="text-xs text-ink-60 num">
                                        {formatTime(event.date)}
                                    </span>
                                </div>

                                <div className="text-sm text-gray-600 pl-[38px]">
                                    {event.description}
                                    {event.type === 'transaction' && event.amount && (
                                        <span className="font-bold ml-1 text-gray-900">
                                            {formatGel(event.amount, { sign: true })}
                                        </span>
                                    )}
                                </div>

                                {/* Custom renderer for comments to show full text nicely */}
                                {event.type === 'comment' && (
                                    <div className="mt-2 ml-[38px] p-2 bg-sunken rounded-lg text-sm text-gray-700 italic border border-ink-10">
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
