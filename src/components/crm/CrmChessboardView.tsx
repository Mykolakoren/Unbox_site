import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { useCrmStore } from '../../store/crmStore';
import { LOCATIONS, RESOURCES } from '../../utils/data';
import {
    format, addMinutes, setHours, setMinutes, startOfToday, isBefore,
    addWeeks, subWeeks, startOfWeek, endOfWeek, eachDayOfInterval,
    isSameDay, isToday,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, Loader2, Search, UserCheck, Link2, UserPlus } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { isPeakTime } from '../../utils/pricing';
import type { BookingHistoryItem } from '../../store/types';
import type { CrmClient } from '../../api/crm';
import { ChessboardScroller } from '../ui/ChessboardScroller';
import { parseUTC } from '../../utils/dateUtils';
import { apiErrorMessage } from '../../utils/errors';

// ─── Time Slots: 09:00 – 21:30 (30-min steps, last block ends 22:00) ─────
// Evening 21:00–22:00 carries the peak-hour surcharge automatically.
const TIME_SLOTS: string[] = (() => {
    const slots: string[] = [];
    let t = setMinutes(setHours(startOfToday(), 9), 0);
    const end = setMinutes(setHours(startOfToday(), 22), 0);
    while (isBefore(t, end)) {
        slots.push(format(t, 'HH:mm'));
        t = addMinutes(t, 30);
    }
    return slots;
})();

const timeToMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

const parseBookingDate = (d: string | Date): Date => {
    if (d instanceof Date) return d;
    const s = String(d);
    return new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z');
};

type CellInfo =
    | { type: 'free'; slot: string; past: boolean }
    | { type: 'booking'; slot: string; booking: BookingHistoryItem; colspan: number; isMine: boolean };

