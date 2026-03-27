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
import type { BookingHistoryItem } from '../../store/types';
import type { CrmClient } from '../../api/crm';

// ─── Time Slots: 09:00 – 21:00 (30-min steps) ───────────────────────────────
const TIME_SLOTS: string[] = (() => {
    const slots: string[] = [];
    let t = setMinutes(setHours(startOfToday(), 9), 0);
    const end = setMinutes(setHours(startOfToday(), 21), 0);
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
            const res = await bookingsApi.createBooking({
                resourceId: slot.resId,
                date: dateStr,
                startTime: slot.time,
                duration,
                format: resource?.formats?.[0] || 'individual',
                locationId: resource?.locationId,
            } as any);
            // res should have booking id — fetch bookings to get it
            await useUserStore.getState().fetchBookings();
            // Find the newly created booking
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
            const msg = typeof detail === 'string' ? detail : e.message || 'Ошибка бронирования';
            toast.error(msg);
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

                {/* Footer */}
                <div className="flex gap-3 p-5 pt-0">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                        Отмена
                    </button>
                    <button
                        onClick={handleBook}
                        disabled={saving}
                        className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        {selectedClientId ? 'Забронировать + сессия' : 'Забронировать'}
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
}: {
    booking: BookingHistoryItem;
    crmClients: CrmClient[];
    existingSessions: { id: string; clientId: string; date: string | Date; durationMinutes?: number }[];
    onClose: () => void;
    onSaveMulti: (assignments: SlotAssignment[]) => Promise<void>;
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

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSaveMulti(slots);
            onClose();
        } catch {
        } finally {
            setSaving(false);
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
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
                        <X size={18} className="text-gray-500" />
                    </button>
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

                {/* Footer */}
                <div className="flex gap-3 p-5 pt-0">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                        Отмена
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || assignedCount === 0}
                        className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        Сохранить ({assignedCount}/{numSlots})
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
    type DragMode = 'new' | null;
    const dragModeRef = useRef<DragMode>(null);
    const dragStartRef = useRef<{ resId: string; time: string } | null>(null);
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

    const handleDragEnter = useCallback((resId: string, time: string) => {
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
    }, [isSlotOccupied]);

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
        slotAssignments: { hour: number; clientId: string | null; price: number; existingSessionId?: string }[]
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

        toast.success('Сессии сохранены');
        await fetchSessions();
        setLinkBooking(null);
    };

    const SLOT_W = 48; // px per 30-min slot

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

                {/* Week navigation */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setWeekStart(subWeeks(weekStart, 1))}
                        className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm font-medium min-w-[160px] text-center">
                        {format(weekStart, 'd MMM', { locale: ru })}
                        {' – '}
                        {format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'd MMM yyyy', { locale: ru })}
                    </span>
                    <button
                        onClick={() => setWeekStart(addWeeks(weekStart, 1))}
                        className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>

            {/* Day selector */}
            <div className="flex gap-1 overflow-x-auto pb-1">
                {weekDays.map(day => {
                    const active = isSameDay(day, selectedDate);
                    const today = isToday(day);
                    return (
                        <button
                            key={day.toISOString()}
                            onClick={() => setSelectedDate(day)}
                            className={clsx(
                                'flex flex-col items-center px-3 py-2 rounded-xl min-w-[52px] text-sm transition-colors border',
                                active
                                    ? 'bg-unbox-green text-white border-unbox-green'
                                    : today
                                        ? 'border-unbox-green text-unbox-green hover:bg-unbox-light/30'
                                        : 'border-transparent text-gray-500 hover:bg-gray-50'
                            )}
                        >
                            <span className="text-[10px] uppercase font-semibold opacity-70">
                                {format(day, 'EEE', { locale: ru })}
                            </span>
                            <span className="font-bold text-base leading-none">{format(day, 'd')}</span>
                        </button>
                    );
                })}
            </div>

            {/* "Продолжить" bar */}
            {newSlots.length > 0 && selectedBlock && (
                <div className="flex items-center justify-between bg-unbox-green/10 border border-unbox-green/30 rounded-xl px-4 py-2.5">
                    <span className="text-sm font-medium text-unbox-dark">
                        {RESOURCES.find(r => r.id === selectedBlock.resId)?.name} ·{' '}
                        {TIME_SLOTS[selectedBlock.start]} – {TIME_SLOTS[selectedBlock.end + 1] ?? '21:00'} ({(selectedBlock.end - selectedBlock.start + 1) * 30} мин)
                    </span>
                    <div className="flex gap-2">
                        <button onClick={() => setNewSlots([])} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
                            Сбросить
                        </button>
                        <button onClick={handleContinue} className="px-3 py-1.5 text-sm rounded-lg bg-unbox-green text-white hover:bg-unbox-dark font-semibold">
                            Забронировать →
                        </button>
                    </div>
                </div>
            )}

            {/* Grid */}
            <div className="overflow-x-auto scrollbar-visible rounded-2xl border border-gray-100 bg-white">
                <table className="border-collapse" style={{ minWidth: `${180 + TIME_SLOTS.length * SLOT_W}px` }}>
                    <thead>
                        <tr>
                            <th className="sticky left-0 z-10 bg-white border-b border-r border-gray-100 px-3 py-2 text-left text-xs text-gray-400 font-medium min-w-[180px]">
                                Кабинет
                            </th>
                            {TIME_SLOTS.map((slot, i) => (
                                <th
                                    key={slot}
                                    className="border-b border-gray-50 text-[10px] text-gray-400 font-normal py-1 text-center"
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
                                                            onClick={isMine ? () => setLinkBooking(booking) : undefined}
                                                            className={clsx(
                                                                'h-8 rounded-md border text-[10px] font-semibold flex items-center px-1.5 overflow-hidden select-none gap-1',
                                                                isMine
                                                                    ? 'bg-unbox-green/15 text-unbox-dark border-unbox-green/40 cursor-pointer hover:bg-unbox-green/25 hover:border-unbox-green/60 transition-colors group'
                                                                    : 'bg-gray-100 text-gray-400 border-gray-200 cursor-default'
                                                            )}
                                                            title={isMine ? (linkedClient ? 'Изменить клиента' : 'Привязать клиента') : undefined}
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
            </div>

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
                    onSaveMulti={(assignments) => handleMultiSlotSave(linkBooking, assignments)}
                />
            )}
        </div>
    );
}
