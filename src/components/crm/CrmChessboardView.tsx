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
                                        {client.name[0].toUpperCase()}
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

// ─── Link Client to Existing Booking Modal ────────────────────────────────────
function LinkBookingModal({
    booking,
    crmClients,
    existingSession,
    onClose,
    onSave,
}: {
    booking: BookingHistoryItem;
    crmClients: CrmClient[];
    existingSession?: { id: string; clientId: string } | null;
    onClose: () => void;
    onSave: (clientId: string | null, price: number) => Promise<void>;
}) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const [selectedClientId, setSelectedClientId] = useState(existingSession?.clientId || '');
    const [price, setPrice] = useState('');
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);

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

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(selectedClientId || null, Number(price) || 0);
            onClose();
        } catch {
        } finally {
            setSaving(false);
        }
    };

    // Format booking date safely
    const bookingDateStr = (() => {
        try {
            const d = booking.date instanceof Date
                ? booking.date
                : new Date(String(booking.date).replace(' 12:00', '').split(' ')[0]);
            return isNaN(d.getTime()) ? '' : format(d, 'd MMM yyyy', { locale: ru });
        } catch { return ''; }
    })();

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in slide-in-from-bottom-4 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-gray-100">
                    <div>
                        <h3 className="font-bold text-base flex items-center gap-2">
                            <Link2 size={15} className="text-unbox-green" />
                            {existingSession ? 'Изменить клиента сессии' : 'Привязать клиента к брони'}
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {resource?.name || 'Кабинет'} · {bookingDateStr} {booking.startTime || ''}
                            {booking.duration ? ` · ${booking.duration} мин` : ''}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
                        <X size={18} className="text-gray-500" />
                    </button>
                </div>

                <div className="p-5 space-y-3">
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
                    <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50">
                        {/* No client option (to unlink) */}
                        {existingSession && (
                            <button
                                onClick={() => setSelectedClientId('')}
                                className={clsx(
                                    'w-full text-left px-3 py-2 text-sm border-b border-gray-100 transition-colors italic',
                                    !selectedClientId ? 'bg-gray-100 text-gray-600 font-medium not-italic' : 'text-gray-400 hover:bg-white'
                                )}
                            >
                                Открепить клиента
                            </button>
                        )}
                        {filteredClients.slice(0, 8).map(client => (
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
                                    {client.name[0].toUpperCase()}
                                </div>
                                <span className="text-sm font-medium truncate">{client.name}</span>
                                {selectedClientId === client.id && <UserCheck size={13} className="ml-auto text-unbox-green shrink-0" />}
                            </button>
                        ))}
                        {filteredClients.length === 0 && (
                            <div className="p-3 text-center text-xs text-gray-400">Клиенты не найдены</div>
                        )}
                    </div>

                    {/* Price */}
                    {selectedClient && (
                        <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                                Стоимость сессии ({selectedClient.currency || 'GEL'})
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

                {/* Footer */}
                <div className="flex gap-3 p-5 pt-0">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                        Отмена
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || (!selectedClientId && !existingSession)}
                        className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        {existingSession
                            ? (selectedClientId ? 'Сохранить' : 'Открепить')
                            : 'Привязать клиента'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CrmChessboardView() {
    const { bookings, currentUser, fetchBookings } = useUserStore();
    const { resources, fetchResources } = useBookingStore();
    const { clients, sessions, fetchClients, fetchSessions, createSession, updateSession, deleteSession } = useCrmStore();

    const [filterLocation, setFilterLocation] = useState<string>('all');
    const [selectedDate, setSelectedDate] = useState(new Date());
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

    // Session lookup by bookingId
    const sessionByBookingId = useMemo(() => {
        const map = new Map<string, typeof sessions[0]>();
        sessions.forEach(s => { if (s.bookingId) map.set(s.bookingId, s); });
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

    // Handle linking/unlinking client to existing booking
    const handleLinkSave = async (clientId: string | null, price: number) => {
        if (!linkBooking) return;
        const existingSession = sessionByBookingId.get(linkBooking.id);

        // Format date safely
        const rawDate = linkBooking.date as any;
        let dateStr: string;
        if (rawDate instanceof Date) {
            dateStr = format(rawDate, 'yyyy-MM-dd');
        } else {
            dateStr = String(rawDate).replace(' 12:00', '').split('T')[0].split(' ')[0];
        }
        const timeStr = linkBooking.startTime && /^\d{2}:\d{2}/.test(linkBooking.startTime)
            ? linkBooking.startTime : '00:00';
        const sessionDate = `${dateStr}T${timeStr}:00`;

        if (existingSession) {
            if (clientId) {
                // Update: change client / price
                await updateSession(existingSession.id, {
                    clientId,
                    price: price || undefined,
                    date: sessionDate,
                });
                toast.success('Клиент обновлён');
            } else {
                // Unlink: delete the CRM session (the booking itself stays)
                await deleteSession(existingSession.id);
                toast.success('Клиент откреплён');
            }
        } else if (clientId) {
            // Create new session linked to this booking
            await createSession({
                clientId,
                date: sessionDate,
                durationMinutes: linkBooking.duration || 60,
                price: price || undefined,
                bookingId: linkBooking.id,
                isBooked: true,
            });
            toast.success('Клиент привязан');
        }

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
            <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
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
                                            const linkedSession = sessionByBookingId.get(booking.id);
                                            const linkedClient = linkedSession ? clientById.get(linkedSession.clientId) : undefined;

                                            return (
                                                <td
                                                    key={`${resource.id}-${cell.slot}`}
                                                    colSpan={colspan}
                                                    className="border-b border-gray-50 py-1 px-0.5"
                                                >
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
                    existingSession={sessionByBookingId.get(linkBooking.id) ?? null}
                    onClose={() => setLinkBooking(null)}
                    onSave={handleLinkSave}
                />
            )}
        </div>
    );
}
