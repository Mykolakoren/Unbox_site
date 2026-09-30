import { useState } from 'react';
import { format, addMinutes, parse } from 'date-fns';
import { XCircle, RefreshCw, Calendar as CalendarIcon, MapPin, Box, User, Users } from 'lucide-react';
import type { BookingHistoryItem } from '../../store/types';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import clsx from 'clsx';
import { StatusBadge } from '../ui/StatusBadge';
import { EmptyState } from '../ui/EmptyState';
import { Money } from '../ui/Money';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Field, TextArea } from '../ui/Field';
import { useConfirmDialog } from '../ui/ConfirmDialogProvider';
import { formatDayMonth, formatTimeRange } from '../../utils/format';

interface UserBookingsTabProps {
    bookings: BookingHistoryItem[];
    onCancel: (bookingId: string) => void;
    onReschedule: (bookingId: string) => void;
    /** Перевести бронь с денег на абонемент. Показывается, только если у клиента
     *  активный абонемент и бронь оплачена деньгами (кейс: клиент бронировал,
     *  когда часы кончились, а абонемент пополнили через пару часов). */
    onToSubscription?: (bookingId: string) => void;
    hasActiveSubscription?: boolean;
    convertingId?: string | null;
}

import { useUserStore } from '../../store/userStore';
import { toast } from 'sonner';