// ─── CRM Quick Booking Modal ──────────────────────────────────────────────────
function CrmQuickBookModal({
    slot,
    crmClients,
    onClose,
    onBooked,
}: {
    slot: { resId: string; time: string; date: Date; duration: number };
    crmClients: CrmClient[];
    onClose: () => void;
    onBooked: (bookingId: string, clientId: string | null, price: number) => Promise<void>;
}) {
    const resource = RESOURCES.find(r => r.id === slot.resId);
    const [duration, setDuration] = useState(slot.duration);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [price, setPrice] = useState('');
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [recurringPattern, setRecurringPattern] = useState<'' | 'weekly' | 'biweekly' | 'monthly'>('');
    const [recurringOccurrences, setRecurringOccurrences] = useState(12);
    const dateStr = format(slot.date, 'yyyy-MM-dd');

    const endTime = (() => {
        try {
            const [h, m] = slot.time.split(':').map(Number);
            return format(addMinutes(setMinutes(setHours(slot.date, h), m), duration), 'HH:mm');
        } catch { return '—'; }
    })();

    const selectedClient = crmClients.find(c => c.id === selectedClientId);
    useEffect(() => {
        if (selectedClient && !price) setPrice(String(selectedClient.basePrice || ''));
    }, [selectedClientId]);

    const filteredClients = useMemo(() =>
        crmClients.filter(c =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            (c.phone || '').includes(search) ||
            (c.aliasCode || '').toLowerCase().includes(search.toLowerCase())
        ),
        [crmClients, search]
    );

    const DURATIONS = [30, 60, 90, 120];

    const handleBook = async () => {
        setSaving(true);
        try {
            if (recurringPattern) {
                const result = await bookingsApi.createRecurringBooking({
                    resourceId: slot.resId,
                    locationId: resource?.locationId || 'unbox_one',
                    startTime: slot.time,
                    duration,
                    format: resource?.formats?.[0] || 'individual',
                    paymentMethod: 'balance',
                    firstDate: dateStr,
                    occurrences: recurringOccurrences,
                    pattern: recurringPattern,
                    crmClientId: selectedClientId || undefined,
                });
                const patternLabel = recurringPattern === 'weekly' ? 'еженедельно' : recurringPattern === 'biweekly' ? 'раз в 2 нед.' : 'ежемесячно';
                toast.success(`Серия создана: ${result.created} бронирований (${patternLabel})`);
                await useUserStore.getState().fetchBookings();
                onClose();
                return;
            }

            const res = await bookingsApi.createBooking({
                resourceId: slot.resId,
                date: dateStr,
                startTime: slot.time,
                duration,
                format: resource?.formats?.[0] || 'individual',
                locationId: resource?.locationId,
            } as any);
            await useUserStore.getState().fetchBookings();
            const newBooking = useUserStore.getState().bookings.find(b => {
                const bd = parseBookingDate(b.date);
                return format(bd, 'yyyy-MM-dd') === dateStr &&
                    b.startTime === slot.time &&
                    b.resourceId === slot.resId &&
                    b.status === 'confirmed';
            });
            await onBooked(
                newBooking?.id || (res as any)?.id || '',
                selectedClientId || null,
                Number(price) || 0
            );
            toast.success('Бронирование создано' + (selectedClientId ? ' и сессия привязана' : ''));
            onClose();
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            if (typeof detail === 'object' && detail?.conflicts) {
                toast.error(`Конфликт: заняты ${detail.conflicts.map((c: any) => c.date).join(', ')}`, { duration: 8000 });
            } else {
                const msg = typeof detail === 'string' ? detail : e.message || 'Ошибка бронирования';
                toast.error(msg);
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in slide-in-from-bottom-4 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-gray-100">
                    <div>
                        <h3 className="font-bold text-base">Забронировать кабинет</h3>
                        <p className="text-sm text-gray-500 mt-0.5">
                            {resource?.name || slot.resId} · {format(slot.date, 'd MMM yyyy', { locale: ru })}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
                        <X size={18} className="text-gray-500" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Time + Duration */}
                    <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
                            <div className="text-xs text-gray-500 mb-0.5">Начало</div>
                            <div className="font-bold text-lg">{slot.time}</div>
                        </div>
                        <div className="text-gray-400">→</div>
                        <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
                            <div className="text-xs text-gray-500 mb-0.5">Конец</div>
                            <div className="font-bold text-lg">{endTime}</div>
                        </div>
                    </div>

                    {/* Duration picker */}
                    <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Длительность</div>
                        <div className="flex gap-2">
                            {DURATIONS.map(d => (
                                <button
                                    key={d}
                                    onClick={() => setDuration(d)}
                                    className={clsx(
                                        'flex-1 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                                        duration === d
                                            ? 'bg-unbox-green text-white border-unbox-green'
                                            : 'border-gray-200 text-gray-600 hover:border-unbox-green hover:text-unbox-green'
                                    )}
                                >
                                    {d < 60 ? `${d}м` : `${d / 60}ч`}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* CRM Client picker (optional) */}
                    <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Link2 size={11} />
                            Привязать клиента CRM <span className="font-normal text-gray-400">(необязательно)</span>
                        </div>
                        <div className="relative mb-2">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Поиск клиента..."
                                className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-unbox-green"
                            />
                        </div>
                        <div className="max-h-36 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50">
                            {/* No client option */}
                            <button
                                onClick={() => setSelectedClientId('')}
                                className={clsx(
                                    'w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-b border-gray-100 transition-colors',
                                    !selectedClientId ? 'bg-gray-100 text-gray-700 font-medium' : 'hover:bg-white text-gray-400 italic'
                                )}
                            >
                                Без клиента
                            </button>
                            {filteredClients.slice(0, 6).map(client => (
                                <button
                                    key={client.id}
                                    onClick={() => setSelectedClientId(client.id)}
                                    className={clsx(
                                        'w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors border-b border-gray-100 last:border-0',
                                        selectedClientId === client.id
                                            ? 'bg-unbox-green/10 text-unbox-dark'
                                            : 'hover:bg-white'
                                    )}
                                >
                                    <div className={clsx(
                                        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                                        selectedClientId === client.id ? 'bg-unbox-green text-white' : 'bg-gray-200 text-gray-600'
                                    )}>
                                        {client.name?.[0]?.toUpperCase() ?? '?'}
                                    </div>
                                    <span className="text-sm font-medium truncate">{client.name}</span>
                                    {selectedClientId === client.id && <UserCheck size={13} className="ml-auto text-unbox-green shrink-0" />}
                                </button>
                            ))}
                            {filteredClients.length === 0 && search && (
                                <div className="p-3 text-center text-xs text-gray-400">Не найдено</div>
                            )}
                        </div>

                        {/* Price if client selected */}
                        {selectedClient && (
                            <div className="mt-3">
                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                                    Стоимость ({selectedClient.currency || 'GEL'})
                                </div>
                                <input
                                    type="number"
                                    value={price}
                                    onChange={e => setPrice(e.target.value)}
                                    placeholder={String(selectedClient.basePrice || 0)}
                                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-unbox-green"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Recurring pattern */}
                <div className="px-5 space-y-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Повторение</div>
                    <div className="grid grid-cols-4 gap-1.5">
                        {([
                            { id: '', label: 'Разово' },
                            { id: 'weekly', label: 'Кажд. неделю' },
                            { id: 'biweekly', label: 'Раз в 2 нед.' },
                            { id: 'monthly', label: 'Ежемесячно' },
                        ] as const).map(p => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => setRecurringPattern(p.id)}
                                className={clsx(
                                    'py-1.5 rounded-lg border text-xs font-medium transition-colors text-center',
                                    recurringPattern === p.id
                                        ? 'bg-unbox-green text-white border-unbox-green'
                                        : 'border-gray-200 text-gray-600 hover:border-unbox-green hover:text-unbox-green'
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    {recurringPattern && (
                        <div className="flex items-center gap-2 pt-1">
                            <input
                                type="number"
                                value={recurringOccurrences}
                                onChange={e => {
                                    const max = recurringPattern === 'monthly' ? 24 : 52;
                                    setRecurringOccurrences(Math.max(2, Math.min(max, Number(e.target.value))));
                                }}
                                min={2}
                                max={recurringPattern === 'monthly' ? 24 : 52}
                                className="w-16 px-2 py-1.5 rounded-lg border border-unbox-light text-sm text-center focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            />
                            <span className="text-xs text-gray-500">
                                повторений · {recurringPattern === 'monthly'
                                    ? `≈ ${recurringOccurrences} мес.`
                                    : recurringPattern === 'biweekly'
                                        ? `≈ ${Math.round(recurringOccurrences / 2)} мес.`
                                        : `≈ ${Math.round(recurringOccurrences / 4.3)} мес.`}
                            </span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-5 pt-3">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">
                        Отмена
                    </button>
                    <button
                        onClick={handleBook}
                        disabled={saving}
                        className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        {recurringPattern ? `Создать серию · ${recurringOccurrences} броней` : selectedClientId ? 'Забронировать + сессия' : 'Забронировать'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Link Client to Existing Booking Modal (multi-slot) ───────────────────────
interface SlotAssignment {
    hour: number; // start minute of the slot (e.g., 840 for 14:00)
    label: string; // e.g., "14:00 – 15:00"
    clientId: string | null;
    price: number;
    existingSessionId?: string;
}

function LinkBookingModal({
    booking,
    crmClients,
    existingSessions,
    onClose,
    onSaveMulti,
    onDeleteBooking,
}: {
    booking: BookingHistoryItem;
    crmClients: CrmClient[];
    existingSessions: { id: string; clientId: string; date: string | Date; durationMinutes?: number }[];
    onClose: () => void;
    /**
     * Persist the slot assignments. Resolve to `false` when the save was
     * partial / aborted (e.g. recurring series rejected because of a
     * cabinet-booking conflict) — the modal will stay open so the user can
     * tweak inputs without losing context. Resolve to anything else (true /
     * void / undefined) for a fully-successful save and the modal closes.
     */
    onSaveMulti: (assignments: SlotAssignment[], opts?: { recurringPattern?: 'weekly' | 'biweekly' | 'monthly' | ''; occurrences?: number }) => Promise<boolean | void>;
    onDeleteBooking: (booking: BookingHistoryItem) => Promise<void>;
}) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const duration = booking.duration || 60;
    const numSlots = Math.max(1, Math.floor(duration / 60));
    const startMin = booking.startTime ? timeToMin(booking.startTime) : 0;

    // Build initial slot assignments from existing sessions
    const [slots, setSlots] = useState<SlotAssignment[]>(() => {
        const result: SlotAssignment[] = [];
        for (let i = 0; i < numSlots; i++) {
            const slotStart = startMin + i * 60;
            const h1 = Math.floor(slotStart / 60);
            const m1 = slotStart % 60;
            const h2 = Math.floor((slotStart + 60) / 60);
            const m2 = (slotStart + 60) % 60;
            const label = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')} – ${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;

            // Find existing session for this hour
            const existing = existingSessions.find(s => {
                try {
                    const d = s.date instanceof Date ? s.date : new Date(String(s.date));
                    const sMin = d.getUTCHours() * 60 + d.getUTCMinutes();
                    return Math.abs(sMin - slotStart) < 30;
                } catch { return false; }
            });

            result.push({
                hour: slotStart,
                label,
                clientId: existing?.clientId || null,
                price: 0,
                existingSessionId: existing?.id,
            });
        }
        return result;
    });

    const [activeSlotIdx, setActiveSlotIdx] = useState(0);
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    // Recurring options for the linked sessions — repeats the client→slot
    // assignment N times into the future (matches the booking-recurrence
    // pattern used elsewhere). Future CRM sessions are created with the
    // same client; if the cabinet isn't booked yet, the specialist will
    // see them as "сессия без брони" and can add the cabinet booking
    // separately (or через recurring booking flow).
    const [recurringPattern, setRecurringPattern] = useState<'' | 'weekly' | 'biweekly' | 'monthly'>('');
    const [recurringOccurrences, setRecurringOccurrences] = useState(8);

    const activeSlot = slots[activeSlotIdx];
    const activeClient = crmClients.find(c => c.id === activeSlot?.clientId);

    const filteredClients = useMemo(() =>
        crmClients.filter(c =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            (c.phone || '').includes(search) ||
            (c.aliasCode || '').toLowerCase().includes(search.toLowerCase())
        ),
        [crmClients, search]
    );

    const updateSlot = (idx: number, clientId: string | null, price?: number) => {
        setSlots(prev => prev.map((s, i) =>
            i === idx ? { ...s, clientId, price: price ?? s.price } : s
        ));
    };

    // Ref guard against double-clicks — `disabled` propagates one render
    // tick after setSaving, so a fast double-click can sneak two requests
    // through (which is exactly how we got two identical conflict toasts).
    const savingRef = useRef(false);
    const handleSave = async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
            const result = await onSaveMulti(slots, recurringPattern ? { recurringPattern, occurrences: recurringOccurrences } : undefined);
            // onSaveMulti returns `true` only when the save fully landed.
            // Recurring conflicts return `false` so we keep the modal open
            // and the specialist can adjust the start date or occurrence
            // count without re-opening from the chessboard.
            if (result !== false) onClose();
        } catch {
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm(
            `Удалить эту бронь?\n\n` +
            `${resource?.name || 'Кабинет'} · ${bookingDateStr} · ${duration} мин\n\n` +
            `Все привязанные сессии (${assignedCount}) останутся в CRM, но потеряют связь с этой бронью кабинета.`
        )) return;
        setDeleting(true);
        try {
            await onDeleteBooking(booking);
            onClose();
        } catch {
        } finally {
            setDeleting(false);
        }
    };

    const bookingDateStr = (() => {
        try {
            const d = booking.date instanceof Date
                ? booking.date
                : new Date(String(booking.date).replace(' 12:00', '').split(' ')[0]);
            return isNaN(d.getTime()) ? '' : format(d, 'd MMM yyyy', { locale: ru });
        } catch { return ''; }
    })();

    const assignedCount = slots.filter(s => s.clientId).length;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in slide-in-from-bottom-4 duration-200 max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-gray-100">
                    <div>
                        <h3 className="font-bold text-base flex items-center gap-2">
                            <Link2 size={15} className="text-unbox-green" />
                            Распределить клиентов
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {resource?.name || 'Кабинет'} · {bookingDateStr} · {duration} мин ({numSlots} {numSlots === 1 ? 'сессия' : numSlots < 5 ? 'сессии' : 'сессий'})
                        </p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleDelete}
                            disabled={deleting || saving}
                            title="Удалить эту бронь"
                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 hover:text-red-600 disabled:opacity-50 transition-colors"
                        >
                            {deleting ? <Loader2 size={16} className="animate-spin" /> : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                            )}
                        </button>
                        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
                            <X size={18} className="text-gray-500" />
                        </button>
                    </div>
                </div>

                <div className="p-5 space-y-4">
                    {/* Slot tabs */}
                    {numSlots > 1 && (
                        <div className="flex gap-1.5">
                            {slots.map((slot, idx) => {
                                const client = crmClients.find(c => c.id === slot.clientId);
                                return (
                                    <button
                                        key={idx}
                                        onClick={() => { setActiveSlotIdx(idx); setSearch(''); }}
                                        className={clsx(
                                            'flex-1 py-2 px-1.5 rounded-xl text-xs font-medium transition-all border-2 text-center',
                                            activeSlotIdx === idx
                                                ? 'border-unbox-green bg-unbox-green/5 text-unbox-dark'
                                                : slot.clientId
                                                    ? 'border-green-200 bg-green-50 text-green-700'
                                                    : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300'
                                        )}
                                    >
                                        <div className="font-bold">{slot.label.split(' – ')[0]}</div>
                                        <div className="text-[10px] mt-0.5 truncate">
                                            {client ? client.name : '—'}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Active slot label */}
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Слот {activeSlot.label}
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Поиск клиента..."
                            className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-unbox-green"
                        />
                    </div>

                    {/* Client list */}
                    <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50">
                        {/* Unlink option */}
                        {activeSlot.clientId && (
                            <button
                                onClick={() => updateSlot(activeSlotIdx, null)}
                                className="w-full text-left px-3 py-2 text-sm border-b border-gray-100 text-gray-400 hover:bg-white italic transition-colors"
                            >
                                Открепить клиента
                            </button>
                        )}
                        {filteredClients.slice(0, 8).map(client => {
                            const isSelected = activeSlot.clientId === client.id;
                            // Check if this client is already assigned to another slot
                            const assignedToOther = slots.some((s, i) => i !== activeSlotIdx && s.clientId === client.id);
                            return (
                                <button
                                    key={client.id}
                                    onClick={() => {
                                        updateSlot(activeSlotIdx, client.id, client.basePrice || 0);
                                        // Auto-advance to next empty slot
                                        if (numSlots > 1) {
                                            const nextEmpty = slots.findIndex((s, i) => i > activeSlotIdx && !s.clientId);
                                            if (nextEmpty >= 0) setTimeout(() => setActiveSlotIdx(nextEmpty), 150);
                                        }
                                    }}
                                    className={clsx(
                                        'w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors border-b border-gray-100 last:border-0',
                                        isSelected ? 'bg-unbox-green/10 text-unbox-dark' :
                                            assignedToOther ? 'bg-blue-50/50 text-blue-600' : 'hover:bg-white'
                                    )}
                                >
                                    <div className={clsx(
                                        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                                        isSelected ? 'bg-unbox-green text-white' :
                                            assignedToOther ? 'bg-blue-200 text-blue-700' : 'bg-gray-200 text-gray-600'
                                    )}>
                                        {client.name?.[0]?.toUpperCase() ?? '?'}
                                    </div>
                                    <span className="text-sm font-medium truncate">{client.name}</span>
                                    {isSelected && <UserCheck size={13} className="ml-auto text-unbox-green shrink-0" />}
                                    {assignedToOther && !isSelected && (
                                        <span className="ml-auto text-[10px] text-blue-500 shrink-0">
                                            {slots.find((s, i) => i !== activeSlotIdx && s.clientId === client.id)?.label.split(' – ')[0]}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                        {filteredClients.length === 0 && (
                            <div className="p-3 text-center text-xs text-gray-400">Клиенты не найдены</div>
                        )}
                    </div>

                    {/* Price for active client */}
                    {activeClient && (
                        <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                                Стоимость ({activeClient.currency || 'GEL'})
                            </div>
                            <input
                                type="number"
                                value={activeSlot.price || ''}
                                onChange={e => updateSlot(activeSlotIdx, activeSlot.clientId, Number(e.target.value) || 0)}
                                placeholder={String(activeClient.basePrice || 0)}
                                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-unbox-green"
                            />
                        </div>
                    )}
                </div>

                {/* Recurring options — visible always, even when no client
                    is linked. With a client → spawn future CRM sessions
                    (with pushToCalendar=true so they land in the specialist's
                    Google Calendar). Without a client → just clone the
                    cabinet booking via createRecurringBooking. */}
                {true && (
                    <div className="px-5 pb-3 pt-0">
                        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Повторять</div>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {([
                                { id: '', label: 'Не повторять' },
                                { id: 'weekly', label: 'Каждую неделю' },
                                { id: 'biweekly', label: 'Раз в 2 недели' },
                                { id: 'monthly', label: 'Раз в месяц' },
                            ] as const).map(p => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setRecurringPattern(p.id as any)}
                                    className={clsx(
                                        'px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors',
                                        recurringPattern === p.id
                                            ? 'bg-unbox-green text-white border-unbox-green'
                                            : 'bg-white text-gray-600 border-gray-200 hover:border-unbox-green/50'
                                    )}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        {recurringPattern && (
                            <div className="flex items-center gap-2 text-xs text-gray-600">
                                <span>Сколько раз:</span>
                                <input
                                    type="number"
                                    min={2}
                                    max={recurringPattern === 'monthly' ? 24 : 52}
                                    value={recurringOccurrences}
                                    onChange={(e) => {
                                        const max = recurringPattern === 'monthly' ? 24 : 52;
                                        const v = Math.max(2, Math.min(max, parseInt(e.target.value) || 8));
                                        setRecurringOccurrences(v);
                                    }}
                                    className="w-16 px-2 py-1 rounded border border-gray-200 text-center"
                                />
                                <span className="text-gray-400">
                                    (включая текущую)
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Footer */}
                <div className="flex gap-3 p-5 pt-0">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                        Отмена
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || (assignedCount === 0 && !recurringPattern)}
                        className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        {assignedCount > 0
                            ? `Сохранить (${assignedCount}/${numSlots})${recurringPattern ? ` × ${recurringOccurrences}` : ''}`
                            : recurringPattern
                                ? `Повторить бронь × ${recurringOccurrences}`
                                : 'Сохранить'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CrmChessboardView({ initialDate }: { initialDate?: Date } = {}) {
    const { bookings, currentUser, fetchBookings } = useUserStore();
    const { resources, fetchResources } = useBookingStore();
    const { clients, sessions, fetchClients, fetchSessions, createSession, updateSession, deleteSession } = useCrmStore();

    const [filterLocation, setFilterLocation] = useState<string>('all');
    const [selectedDate, setSelectedDate] = useState(initialDate ?? new Date());
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [bookSlot, setBookSlot] = useState<{ resId: string; time: string; date: Date; duration: number } | null>(null);
    const [linkBooking, setLinkBooking] = useState<BookingHistoryItem | null>(null);

    // Drag to select
    const [newSlots, setNewSlots] = useState<string[]>([]);
    // 'new' — drag-painting empty slots to pick a fresh booking range.
    // 'move' — grab an existing OWN booking and drop it onto a free
    // slot to reschedule it via PATCH /bookings/:id/reschedule.
    type DragMode = 'new' | 'move' | null;
    const dragModeRef = useRef<DragMode>(null);
    const dragStartRef = useRef<{ resId: string; time: string } | null>(null);
    // For 'move' drag — the booking being relocated and a hover preview slot
    const movingBookingRef = useRef<BookingHistoryItem | null>(null);
    const [moveHover, setMoveHover] = useState<{ resId: string; time: string } | null>(null);
    const [reschedSaving, setReschedSaving] = useState(false);
    const [, setDragTick] = useState(0);
    const forceDragUpdate = () => setDragTick(t => t + 1);

    useEffect(() => {
        fetchBookings();
        fetchResources();
        if (clients.length === 0) fetchClients();
        fetchSessions();
    }, []);

    const weekDays = useMemo(() =>
        eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) }),
        [weekStart]
    );

    const filteredResources = useMemo(() =>
        resources.filter(r =>
            r.isActive !== false &&
            (filterLocation === 'all' || r.locationId === filterLocation)
        ),
        [resources, filterLocation]
    );

    // Bookings for selected date
    const bookingsOnDate = useMemo(() => {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        return bookings.filter(b => {
            if (!b.date) return false;
            try {
                const bd = parseBookingDate(b.date);
                return format(bd, 'yyyy-MM-dd') === dateStr &&
                    (b.status === 'confirmed' || b.status === 're-rented' || b.status === 'completed');
            } catch { return false; }
        });
    }, [bookings, selectedDate]);

    // Slot map
    const slotMap = useMemo(() => {
        const map = new Map<string, { booking: BookingHistoryItem; isStart: boolean }>();
        bookingsOnDate.forEach(booking => {
            if (!booking.startTime || !booking.duration || !booking.resourceId) return;
            const startMin = timeToMin(booking.startTime);
            const dur = booking.duration;
            TIME_SLOTS.forEach(slot => {
                const sMin = timeToMin(slot);
                if (sMin >= startMin && sMin < startMin + dur) {
                    map.set(`${booking.resourceId}|${slot}`, {
                        booking,
                        isStart: sMin === startMin,
                    });
                }
            });
        });
        return map;
    }, [bookingsOnDate]);

    // Session lookup by bookingId (one booking can have multiple hourly sessions)
    const sessionsByBookingId = useMemo(() => {
        const map = new Map<string, (typeof sessions[0])[]>();
        sessions.forEach(s => {
            if (s.bookingId) {
                const arr = map.get(s.bookingId) || [];
                arr.push(s);
                map.set(s.bookingId, arr);
            }
        });
        return map;
    }, [sessions]);

    // Client lookup
    const clientById = useMemo(() => {
        const map = new Map<string, CrmClient>();
        clients.forEach(c => map.set(c.id, c));
        return map;
    }, [clients]);

    // Row cells
    const rowCellsMap = useMemo(() => {
        const now = new Date();
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const nowStr = format(now, 'yyyy-MM-dd');

        const isPast = (slot: string): boolean => {
            if (dateStr < nowStr) return true;
            if (dateStr > nowStr) return false;
            return timeToMin(slot) < now.getHours() * 60 + now.getMinutes();
        };

        const map = new Map<string, CellInfo[]>();
        filteredResources.forEach(resource => {
            const cells: CellInfo[] = [];
            let i = 0;
            while (i < TIME_SLOTS.length) {
                const slot = TIME_SLOTS[i];
                const entry = slotMap.get(`${resource.id}|${slot}`);
                if (entry?.isStart) {
                    const colspan = Math.min(
                        Math.ceil((entry.booking.duration || 60) / 30),
                        TIME_SLOTS.length - i
                    );
                    const isMine = entry.booking.userId === currentUser?.email;
                    cells.push({ type: 'booking', slot, booking: entry.booking, colspan, isMine });
                    i += colspan;
                } else {
                    cells.push({ type: 'free', slot, past: isPast(slot) });
                    i++;
                }
            }
            map.set(resource.id, cells);
        });
        return map;
    }, [filteredResources, slotMap, selectedDate, currentUser?.email]);

    // Drag helpers
    const isSlotOccupied = useCallback((resId: string, time: string) => {
        const now = new Date();
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const nowStr = format(now, 'yyyy-MM-dd');
        if (dateStr < nowStr) return true;
        if (dateStr === nowStr && timeToMin(time) < now.getHours() * 60 + now.getMinutes()) return true;
        return slotMap.has(`${resId}|${time}`);
    }, [selectedDate, slotMap]);

    const isNewSlotSelected = (resId: string, time: string) =>
        newSlots.includes(`${resId}|${time}`);

    const setNewSlotRange = useCallback((resId: string, times: string[]) => {
        setNewSlots(prev => {
            const other = prev.filter(s => !s.startsWith(`${resId}|`));
            return [...other, ...times.map(t => `${resId}|${t}`)];
        });
    }, []);

    const selectedBlock = useMemo(() => {
        if (newSlots.length === 0) return null;
        const [resId] = newSlots[0].split('|');
        const times = newSlots.filter(s => s.startsWith(`${resId}|`)).map(s => s.split('|')[1]);
        const indices = times.map(t => TIME_SLOTS.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b);
        if (indices.length === 0) return null;
        return { resId, start: indices[0], end: indices[indices.length - 1] };
    }, [newSlots]);

    const handleDragDown = (resId: string, time: string) => {
        if (isSlotOccupied(resId, time)) return;
        dragModeRef.current = 'new';
        dragStartRef.current = { resId, time };
        setNewSlotRange(resId, [time]);
        forceDragUpdate();
    };

    /** Start dragging an OWN booking to relocate it. The booking can be
     *  dropped on any free slot (any cabinet, any time within the day);
     *  on drop we PATCH /bookings/:id/reschedule. Forbid past slots. */
    const handleBookingMoveDown = (booking: BookingHistoryItem) => {
        // Only confirmed bookings; cancelled/completed don't move
        if (booking.status !== 'confirmed') return;
        dragModeRef.current = 'move';
        movingBookingRef.current = booking;
        forceDragUpdate();
    };

    const handleDragEnter = useCallback((resId: string, time: string) => {
        if (dragModeRef.current === 'move') {
            setMoveHover({ resId, time });
            return;
        }
        if (!dragModeRef.current || !dragStartRef.current) return;
        if (dragStartRef.current.resId !== resId) return;
        const startIdx = TIME_SLOTS.indexOf(dragStartRef.current.time);
        const curIdx = TIME_SLOTS.indexOf(time);
        if (startIdx === -1 || curIdx === -1) return;
        const minIdx = Math.min(startIdx, curIdx);
        const maxIdx = Math.max(startIdx, curIdx);
        const slots: string[] = [];
        let blocked = false;
        for (let i = minIdx; i <= maxIdx; i++) {
            if (isSlotOccupied(resId, TIME_SLOTS[i])) { blocked = true; break; }
            slots.push(TIME_SLOTS[i]);
        }
        if (!blocked) setNewSlotRange(resId, slots);
    }, [isSlotOccupied, setNewSlotRange]);

    const handleDragUp = useCallback(() => {
        if (!dragModeRef.current) return;

        // Reschedule branch: dropped a moved booking onto a free slot
        if (dragModeRef.current === 'move') {
            const booking = movingBookingRef.current;
            const target = moveHover;
            dragModeRef.current = null;
            movingBookingRef.current = null;
            setMoveHover(null);
            forceDragUpdate();
            if (!booking || !target) return;
            // Same slot? — no-op
            const sameSlot = (booking.resourceId === target.resId)
                && (booking.startTime === target.time)
                && (format(parseUTC(booking.date), 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd'));
            if (sameSlot) return;
            // Verify target slot is free for the full duration of the booking
            const dur = booking.duration || 60;
            const need = Math.ceil(dur / 30);
            const idx = TIME_SLOTS.indexOf(target.time);
            if (idx < 0) { toast.error('Слот вне расписания'); return; }
            for (let i = idx; i < idx + need; i++) {
                if (i >= TIME_SLOTS.length) { toast.error('Бронь не помещается до конца дня'); return; }
                if (isSlotOccupied(target.resId, TIME_SLOTS[i])) { toast.error('Слот занят целиком — выберите другое время'); return; }
            }
            // Fire reschedule
            setReschedSaving(true);
            const newDate = format(selectedDate, 'yyyy-MM-dd');
            bookingsApi.rescheduleBooking(booking.id, {
                newDate,
                newStartTime: target.time,
                newResourceId: target.resId,
            }).then(async () => {
                toast.success('Бронь перенесена');
                await fetchBookings();
            }).catch((err) => {
                toast.error(apiErrorMessage(err, 'Не удалось перенести бронь'));
            }).finally(() => setReschedSaving(false));
            return;
        }

        dragModeRef.current = null;
        dragStartRef.current = null;
        forceDragUpdate();
        // Auto-extend to at least 60min
        setNewSlots(prev => {
            if (prev.length !== 1) return prev;
            const [resId, timeStr] = prev[0].split('|');
            const idx = TIME_SLOTS.indexOf(timeStr);
            if (idx >= 0 && idx + 1 < TIME_SLOTS.length && !isSlotOccupied(resId, TIME_SLOTS[idx + 1])) {
                return [...prev, `${resId}|${TIME_SLOTS[idx + 1]}`];
            }
            return prev;
        });
    }, [isSlotOccupied, moveHover, selectedDate, fetchBookings]);

    useEffect(() => {
        const handleMove = (e: PointerEvent) => {
            if (!dragModeRef.current) return;
            const target = document.elementFromPoint(e.clientX, e.clientY);
            if (!target) return;
            const el = target.closest('[data-crm-resid][data-crm-time]');
            if (el) {
                const rId = el.getAttribute('data-crm-resid');
                const tStr = el.getAttribute('data-crm-time');
                if (rId && tStr) handleDragEnter(rId, tStr);
            }
        };
        window.addEventListener('pointerup', handleDragUp);
        window.addEventListener('pointermove', handleMove);
        return () => {
            window.removeEventListener('pointerup', handleDragUp);
            window.removeEventListener('pointermove', handleMove);
        };
    }, [handleDragUp, handleDragEnter]);

    useEffect(() => { setNewSlots([]); }, [selectedDate]);

    const handleContinue = () => {
        if (!selectedBlock) return;
        const startTime = TIME_SLOTS[selectedBlock.start];
        const duration = (selectedBlock.end - selectedBlock.start + 1) * 30;
        setBookSlot({ resId: selectedBlock.resId, time: startTime, date: selectedDate, duration });
    };

    const handleBooked = async (bookingId: string, clientId: string | null, price: number) => {
        if (clientId && bookingId) {
            const bookingDate = format(selectedDate, 'yyyy-MM-dd');
            const timeStr = bookSlot?.time || '00:00';
            await createSession({
                clientId,
                date: `${bookingDate}T${timeStr}:00`,
                durationMinutes: bookSlot?.duration || 60,
                price: price || undefined,
                bookingId,
                isBooked: true,
            });
        }
        await fetchBookings();
        await fetchSessions();
        setNewSlots([]);
        setBookSlot(null);
    };

    // Handle saving multi-slot client assignments for a booking
    const handleMultiSlotSave = async (
        booking: BookingHistoryItem,
        slotAssignments: { hour: number; clientId: string | null; price: number; existingSessionId?: string }[],
        opts?: { recurringPattern?: 'weekly' | 'biweekly' | 'monthly' | ''; occurrences?: number }
    ) => {
        const rawDate = booking.date as any;
        let dateStr: string;
        if (rawDate instanceof Date) {
            dateStr = format(rawDate, 'yyyy-MM-dd');
        } else {
            dateStr = String(rawDate).replace(' 12:00', '').split('T')[0].split(' ')[0];
        }

        for (const slot of slotAssignments) {
            const h = Math.floor(slot.hour / 60);
            const m = slot.hour % 60;
            const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            const sessionDate = `${dateStr}T${timeStr}:00`;

            if (slot.existingSessionId) {
                if (slot.clientId) {
                    await updateSession(slot.existingSessionId, {
                        clientId: slot.clientId,
                        price: slot.price || undefined,
                        date: sessionDate,
                    });
                } else {
                    await deleteSession(slot.existingSessionId);
                }
            } else if (slot.clientId) {
                await createSession({
                    clientId: slot.clientId,
                    date: sessionDate,
                    durationMinutes: 60,
                    price: slot.price || undefined,
                    bookingId: booking.id,
                    isBooked: true,
                });
            }
        }

        // Recurring strategy:
        //   • If at least one slot has a linked client → spawn future CRM
        //     sessions (with pushToCalendar=true so they appear in the
        //     specialist's Google Calendar — that's the user-visible side).
        //   • If NO clients are linked → user just wants to repeat the
        //     cabinet booking on the same weekday. Use createRecurringBooking
        //     which clones the booking N times and writes GCal events from
        //     the booking-side sync (each cabinet has its own Google
        //     Calendar that shows the rental).
        let recurringCreated = 0;
        let recurringBookings = 0;
        // Set when the cabinet recurring call returned a 4xx (atomic fail).
        // Used below to suppress the misleading green "Сохранено" toast.
        let recurringFailed = false;
        if (opts?.recurringPattern && opts.occurrences && opts.occurrences > 1) {
            const hasClients = slotAssignments.some(s => s.clientId);
            if (hasClients) {
                const baseDate = new Date(`${dateStr}T00:00:00`);
                // One UUID stamped on every CRM session in this series — lets
                // the delete UI later offer "this one vs this+future" the way
                // Google Calendar does. Generated once per click, not per slot,
                // so multi-client recurring (rare but possible) shares a group.
                const recurringGroupId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : `rg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                for (let n = 1; n < opts.occurrences; n++) {
                    let nextDate: Date;
                    if (opts.recurringPattern === 'weekly') {
                        nextDate = new Date(baseDate); nextDate.setDate(nextDate.getDate() + 7 * n);
                    } else if (opts.recurringPattern === 'biweekly') {
                        nextDate = new Date(baseDate); nextDate.setDate(nextDate.getDate() + 14 * n);
                    } else { // monthly
                        nextDate = new Date(baseDate); nextDate.setMonth(nextDate.getMonth() + n);
                    }
                    const nextDateStr = format(nextDate, 'yyyy-MM-dd');
                    for (const slot of slotAssignments) {
                        if (!slot.clientId) continue;
                        const h = Math.floor(slot.hour / 60);
                        const m = slot.hour % 60;
                        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                        try {
                            await createSession({
                                clientId: slot.clientId,
                                date: `${nextDateStr}T${timeStr}:00`,
                                durationMinutes: 60,
                                price: slot.price || undefined,
                                // pushToCalendar=true so each future session
                                // shows up in the specialist's Google Calendar
                                // (calendar_id from /crm/settings).
                                pushToCalendar: true,
                                recurringGroupId,
                                isBooked: false,
                            });
                            recurringCreated++;
                        } catch (e) {
                            // Don't swallow silently — earlier we did, and a
                            // missing gcal_event_id was invisible to the
                            // specialist. Log so it surfaces in DevTools.
                            console.error('Recurring CRM session create failed', {
                                date: `${nextDateStr}T${timeStr}:00`,
                                clientId: slot.clientId,
                                error: e,
                            });
                        }
                    }
                }
            } else {
                // No clients → recurring CABINET booking. Bot the back-end
                // creates one bookings per occurrence and syncs each into
                // the cabinet's Google Calendar.
                try {
                    const res = await bookingsApi.createRecurringBooking({
                        resourceId: booking.resourceId || '',
                        locationId: (booking as any).locationId || booking.resourceId || '',
                        startTime: booking.startTime || '00:00',
                        duration: booking.duration || 60,
                        format: (booking as any).format || 'individual',
                        paymentMethod: (booking as any).paymentMethod || 'balance',
                        firstDate: dateStr,
                        occurrences: opts.occurrences,
                        pattern: opts.recurringPattern,
                    });
                    recurringBookings = res.created || 0;
                } catch (e: any) {
                    toast.error(apiErrorMessage(e, 'Не удалось создать серию броней'));
                    // Atomic backend: nothing was created. Mark the failure so
                    // we don't follow up with a misleading "Сохранено" toast.
                    recurringFailed = true;
                }
            }
        }

        // Toast logic — distinguish "everything saved", "partial save", and
        // "nothing saved". Earlier we always closed with toast.success which
        // showed a green "Сохранено" right next to a red conflict toast and
        // confused the user.
        const savedSomething =
            slotAssignments.some(s => s.clientId || s.existingSessionId) ||
            recurringCreated > 0 ||
            recurringBookings > 0;
        const partsMsg: string[] = [];
        if (slotAssignments.some(s => s.clientId || s.existingSessionId)) partsMsg.push('сессии сохранены');
        if (recurringCreated > 0) partsMsg.push(`+${recurringCreated} будущих сессий в Google Calendar`);
        if (recurringBookings > 0) partsMsg.push(`+${recurringBookings} будущих броней кабинета`);
        if (savedSomething) {
            toast.success(partsMsg.length ? partsMsg.join(' · ') : 'Сохранено');
        }
        // If only the recurring failed, stay quiet — the red conflict toast
        // already explains everything; a green companion would lie.
        await fetchSessions();
        if (recurringBookings > 0) await fetchBookings();
        // Keep the modal open after a failed series so the specialist can
        // tweak (e.g. shift start date by a week) without re-opening from
        // the chessboard. Modal closes itself when this returns truthy.
        if (recurringFailed && !savedSomething) {
            return false;
        }
        setLinkBooking(null);
        return true;
    };

    const handleDeleteBooking = async (booking: BookingHistoryItem) => {
        try {
            await bookingsApi.cancelBooking(booking.id);
            toast.success('Бронь удалена');
            await fetchBookings();
            await fetchSessions();
            setLinkBooking(null);
        } catch (err: any) {
            toast.error(apiErrorMessage(err, 'Не удалось удалить бронь'));
            throw err;
        }
    };

    const SLOT_W = 48; // px per 30-min slot

    // ── Mobile detection ──
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);

    const [mobileResIdx, setMobileResIdx] = useState(0);
    const mobileRes = filteredResources[mobileResIdx] || filteredResources[0];

    // Mobile tap: tap full-hour = select pair (XX:00 + XX:30), tap individual = extend/toggle
    const handleMobileTap = (resId: string, time: string, _isHourTap: boolean) => {
        if (isSlotOccupied(resId, time)) return;
        const slotIdx = TIME_SLOTS.indexOf(time);

        // If tapping an already-selected slot, deselect all
        if (newSlots.includes(`${resId}|${time}`)) {
            setNewSlots([]);
            return;
        }

        // If we already have a block, extend it — always +1 slot at a time
        if (selectedBlock && selectedBlock.resId === resId) {
            const newStart = Math.min(selectedBlock.start, slotIdx);
            const newEnd = Math.max(selectedBlock.end, slotIdx);
            const slots: string[] = [];
            for (let i = newStart; i <= newEnd; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) return;
                slots.push(TIME_SLOTS[i]);
            }
            setNewSlotRange(resId, slots);
        } else {
            // First selection — ALWAYS auto-select pair (1h minimum)
            const pairStart = slotIdx % 2 === 0 ? slotIdx : slotIdx - 1;
            const pairEnd = pairStart + 1;
            if (pairEnd >= TIME_SLOTS.length) return;
            const slots: string[] = [];
            for (let i = pairStart; i <= pairEnd; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) return;
                slots.push(TIME_SLOTS[i]);
            }
            setNewSlotRange(resId, slots);
        }
    };

    // Group TIME_SLOTS into hour-pairs for mobile grid: [[09:00, 09:30], [10:00, 10:30], ...]
    const mobileHourPairs = useMemo(() => {
        const pairs: [string, string | null][] = [];
        for (let i = 0; i < TIME_SLOTS.length; i += 2) {
            pairs.push([TIME_SLOTS[i], TIME_SLOTS[i + 1] ?? null]);
        }
        return pairs;
    }, []);

    // ── Shared controls (used in both mobile and desktop) ──
    const weekNav = (
        <div className="flex items-center gap-2">
            <button onClick={() => setWeekStart(subWeeks(weekStart, 1))} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium min-w-[100px] md:min-w-[160px] text-center">
                {format(weekStart, 'd MMM', { locale: ru })} – {format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'd MMM', { locale: ru })}
            </span>
            <button onClick={() => setWeekStart(addWeeks(weekStart, 1))} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                <ChevronRight size={16} />
            </button>
        </div>
    );

    const daySelector = (
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {weekDays.map(day => {
                const active = isSameDay(day, selectedDate);
                const today = isToday(day);
                return (
                    <button
                        key={day.toISOString()}
                        onClick={() => setSelectedDate(day)}
                        className={clsx(
                            'flex flex-col items-center px-2.5 md:px-3 py-2 rounded-xl min-w-[44px] md:min-w-[52px] text-sm transition-colors border',
                            active
                                ? 'bg-unbox-green text-white border-unbox-green'
                                : today
                                    ? 'border-unbox-green text-unbox-green hover:bg-unbox-light/30'
                                    : 'border-transparent text-gray-500 hover:bg-gray-50'
                        )}
                    >
                        <span className="text-[10px] uppercase font-semibold opacity-70">
                            {format(day, 'EEEEEE', { locale: ru })}
                        </span>
                        <span className="font-bold text-base leading-none">{format(day, 'd')}</span>
                    </button>
                );
            })}
        </div>
    );

    const selectedBar = newSlots.length > 0 && selectedBlock ? (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-unbox-green/10 border border-unbox-green/30 rounded-xl px-3 sm:px-4 py-2.5">
            <span className="text-sm font-medium text-unbox-dark">
                {RESOURCES.find(r => r.id === selectedBlock.resId)?.name} · {TIME_SLOTS[selectedBlock.start]} – {TIME_SLOTS[selectedBlock.end + 1] ?? '21:00'} ({(selectedBlock.end - selectedBlock.start + 1) * 30} мин)
            </span>
            <div className="flex gap-2 w-full sm:w-auto">
                <button onClick={() => setNewSlots([])} className="flex-1 sm:flex-initial px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
                    Сбросить
                </button>
                <button onClick={handleContinue} className="flex-1 sm:flex-initial px-3 py-1.5 text-sm rounded-lg bg-unbox-green text-white hover:bg-unbox-dark font-semibold">
                    Забронировать →
                </button>
            </div>
        </div>
    ) : null;

    // ── MOBILE VIEW ──
    if (isMobile) {
        // Build a lookup for booking cells by slot
        const mobileCells = mobileRes ? (rowCellsMap.get(mobileRes.id) ?? []) : [];
        const bookingBySlot = new Map<string, CellInfo>();
        mobileCells.forEach(c => { if (c.type === 'booking') bookingBySlot.set(c.slot, c); });
        // Track which slots are "consumed" by a multi-slot booking so we skip them
        const consumedSlots = new Set<string>();
        mobileCells.forEach(c => {
            if (c.type === 'booking') {
                const startIdx = TIME_SLOTS.indexOf(c.slot);
                for (let i = 1; i < c.colspan; i++) consumedSlots.add(TIME_SLOTS[startIdx + i]);
            }
        });

        // Render a single mobile slot cell
        const renderMobileSlot = (slot: string | null, isHourCol: boolean) => {
            if (!slot || !mobileRes) return <div className="flex-1" />;

            // If consumed by a booking that started earlier, skip
            if (consumedSlots.has(slot)) return null;

            const bookingCell = bookingBySlot.get(slot);
            if (bookingCell && bookingCell.type === 'booking') {
                const { booking, isMine, colspan } = bookingCell;
                const linkedSessions = sessionsByBookingId.get(booking.id) || [];
                const firstSession = linkedSessions[0];
                const linkedClient = firstSession ? clientById.get(firstSession.clientId) : undefined;
                const endSlotIdx = TIME_SLOTS.indexOf(slot) + colspan;
                const endTime = endSlotIdx < TIME_SLOTS.length ? TIME_SLOTS[endSlotIdx] : '21:00';
                // For multi-slot bookings that span to the next column, we'll handle via colspan spanning
                return (
                    <button
                        onClick={isMine ? () => setLinkBooking(booking) : undefined}
                        className={clsx(
                            'flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors min-h-[48px]',
                            isMine
                                ? 'bg-unbox-green/10 border border-unbox-green/30 text-unbox-dark'
                                : 'bg-gray-100 border border-gray-200 text-gray-400'
                        )}
                    >
                        <div className="min-w-0">
                            <div className="text-xs font-bold tabular-nums">{slot}–{endTime}</div>
                            <div className="text-[10px] truncate">
                                {isMine
                                    ? (linkedSessions.length > 1
                                        ? `${linkedSessions.length} клиента`
                                        : linkedClient?.name || 'Привязать клиента')
                                    : (booking.userId?.split('@')[0] || 'Занято')
                                }
                            </div>
                        </div>
                        {isMine && <UserPlus size={12} className="text-unbox-green shrink-0" />}
                    </button>
                );
            }

            // Free slot
            const past = (() => {
                const cell = mobileCells.find(c => c.slot === slot);
                return cell?.type === 'free' ? cell.past : false;
            })();
            const selected = isNewSlotSelected(mobileRes.id, slot);

            return (
                <button
                    onClick={() => !past && handleMobileTap(mobileRes.id, slot, isHourCol)}
                    disabled={past}
                    className={clsx(
                        'flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl transition-all min-h-[48px]',
                        past
                            ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                            : selected
                                ? 'bg-unbox-green text-white shadow-sm'
                                : isPeakTime(slot)
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200/60 active:scale-[0.97]'
                                    : 'bg-white text-gray-700 border border-gray-100 active:scale-[0.97]'
                    )}
                >
                    <span className={clsx('text-sm font-bold tabular-nums', selected ? 'text-white' : past ? 'text-gray-300' : 'text-gray-700')}>
                        {slot}
                    </span>
                    {selected ? (
                        <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        </div>
                    ) : !past ? (
                        <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
                    ) : null}
                </button>
            );
        };

        return (
            <div className="space-y-3">
                {weekNav}
                {daySelector}

                {/* Resource tabs */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                    {filteredResources.map((r, idx) => (
                        <button
                            key={r.id}
                            onClick={() => setMobileResIdx(idx)}
                            className={clsx(
                                'shrink-0 px-3 py-2 rounded-xl text-xs font-medium border transition-colors',
                                mobileResIdx === idx
                                    ? 'bg-unbox-green text-white border-unbox-green'
                                    : 'bg-white text-gray-500 border-gray-200'
                            )}
                        >
                            {r.name}
                        </button>
                    ))}
                </div>

                {selectedBar}

                {/* 2-column time grid */}
                <div className="rounded-2xl bg-white border border-gray-100 p-2 space-y-1">
                    {mobileHourPairs.map(([left, right]) => {
                        const leftRendered = renderMobileSlot(left, true);
                        const rightRendered = right ? renderMobileSlot(right, false) : <div className="flex-1" />;
                        // If both are null (consumed by booking), skip row
                        if (!leftRendered && !rightRendered) return null;
                        return (
                            <div key={left} className="flex gap-1.5">
                                {leftRendered || <div className="flex-1" />}
                                {rightRendered}
                            </div>
                        );
                    })}
                </div>

                {/* Modals */}
                {bookSlot && (
                    <CrmQuickBookModal
                        slot={bookSlot}
                        crmClients={clients}
                        onClose={() => setBookSlot(null)}
                        onBooked={handleBooked}
                    />
                )}
                {linkBooking && (
                    <LinkBookingModal
                        booking={linkBooking}
                        crmClients={clients}
                        existingSessions={sessionsByBookingId.get(linkBooking.id)?.map(s => ({ id: s.id, clientId: s.clientId, date: s.date, durationMinutes: s.durationMinutes })) || []}
                        onClose={() => setLinkBooking(null)}
                        onSaveMulti={(assignments, recOpts) => handleMultiSlotSave(linkBooking, assignments, recOpts)}
                        onDeleteBooking={handleDeleteBooking}
                    />
                )}
            </div>
        );
    }

    // ── DESKTOP VIEW ──

    return (
        <div className="space-y-4" onPointerUp={handleDragUp}>
            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Location filter */}
                <div className="flex gap-1.5 flex-wrap">
                    {[{ id: 'all', name: 'Все' }, ...LOCATIONS].map(loc => (
                        <button
                            key={loc.id}
                            onClick={() => setFilterLocation(loc.id)}
                            className={clsx(
                                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                                filterLocation === loc.id
                                    ? 'bg-unbox-green text-white border-unbox-green'
                                    : 'bg-white text-gray-600 border-gray-200 hover:border-unbox-green hover:text-unbox-green'
                            )}
                        >
                            {loc.name}
                        </button>
                    ))}
                </div>

                {weekNav}
            </div>

            {daySelector}

            {selectedBar}

            {/* Grid */}
            <ChessboardScroller minGridWidth={180 + TIME_SLOTS.length * SLOT_W}>
                <table className="border-collapse" style={{ minWidth: `${180 + TIME_SLOTS.length * SLOT_W}px` }}>
                    <thead>
                        <tr>
                            <th className="sticky left-0 z-10 bg-white border-b border-r border-gray-100 px-3 py-2 text-left text-xs text-gray-400 font-medium min-w-[180px]">
                                Кабинет
                            </th>
                            {TIME_SLOTS.map((slot, i) => (
                                <th
                                    key={slot}
                                    className={clsx(
                                        "border-b border-gray-50 text-[10px] font-normal py-1 text-center",
                                        isPeakTime(slot) ? "text-amber-500 bg-amber-50/30" : "text-gray-400"
                                    )}
                                    style={{ width: SLOT_W, minWidth: SLOT_W }}
                                >
                                    {i % 2 === 0 ? slot : ''}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredResources.map(resource => {
                            const cells = rowCellsMap.get(resource.id) ?? [];
                            return (
                                <tr key={resource.id} className="group/row">
                                    <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-100 px-3 py-2 text-sm font-medium text-gray-700 group-hover/row:bg-gray-50 transition-colors">
                                        {resource.name}
                                    </td>
                                    {cells.map((cell) => {
                                        if (cell.type === 'booking') {
                                            const { booking, colspan, isMine } = cell;
                                            const linkedSessions = sessionsByBookingId.get(booking.id) || [];
                                            // For single-hour bookings, show the first linked client; for multi-hour, show count
                                            const firstSession = linkedSessions[0];
                                            const linkedClient = firstSession ? clientById.get(firstSession.clientId) : undefined;

                                            // Multi-client split view
                                            const SEGMENT_COLORS = [
                                                'bg-unbox-green/15 border-unbox-green/40 hover:bg-unbox-green/25',
                                                'bg-blue-100/60 border-blue-300/50 hover:bg-blue-100',
                                                'bg-amber-100/60 border-amber-300/50 hover:bg-amber-100',
                                                'bg-purple-100/60 border-purple-300/50 hover:bg-purple-100',
                                            ];

                                            const hasMultipleClients = isMine && linkedSessions.length > 1;

                                            return (
                                                <td
                                                    key={`${resource.id}-${cell.slot}`}
                                                    colSpan={colspan}
                                                    className="border-b border-gray-50 py-1 px-0.5"
                                                >
                                                    {hasMultipleClients ? (
                                                        <div
                                                            className="h-8 flex rounded-md overflow-hidden cursor-pointer"
                                                            onClick={() => setLinkBooking(booking)}
                                                        >
                                                            {linkedSessions
                                                                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                                                                .map((sess, idx) => {
                                                                    const cl = clientById.get(sess.clientId);
                                                                    const totalDur = linkedSessions.reduce((s, x) => s + (x.durationMinutes || 60), 0);
                                                                    const pct = ((sess.durationMinutes || 60) / totalDur) * 100;
                                                                    const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
                                                                    return (
                                                                        <div
                                                                            key={sess.id}
                                                                            style={{ width: `${pct}%` }}
                                                                            className={clsx(
                                                                                'h-full border-y first:border-l last:border-r first:rounded-l-md last:rounded-r-md',
                                                                                'text-[9px] font-semibold flex items-center px-1 overflow-hidden select-none transition-colors',
                                                                                'text-unbox-dark',
                                                                                color,
                                                                                idx > 0 && 'border-l border-dashed border-gray-300'
                                                                            )}
                                                                            title={cl ? `${cl.name} · ${sess.durationMinutes || 60} мин` : `Слот ${idx + 1}`}
                                                                        >
                                                                            <span className="truncate">{cl?.name || `#${idx + 1}`}</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                        </div>
                                                    ) : (
                                                        <div
                                                            // pointerdown → start drag-to-move; click → open link modal.
                                                            // The drag handler waits for pointer-move before
                                                            // committing to "move" so a plain tap still opens
                                                            // the modal (handled in handleDragUp branch).
                                                            onPointerDown={isMine ? (e) => {
                                                                if (e.pointerType === 'mouse' && e.button !== 0) return;
                                                                e.preventDefault();
                                                                handleBookingMoveDown(booking);
                                                            } : undefined}
                                                            onClick={isMine ? (e) => {
                                                                // Only treat as click if no drag happened
                                                                if (dragModeRef.current === 'move' && moveHover) return;
                                                                e.stopPropagation();
                                                                setLinkBooking(booking);
                                                            } : undefined}
                                                            className={clsx(
                                                                'h-8 rounded-md border text-[10px] font-semibold flex items-center px-1.5 overflow-hidden select-none gap-1',
                                                                isMine
                                                                    ? 'bg-unbox-green/15 text-unbox-dark border-unbox-green/40 cursor-grab active:cursor-grabbing hover:bg-unbox-green/25 hover:border-unbox-green/60 transition-colors group'
                                                                    : 'bg-gray-100 text-gray-400 border-gray-200 cursor-default',
                                                                reschedSaving && 'opacity-60 pointer-events-none'
                                                            )}
                                                            title={isMine ? `${linkedClient ? linkedClient.name : 'Слот'} — потяните на свободное время чтобы перенести, клик — изменить клиента` : undefined}
                                                        >
                                                            <span className="truncate flex-1">
                                                                {isMine
                                                                    ? (linkedClient ? linkedClient.name : '✓ Моё')
                                                                    : 'Занято'}
                                                            </span>
                                                            {isMine && (
                                                                <UserPlus
                                                                    size={10}
                                                                    className={clsx(
                                                                        'shrink-0 transition-opacity',
                                                                        linkedClient ? 'opacity-0 group-hover:opacity-60' : 'opacity-40 group-hover:opacity-100'
                                                                    )}
                                                                />
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        }

                                        // Free cell
                                        const { slot, past } = cell;
                                        const isSelected = isNewSlotSelected(resource.id, slot);

                                        return (
                                            <td
                                                key={`${resource.id}-${slot}`}
                                                data-crm-resid={resource.id}
                                                data-crm-time={slot}
                                                onPointerDown={e => {
                                                    if (past) return;
                                                    e.preventDefault();
                                                    handleDragDown(resource.id, slot);
                                                }}
                                                onPointerEnter={() => {
                                                    if (!past) handleDragEnter(resource.id, slot);
                                                }}
                                                className={clsx(
                                                    'border-b border-r border-gray-50 py-1 px-0.5 transition-colors',
                                                    past
                                                        ? 'bg-gray-50 cursor-not-allowed'
                                                        : isSelected
                                                            ? 'bg-unbox-green/20 cursor-pointer'
                                                            : (dragModeRef.current === 'move' && moveHover?.resId === resource.id && moveHover?.time === slot)
                                                                ? 'bg-blue-200/60 ring-2 ring-blue-400 cursor-copy'
                                                                : isPeakTime(slot)
                                                                    ? 'bg-amber-50/50 hover:bg-amber-100/40 cursor-pointer'
                                                                    : 'hover:bg-unbox-light/40 cursor-pointer'
                                                )}
                                                style={{ width: SLOT_W, minWidth: SLOT_W, height: 40 }}
                                            >
                                                {isSelected && (
                                                    <div className="h-full w-full rounded-sm bg-unbox-green/30" />
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </ChessboardScroller>

            {/* Legend */}
            <div className="flex gap-4 text-xs text-gray-500">
                <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-unbox-green/15 border border-unbox-green/40 inline-block" />
                    Мои бронирования
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-gray-100 border border-gray-200 inline-block" />
                    Занято
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-unbox-green/20 border border-unbox-green/40 inline-block" />
                    Выбрано
                </div>
            </div>

            {/* New booking modal (drag-to-select) */}
            {bookSlot && (
                <CrmQuickBookModal
                    slot={bookSlot}
                    crmClients={clients.filter(c => c.isActive)}
                    onClose={() => { setBookSlot(null); setNewSlots([]); }}
                    onBooked={handleBooked}
                />
            )}

            {/* Link client to existing booking modal */}
            {linkBooking && (
                <LinkBookingModal
                    booking={linkBooking}
                    crmClients={clients.filter(c => c.isActive)}
                    existingSessions={sessionsByBookingId.get(linkBooking.id) || []}
                    onClose={() => setLinkBooking(null)}
                    onSaveMulti={(assignments, recOpts) => handleMultiSlotSave(linkBooking, assignments, recOpts)}
                    onDeleteBooking={handleDeleteBooking}
                />
            )}
        </div>
    );
}