export function UserBookingsTab({
    bookings, onCancel: propOnCancel, onReschedule,
    onToSubscription, hasActiveSubscription, convertingId,
}: UserBookingsTabProps) {
    const { cancelBooking, currentUser } = useUserStore();
    const { confirm } = useConfirmDialog();
    // Поздняя отмена (<24 ч) — причина в шторке вместо системного prompt().
    const [lateCancel, setLateCancel] = useState<{ id: string; label: string } | null>(null);
    const [lateReason, setLateReason] = useState('');
    const [lateError, setLateError] = useState('');

    // Use internal onCancel if provided, but wrapping logic here for permissions is better 
    // if we want to enforce it at the UI level closest to the button.
    // However, onCancel prop might be used by parent to refresh data.
    // Let's implement logic HERE and then call propOnCancel.

    const handleCancel = async (id: string, date: string, startTime?: string, label = '') => {
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
                toast.error('Отменить бронь меньше чем за 24 часа может только старший админ или владелец.');
                return;
            }
            // Причина обязательна — шторка с полем; её кнопка и есть подтверждение.
            setLateReason('');
            setLateError('');
            setLateCancel({ id, label });
            return;
        }

        const ok = await confirm({
            title: 'Отменить бронь?',
            body: label ? `Бронь ${label} будет отменена.` : 'Бронь будет отменена.',
            confirmLabel: 'Отменить бронь',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        cancelBooking(id);
        toast.success('Бронь отменена');
        if (propOnCancel) propOnCancel(id);
    };

    const submitLateCancel = () => {
        if (!lateCancel) return;
        const reason = lateReason.trim();
        if (!reason) {
            setLateError('Укажите причину — без неё позднюю отмену не провести');
            return;
        }
        const { id } = lateCancel;
        cancelBooking(id, false, reason, currentUser || undefined);
        toast.success('Бронь отменена, причина записана');
        setLateCancel(null);
        if (propOnCancel) propOnCancel(id);
    };

    const lateCancelSheet = (
        <Sheet
            open={!!lateCancel}
            onClose={() => setLateCancel(null)}
            title="Поздняя отмена"
            description={lateCancel?.label
                ? `До начала брони ${lateCancel.label} меньше 24 часов.`
                : 'До начала брони меньше 24 часов.'}
            width={440}
            footer={
                <>
                    <Button variant="danger" block onClick={submitLateCancel}>Отменить бронь</Button>
                    <Button variant="secondary" block onClick={() => setLateCancel(null)}>Оставить</Button>
                </>
            }
        >
            <Field label="Причина отмены" error={lateError || undefined} required>
                <TextArea
                    rows={3}
                    value={lateReason}
                    onChange={e => { setLateReason(e.target.value); if (lateError) setLateError(''); }}
                    placeholder="Например: клиент заболел, предупредил за 3 часа"
                />
            </Field>
        </Sheet>
    );

    if (bookings.length === 0) {
        return (
            <EmptyState
                compact
                icon={<CalendarIcon size={28} />}
                title="У клиента пока нет броней"
                hint="Новую бронь можно создать из шахматки."
            />
        );
    }

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

    // «29 сентября» (год — только если не текущий). Календарную дату брони
    // берём как есть, без сдвига пояса.
    const formatDateSafe = (dateStr: string | Date | undefined) => {
        if (!dateStr) return 'Дата не указана';
        const d = typeof dateStr === 'string' ? dateStr.split('T')[0].split(' ')[0] : dateStr;
        return formatDayMonth(d, { withYear: 'auto', fallback: 'Дата не указана' });
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
            {lateCancelSheet}
            {bookings.map(booking => {
                const resource = RESOURCES.find(r => r.id === booking.resourceId);
                const location = LOCATIONS.find(l => l.id === resource?.locationId);
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
                                        <span className="text-ink-30" aria-hidden="true">|</span>
                                        <span className="num">{booking.startTime ? formatTimeRange(booking.startTime, endTime) : '—'}</span>
                                    </div>
                                    <StatusBadge kind="booking" status={booking.status} audience="staff" />
                                </div>

                                <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                                    <div className="flex items-center gap-1.5" title="Локация">
                                        <MapPin size={14} className="text-ink-60" />
                                        {location?.name || '—'}
                                    </div>
                                    <div className="flex items-center gap-1.5" title="Кабинет">
                                        <Box size={14} className="text-ink-60" />
                                        {resource?.name || '—'}
                                    </div>
                                    <div className="flex items-center gap-1.5" title="Формат">
                                        {booking.format === 'individual' ? <User size={14} className="text-ink-60" /> : <Users size={14} className="text-ink-60" />}
                                        {booking.format === 'individual' ? 'Индивидуально' :
                                         booking.format === 'intervision' ? 'Интервизия' : 'Группа'}
                                    </div>
                                    <Money value={booking.finalPrice} className="font-medium text-ink" />
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 w-full lg:w-auto mt-2 lg:mt-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-50">
                                { /* Only show actions if NOT past and status is mutable */}
                                {!isPastBooking && (booking.status === 'confirmed' || booking.status === 'rescheduled') && (
                                    <>
                                        <button
                                            onClick={() => handleCancel(
                                                booking.id,
                                                booking.date instanceof Date ? booking.date.toISOString() : booking.date,
                                                booking.startTime || undefined,
                                                `${formattedDate}${booking.startTime ? `, ${booking.startTime}` : ''}`,
                                            )}
                                            className="px-3 py-1.5 bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] rounded-lg text-xs font-medium hover:brightness-95 transition-colors flex items-center gap-1.5"
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

                                {/* На абонемент — для оплаченных деньгами броней, когда
                                    у клиента есть активный абонемент. Деньги вернутся,
                                    спишется час. Дата брони не важна (бэк не ограничивает). */}
                                {onToSubscription && hasActiveSubscription
                                    && booking.paymentMethod !== 'subscription'
                                    && booking.paymentMethod !== 'bonus'
                                    && booking.status !== 'cancelled' && (
                                    <button
                                        onClick={() => onToSubscription(booking.id)}
                                        disabled={convertingId === booking.id}
                                        className="px-3 py-1.5 bg-gray-50 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors flex items-center gap-1.5 disabled:opacity-60"
                                        title="Вернуть деньги на баланс и списать час с абонемента"
                                    >
                                        {convertingId === booking.id ? '…' : 'На абонемент'}
                                    </button>
                                )}

                                <a
                                    href={getGoogleCalendarLink(booking)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 bg-unbox-light text-unbox-green rounded-lg text-xs font-medium hover:bg-unbox-light/80 transition-colors flex items-center gap-1.5"
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
