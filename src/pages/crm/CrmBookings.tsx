import { useEffect, useState, useMemo, useRef } from 'react';
import { useUserStore } from '../../store/userStore';
import { useCrmStore } from '../../store/crmStore';
import { type CrmClient } from '../../api/crm';
import { RESOURCES } from '../../utils/data';
import { format, isAfter, isBefore } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { BookingHistoryItem } from '../../store/types';
import {
    Calendar,
    Clock,
    MapPin,
    UserPlus,
    UserCheck,
    Loader2,
    X,
    Search,
    Link2,
    LayoutList,
    LayoutGrid,
    Repeat2,
    Trash2,
    AlertTriangle,
} from 'lucide-react';
import { bookingsApi } from '../../api/bookings';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CrmChessboardView } from '../../components/crm/CrmChessboardView';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

// ─── Безопасное извлечение даты из брони ─────────────────────────────────────
function getSafeBookingDate(booking: BookingHistoryItem): { dateStr: string; dateObj: Date | null } {
    try {
        const rawDate = booking.date as any;
        let dateStr: string;
        if (rawDate instanceof Date) {
            dateStr = rawDate.toISOString().split('T')[0];
        } else if (typeof rawDate === 'string') {
            // Handle corrupted strings like "2025-12-25T... 12:00"
            dateStr = rawDate.replace(' 12:00', '').split('T')[0].split(' ')[0];
        } else {
            return { dateStr: '', dateObj: null };
        }

        if (!dateStr || dateStr.length < 8) return { dateStr, dateObj: null };

        const timeStr = booking.startTime && /^\d{2}:\d{2}/.test(booking.startTime)
            ? booking.startTime
            : '00:00';
        const d = new Date(`${dateStr}T${timeStr}`);
        if (isNaN(d.getTime())) return { dateStr, dateObj: null };
        return { dateStr, dateObj: d };
    } catch {
        return { dateStr: '', dateObj: null };
    }
}

function safeFormat(dateObj: Date | null, fmt: string, opts?: any): string {
    if (!dateObj) return '—';
    try { return format(dateObj, fmt, opts); } catch { return '—'; }
}

// ─── Статусы бронирований ─────────────────────────────────────────────────────
const BOOKING_STATUS_LABELS: Record<string, string> = {
    confirmed: 'Подтверждена',
    completed: 'Завершена',
    cancelled: 'Отменена',
    rescheduled: 'Перенесена',
    no_show: 'Не явился',
    're-rented': 'Пересдана',
};

const BOOKING_STATUS_COLORS: Record<string, string> = {
    confirmed: 'bg-blue-100 text-blue-700 border-blue-200',
    completed: 'bg-green-100 text-green-700 border-green-200',
    cancelled: 'bg-red-100 text-red-600 border-red-200',
    rescheduled: 'bg-amber-100 text-amber-700 border-amber-200',
    no_show: 'bg-gray-100 text-gray-600 border-gray-200',
    're-rented': 'bg-purple-100 text-purple-700 border-purple-200',
};

// ─── Фильтры ─────────────────────────────────────────────────────────────────
type FilterType = 'all' | 'linked' | 'unlinked' | 'upcoming' | 'past';

// ─── Модал привязки сессии ────────────────────────────────────────────────────
interface SlotEntry {
    clientId: string;
    duration: number;
    price: string;
    notes: string;
}

interface LinkSessionModalProps {
    booking: BookingHistoryItem;
    clients: CrmClient[];
    existingSessionClientId?: string;
    onClose: () => void;
    onConfirm: (clientId: string, price: number, notes: string, duration?: number) => Promise<void>;
}

function LinkSessionModal({ booking, clients, existingSessionClientId, onClose, onConfirm }: LinkSessionModalProps) {
    const totalDuration = booking.duration || 60;
    const [slots, setSlots] = useState<SlotEntry[]>([
        { clientId: existingSessionClientId || '', duration: totalDuration, price: '', notes: '' }
    ]);
    const [activeSlot, setActiveSlot] = useState(0);
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [splitMode, setSplitMode] = useState(false);

    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const { dateStr: bookingDate, dateObj: bookingDateObj } = getSafeBookingDate(booking);

    const filteredClients = useMemo(() =>
        clients.filter(c =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            (c.phone || '').includes(search) ||
            (c.aliasCode || '').toLowerCase().includes(search.toLowerCase())
        ),
        [clients, search]
    );

    const currentSlot = slots[activeSlot];
    const selectedClient = clients.find(c => c.id === currentSlot?.clientId);
    const usedMinutes = slots.reduce((s, sl) => s + sl.duration, 0);
    const remainingMinutes = totalDuration - usedMinutes;

    // Pre-fill price from selected client
    useEffect(() => {
        if (selectedClient && !currentSlot?.price) {
            updateSlot(activeSlot, { price: String(selectedClient.basePrice || '') });
        }
    }, [currentSlot?.clientId]);

    const updateSlot = (idx: number, patch: Partial<SlotEntry>) => {
        setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
    };

    const addSlot = () => {
        if (remainingMinutes <= 0) {
            toast.error('Всё время брони уже распределено');
            return;
        }
        setSlots(prev => [...prev, { clientId: '', duration: remainingMinutes, price: '', notes: '' }]);
        setActiveSlot(slots.length);
        setSearch('');
    };

    const removeSlot = (idx: number) => {
        if (slots.length <= 1) return;
        const removed = slots[idx];
        const newSlots = slots.filter((_, i) => i !== idx);
        // Give removed time to last slot
        if (newSlots.length > 0) {
            newSlots[newSlots.length - 1].duration += removed.duration;
        }
        setSlots(newSlots);
        setActiveSlot(Math.min(activeSlot, newSlots.length - 1));
    };

    const handleSubmit = async () => {
        for (const sl of slots) {
            if (!sl.clientId) { toast.error('Выберите клиента для каждого слота'); return; }
            if (sl.duration <= 0) { toast.error('Длительность должна быть > 0'); return; }
        }
        setSaving(true);
        try {
            for (const sl of slots) {
                await onConfirm(sl.clientId, Number(sl.price) || 0, sl.notes, sl.duration);
            }
            onClose();
        } catch {
            toast.error('Ошибка при создании сессий');
        } finally {
            setSaving(false);
        }
    };

    // Calculate start times for each slot
    const slotStartTimes = useMemo(() => {
        const base = booking.startTime || '00:00';
        const [bh, bm] = base.split(':').map(Number);
        let offset = 0;
        return slots.map(sl => {
            const totalMin = bh * 60 + bm + offset;
            offset += sl.duration;
            const h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        });
    }, [slots, booking.startTime]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10 rounded-t-2xl">
                    <div>
                        <h3 className="font-bold text-base flex items-center gap-2">
                            <Link2 size={16} className="text-unbox-green" />
                            {existingSessionClientId ? 'Изменить клиента сессии' : 'Создать сессию из брони'}
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {resource?.name || 'Кабинет'} · {safeFormat(bookingDateObj, 'd MMM yyyy', { locale: ru }) || bookingDate} {booking.startTime || ''}
                            {booking.duration ? ` · ${booking.duration} мин` : ''}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                        <X size={18} className="text-gray-500" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Split mode toggle */}
                    {!existingSessionClientId && (
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700">Разделить на слоты</span>
                            <button
                                onClick={() => {
                                    if (!splitMode) {
                                        setSplitMode(true);
                                    } else {
                                        setSplitMode(false);
                                        setSlots([slots[0]]);
                                        setActiveSlot(0);
                                        updateSlot(0, { duration: totalDuration });
                                    }
                                }}
                                className={clsx(
                                    'relative w-10 h-5 rounded-full transition-colors',
                                    splitMode ? 'bg-unbox-green' : 'bg-gray-300'
                                )}
                            >
                                <span className={clsx(
                                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                                    splitMode ? 'translate-x-5' : 'translate-x-0.5'
                                )} />
                            </button>
                        </div>
                    )}

                    {/* Slot tabs (if split mode) */}
                    {splitMode && slots.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap">
                            {slots.map((sl, idx) => {
                                const c = clients.find(cc => cc.id === sl.clientId);
                                return (
                                    <button
                                        key={idx}
                                        onClick={() => { setActiveSlot(idx); setSearch(''); }}
                                        className={clsx(
                                            'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5',
                                            activeSlot === idx
                                                ? 'border-unbox-green bg-unbox-green/10 text-unbox-dark'
                                                : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                        )}
                                    >
                                        <span className="font-bold">{slotStartTimes[idx]}</span>
                                        <span>·</span>
                                        <span>{sl.duration} мин</span>
                                        {c && <span className="truncate max-w-[80px]">· {c.name}</span>}
                                        {slots.length > 1 && (
                                            <span
                                                onClick={e => { e.stopPropagation(); removeSlot(idx); }}
                                                className="ml-1 text-red-400 hover:text-red-600"
                                            >×</span>
                                        )}
                                    </button>
                                );
                            })}
                            {remainingMinutes > 0 && (
                                <button
                                    onClick={addSlot}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 text-gray-400 hover:border-unbox-green hover:text-unbox-green transition-colors"
                                >
                                    + Слот
                                </button>
                            )}
                        </div>
                    )}

                    {/* Active slot editor */}
                    {currentSlot && (
                        <>
                            {/* Client picker */}
                            <div>
                                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider block mb-2">
                                    Клиент {splitMode ? `(Слот ${activeSlot + 1})` : ''} *
                                </label>
                                <div className="relative mb-2">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        placeholder="Поиск по имени, телефону..."
                                        className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-unbox-green focus:ring-2 focus:ring-unbox-green/10"
                                    />
                                </div>
                                <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50">
                                    {filteredClients.length === 0 ? (
                                        <div className="p-4 text-center text-sm text-gray-400">Клиенты не найдены</div>
                                    ) : filteredClients.map(client => (
                                        <button
                                            key={client.id}
                                            onClick={() => updateSlot(activeSlot, { clientId: client.id })}
                                            className={clsx(
                                                'w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors border-b border-gray-100 last:border-0',
                                                currentSlot.clientId === client.id
                                                    ? 'bg-unbox-green/10 text-unbox-dark'
                                                    : 'hover:bg-white'
                                            )}
                                        >
                                            <div className={clsx(
                                                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                                                currentSlot.clientId === client.id ? 'bg-unbox-green text-white' : 'bg-gray-200 text-gray-600'
                                            )}>
                                                {client.name?.[0]?.toUpperCase() ?? '?'}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-medium text-sm truncate">{client.name}</div>
                                                {client.aliasCode && (
                                                    <div className="text-[10px] text-gray-400 font-mono">{client.aliasCode}</div>
                                                )}
                                            </div>
                                            {currentSlot.clientId === client.id && (
                                                <UserCheck size={14} className="ml-auto text-unbox-green shrink-0" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Price & Duration */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider block mb-1.5">
                                        Стоимость ({selectedClient?.currency || 'GEL'})
                                    </label>
                                    <input
                                        type="number"
                                        value={currentSlot.price}
                                        onChange={e => updateSlot(activeSlot, { price: e.target.value })}
                                        placeholder={selectedClient ? String(selectedClient.basePrice) : '0'}
                                        className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-unbox-green"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider block mb-1.5">
                                        Длит. (мин)
                                    </label>
                                    <input
                                        type="number"
                                        value={currentSlot.duration}
                                        onChange={e => {
                                            const v = Math.max(15, Math.min(Number(e.target.value) || 15, totalDuration));
                                            updateSlot(activeSlot, { duration: v });
                                        }}
                                        disabled={!splitMode}
                                        className={clsx(
                                            'w-full px-3 py-2 text-sm rounded-xl border',
                                            splitMode
                                                ? 'border-gray-200 focus:outline-none focus:border-unbox-green'
                                                : 'border-gray-100 bg-gray-50 text-gray-500'
                                        )}
                                    />
                                </div>
                            </div>

                            {/* Notes */}
                            <div>
                                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider block mb-1.5">
                                    Заметка к сессии
                                </label>
                                <textarea
                                    value={currentSlot.notes}
                                    onChange={e => updateSlot(activeSlot, { notes: e.target.value })}
                                    placeholder="Тема сессии, подготовка..."
                                    rows={2}
                                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-unbox-green resize-none"
                                />
                            </div>
                        </>
                    )}

                    {/* Summary for split mode */}
                    {splitMode && slots.length > 1 && (
                        <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                            <div className="text-xs font-semibold text-gray-500 uppercase">Итого слотов: {slots.length}</div>
                            {slots.map((sl, idx) => {
                                const c = clients.find(cc => cc.id === sl.clientId);
                                return (
                                    <div key={idx} className="flex justify-between text-xs text-gray-600">
                                        <span>{slotStartTimes[idx]} — {c?.name || '(не выбран)'}</span>
                                        <span>{sl.duration} мин · {sl.price || '0'} {c?.currency || 'GEL'}</span>
                                    </div>
                                );
                            })}
                            {remainingMinutes !== 0 && (
                                <div className={clsx('text-xs font-medium', remainingMinutes > 0 ? 'text-amber-600' : 'text-red-600')}>
                                    {remainingMinutes > 0 ? `⚠ Не распределено: ${remainingMinutes} мин` : `⚠ Превышение: ${Math.abs(remainingMinutes)} мин`}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-5 pt-0 sticky bottom-0 bg-white rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                        Отмена
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={saving || slots.some(s => !s.clientId) || (splitMode && remainingMinutes < 0)}
                        className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        {existingSessionClientId ? 'Сохранить' : splitMode && slots.length > 1 ? `Создать ${slots.length} сессии` : 'Создать сессию'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Карточка бронирования ───────────────────────────────────────────────────
interface BookingCardProps {
    booking: BookingHistoryItem;
    linkedClient?: CrmClient;
    linkedSessionId?: string;
    linkedSessions?: any[];
    clientById: Map<string, CrmClient>;
    onLink: (booking: BookingHistoryItem, existingSessionId?: string, existingClientId?: string) => void;
}

const CARD_SEGMENT_COLORS = [
    'bg-unbox-light/40 border-unbox-green/20',
    'bg-blue-50 border-blue-200/40',
    'bg-amber-50 border-amber-200/40',
    'bg-purple-50 border-purple-200/40',
];

function BookingCard({ booking, linkedClient, linkedSessionId, linkedSessions, clientById, onLink }: BookingCardProps) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const { dateStr, dateObj } = getSafeBookingDate(booking);

    const isPast = dateObj ? isBefore(dateObj, new Date()) : false;
    const isActive = booking.status === 'confirmed' || booking.status === 'completed';
    const hasMultiple = (linkedSessions?.length || 0) > 1;

    return (
        <div className={clsx(
            'bg-white rounded-2xl border transition-shadow hover:shadow-md p-4',
            linkedClient || hasMultiple ? 'border-unbox-green/40' : 'border-gray-100',
            !isActive && 'opacity-60'
        )}>
            {/* Top row: date + status */}
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className={clsx('p-1.5 rounded-lg', isPast ? 'bg-gray-100' : 'bg-unbox-light/60')}>
                        <Calendar size={14} className={isPast ? 'text-gray-400' : 'text-unbox-green'} />
                    </div>
                    <div>
                        <div className="font-semibold text-sm text-gray-900">
                            {safeFormat(dateObj, 'd MMMM yyyy', { locale: ru }) || dateStr || '—'}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock size={11} />
                            {booking.startTime || '—'}
                            {booking.duration ? ` · ${booking.duration} мин` : ''}
                        </div>
                    </div>
                </div>
                <span className={clsx(
                    'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border',
                    BOOKING_STATUS_COLORS[booking.status] || 'bg-gray-100 text-gray-500'
                )}>
                    {BOOKING_STATUS_LABELS[booking.status] || booking.status}
                </span>
            </div>

            {/* Room */}
            <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-3">
                <MapPin size={13} className="text-gray-400 shrink-0" />
                <span>{resource?.name || `Кабинет ${booking.resourceId}`}</span>
            </div>

            {/* Multi-client split display */}
            {hasMultiple ? (
                <div className="space-y-1.5">
                    {linkedSessions!
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                        .map((sess, idx) => {
                            const cl = clientById.get(sess.clientId);
                            const color = CARD_SEGMENT_COLORS[idx % CARD_SEGMENT_COLORS.length];
                            return (
                                <div key={sess.id} className={clsx('flex items-center justify-between rounded-xl px-3 py-2 border', color)}>
                                    <div className="flex items-center gap-2">
                                        <div className={clsx(
                                            'w-5 h-5 rounded-full text-white flex items-center justify-center text-[10px] font-bold shrink-0',
                                            idx === 0 ? 'bg-unbox-green' : idx === 1 ? 'bg-blue-500' : idx === 2 ? 'bg-amber-500' : 'bg-purple-500'
                                        )}>
                                            {idx + 1}
                                        </div>
                                        <div>
                                            <div className="text-sm font-semibold text-gray-900">{cl?.name || '—'}</div>
                                            <div className="text-[10px] text-gray-400">{sess.durationMinutes || 60} мин</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    {isActive && (
                        <button
                            onClick={() => onLink(booking, linkedSessionId, linkedClient?.id)}
                            className="w-full text-xs text-gray-400 hover:text-unbox-green transition-colors underline py-1"
                        >
                            Изменить
                        </button>
                    )}
                </div>
            ) : linkedClient ? (
                <div className="flex items-center justify-between bg-unbox-light/40 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-unbox-green text-white flex items-center justify-center text-xs font-bold shrink-0">
                            {linkedClient.name?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div>
                            <div className="text-sm font-semibold text-gray-900">{linkedClient.name}</div>
                            {linkedClient.aliasCode && (
                                <div className="text-[10px] text-gray-400 font-mono">{linkedClient.aliasCode}</div>
                            )}
                        </div>
                    </div>
                    {isActive && (
                        <button
                            onClick={() => onLink(booking, linkedSessionId, linkedClient.id)}
                            className="text-xs text-gray-400 hover:text-unbox-green transition-colors underline"
                        >
                            Изменить
                        </button>
                    )}
                </div>
            ) : isActive ? (
                <button
                    onClick={() => onLink(booking)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400 hover:border-unbox-green hover:text-unbox-green transition-colors"
                >
                    <UserPlus size={14} />
                    Привязать клиента
                </button>
            ) : (
                <div className="text-xs text-gray-400 text-center py-1">Бронь неактивна</div>
            )}
        </div>
    );
}

// ─── Главная страница ─────────────────────────────────────────────────────────
export function CrmBookings() {
    const gridHouse = useDesignFlag();
    const { currentUser, bookings: allBookings } = useUserStore();
    const { clients, sessions, fetchClients, fetchSessions } = useCrmStore();

    const [viewMode, setViewMode] = useState<'list' | 'chess' | 'series'>('list');
    const [filter, setFilter] = useState<FilterType>('upcoming');
    const [modalBooking, setModalBooking] = useState<BookingHistoryItem | null>(null);
    const [modalExistingSessionId, setModalExistingSessionId] = useState<string | undefined>();
    const [modalExistingClientId, setModalExistingClientId] = useState<string | undefined>();
    const [loadingClients, setLoadingClients] = useState(false);
    const [recurringGroups, setRecurringGroups] = useState<Awaited<ReturnType<typeof bookingsApi.getRecurringGroups>>>([]);
    const [loadingGroups, setLoadingGroups] = useState(false);
    const [cancellingGroupId, setCancellingGroupId] = useState<string | null>(null);
    const [confirmCancelGroupId, setConfirmCancelGroupId] = useState<string | null>(null);

    // Load clients and sessions on mount
    useEffect(() => {
        if (clients.length === 0) {
            setLoadingClients(true);
            fetchClients().finally(() => setLoadingClients(false));
        }
        fetchSessions();
    }, []);

    // Load recurring groups when series tab opens
    useEffect(() => {
        if (viewMode === 'series') {
            setLoadingGroups(true);
            bookingsApi.getRecurringGroups()
                .then(setRecurringGroups)
                .catch(() => {})
                .finally(() => setLoadingGroups(false));
        }
    }, [viewMode]);

    const handleCancelSeries = async (groupId: string) => {
        setCancellingGroupId(groupId);
        try {
            const res = await bookingsApi.cancelRecurringSeries(groupId);
            toast.success(`Серия отменена: ${res.cancelled} бронирований`);
            setRecurringGroups(prev => prev.filter(g => g.recurringGroupId !== groupId));
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Ошибка при отмене серии');
        } finally {
            setCancellingGroupId(null);
            setConfirmCancelGroupId(null);
        }
    };

    // Filter bookings by specialist email
    const myBookings = useMemo(() =>
        allBookings.filter(b => b.userId === currentUser?.email),
        [allBookings, currentUser?.email]
    );

    // Build lookup: bookingId → sessions (array for multi-client splits)
    const sessionsByBookingId = useMemo(() => {
        const map = new Map<string, typeof sessions>();
        sessions.forEach(s => {
            if (s.bookingId) {
                const arr = map.get(s.bookingId) || [];
                arr.push(s);
                map.set(s.bookingId, arr);
            }
        });
        return map;
    }, [sessions]);

    // Compat: single session lookup
    const sessionByBookingId = useMemo(() => {
        const map = new Map<string, typeof sessions[0]>();
        sessionsByBookingId.forEach((arr, key) => { if (arr[0]) map.set(key, arr[0]); });
        return map;
    }, [sessionsByBookingId]);

    // Build lookup: clientId → client
    const clientById = useMemo(() => {
        const map = new Map<string, CrmClient>();
        clients.forEach(c => map.set(c.id, c));
        return map;
    }, [clients]);

    const now = new Date();

    // Apply filter
    const filteredBookings = useMemo(() => {
        return myBookings.filter(b => {
            const { dateObj } = getSafeBookingDate(b);
            const hasSession = sessionByBookingId.has(b.id);
            switch (filter) {
                case 'linked': return hasSession;
                case 'unlinked': return !hasSession && (b.status === 'confirmed' || b.status === 'completed');
                case 'upcoming': return dateObj ? isAfter(dateObj, now) && b.status === 'confirmed' : false;
                case 'past': return dateObj ? isBefore(dateObj, now) : false;
                default: return true;
            }
        }).sort((a, b) => {
            const { dateStr: da } = getSafeBookingDate(a);
            const { dateStr: db } = getSafeBookingDate(b);
            const ta = `${da}T${a.startTime || '00:00'}`;
            const tb = `${db}T${b.startTime || '00:00'}`;
            return filter === 'upcoming'
                ? ta.localeCompare(tb)
                : tb.localeCompare(ta);
        });
    }, [myBookings, filter, sessionByBookingId, now]);

    // Stats
    const stats = useMemo(() => ({
        total: myBookings.length,
        upcoming: myBookings.filter(b => {
            const { dateObj } = getSafeBookingDate(b);
            return dateObj ? isAfter(dateObj, now) && b.status === 'confirmed' : false;
        }).length,
        linked: myBookings.filter(b => sessionByBookingId.has(b.id)).length,
        unlinked: myBookings.filter(b => !sessionByBookingId.has(b.id) && (b.status === 'confirmed' || b.status === 'completed')).length,
    }), [myBookings, sessionByBookingId, now]);

    const handleOpenModal = (booking: BookingHistoryItem, existingSessionId?: string, existingClientId?: string) => {
        slotOffsetRef.current = 0; // Reset offset for new modal
        setModalBooking(booking);
        setModalExistingSessionId(existingSessionId);
        setModalExistingClientId(existingClientId);
    };

    // Track cumulative offset for split slots
    const slotOffsetRef = useRef(0);

    const handleLinkSession = async (clientId: string, price: number, notes: string, slotDuration?: number) => {
        if (!modalBooking) return;

        const { dateStr: bookingDate } = getSafeBookingDate(modalBooking);
        const timeStr = modalBooking.startTime && /^\d{2}:\d{2}/.test(modalBooking.startTime)
            ? modalBooking.startTime
            : '00:00';

        // Calculate offset time for split slots
        const [bh, bm] = timeStr.split(':').map(Number);
        const totalMin = bh * 60 + bm + slotOffsetRef.current;
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        const offsetTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const sessionDate = `${bookingDate || new Date().toISOString().split('T')[0]}T${offsetTime}:00`;
        const dur = slotDuration || modalBooking.duration || 60;

        if (modalExistingSessionId) {
            await useCrmStore.getState().updateSession(modalExistingSessionId, {
                date: sessionDate,
                durationMinutes: dur,
                price: price || undefined,
                notes: notes || undefined,
            });
            toast.success('Сессия обновлена');
        } else {
            await useCrmStore.getState().createSession({
                clientId,
                date: sessionDate,
                durationMinutes: dur,
                price: price || undefined,
                notes: notes || undefined,
                bookingId: modalBooking.id,
                isBooked: true,
            });
            // Accumulate offset for next slot in split mode
            slotOffsetRef.current += dur;
        }

        // Refresh sessions
        await fetchSessions();
    };

    const FILTERS: { key: FilterType; label: string; count?: number }[] = [
        { key: 'upcoming', label: 'Предстоящие', count: stats.upcoming },
        { key: 'unlinked', label: 'Без клиента', count: stats.unlinked },
        { key: 'linked', label: 'С клиентом', count: stats.linked },
        { key: 'past', label: 'Прошедшие' },
        { key: 'all', label: 'Все', count: stats.total },
    ];

    if (gridHouse) return (
        <GridHouseCrmBookings
            viewMode={viewMode} setViewMode={setViewMode}
            filter={filter} setFilter={setFilter}
            stats={stats} filteredBookings={filteredBookings}
            loadingClients={loadingClients} loadingGroups={loadingGroups}
            recurringGroups={recurringGroups}
            confirmCancelGroupId={confirmCancelGroupId} setConfirmCancelGroupId={setConfirmCancelGroupId}
            cancellingGroupId={cancellingGroupId} handleCancelSeries={handleCancelSeries}
            handleOpenModal={handleOpenModal}
            sessionsByBookingId={sessionsByBookingId} clientById={clientById}
            clients={clients}
            modalBooking={modalBooking} setModalBooking={setModalBooking}
            modalExistingClientId={modalExistingClientId}
            setModalExistingSessionId={setModalExistingSessionId}
            setModalExistingClientId={setModalExistingClientId}
            handleLinkSession={handleLinkSession}
        />
    );

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Мои бронирования</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        {viewMode === 'chess'
                            ? 'Шахматка кабинетов — выдели слот и забронируй с привязкой клиента'
                            : 'Слоты в Unbox — привяжи клиента, чтобы создать сессию в CRM'}
                    </p>
                </div>

                {/* View mode toggle */}
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1 shrink-0">
                    <button
                        onClick={() => setViewMode('list')}
                        className={clsx(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                            viewMode === 'list'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        )}
                    >
                        <LayoutList size={15} />
                        Список
                    </button>
                    <button
                        onClick={() => setViewMode('chess')}
                        className={clsx(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                            viewMode === 'chess'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        )}
                    >
                        <LayoutGrid size={15} />
                        Шахматка
                    </button>
                    <button
                        onClick={() => setViewMode('series')}
                        className={clsx(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                            viewMode === 'series'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        )}
                    >
                        <Repeat2 size={15} />
                        Серии
                    </button>
                </div>
            </div>

            {/* ── Series view ── */}
            {viewMode === 'series' ? (
                <div className="space-y-4">
                    <p className="text-sm text-gray-500">Активные повторяющиеся серии — все будущие брони одним списком. Можно отменить всю серию сразу.</p>
                    {loadingGroups ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="animate-spin text-unbox-green" size={28} />
                        </div>
                    ) : recurringGroups.length === 0 ? (
                        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
                            <Repeat2 size={40} className="mx-auto text-gray-200 mb-3" />
                            <div className="text-gray-400 text-sm">Нет активных повторяющихся серий</div>
                            <div className="text-xs text-gray-300 mt-1">Создай серию через шахматку, выбрав паттерн повторения</div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {recurringGroups.map(g => {
                                const resource = RESOURCES.find(r => r.id === g.resourceId);
                                const patternLabel = g.pattern === 'monthly' ? 'Ежемесячно' : g.pattern === 'biweekly' ? 'Раз в 2 недели' : 'Еженедельно';
                                const patternColor = g.pattern === 'monthly' ? 'bg-purple-100 text-purple-700' : g.pattern === 'biweekly' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700';
                                const isConfirming = confirmCancelGroupId === g.recurringGroupId;
                                const isCancelling = cancellingGroupId === g.recurringGroupId;
                                return (
                                    <div key={g.recurringGroupId} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-gray-900 truncate">{resource?.name || g.resourceId}</div>
                                                <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                                                    <span className="flex items-center gap-1"><Clock size={12} />{g.startTime} · {g.duration} мин</span>
                                                    <span className="flex items-center gap-1"><MapPin size={12} />{g.locationId}</span>
                                                </div>
                                            </div>
                                            <span className={clsx('text-xs font-medium px-2 py-1 rounded-full shrink-0', patternColor)}>
                                                {patternLabel}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                            <div className="bg-gray-50 rounded-xl p-3 text-center">
                                                <div className="text-lg font-bold text-gray-900">{g.futureCount}</div>
                                                <div className="text-xs text-gray-500">осталось броней</div>
                                            </div>
                                            <div className="bg-gray-50 rounded-xl p-3 text-center">
                                                <div className="text-lg font-bold text-gray-900">
                                                    {g.nextDate ? format(new Date(g.nextDate + 'T00:00:00'), 'd MMM', { locale: ru }) : '—'}
                                                </div>
                                                <div className="text-xs text-gray-500">следующая дата</div>
                                            </div>
                                        </div>
                                        {isConfirming ? (
                                            <div className="bg-red-50 rounded-xl p-3 space-y-2">
                                                <div className="flex items-center gap-2 text-sm text-red-700">
                                                    <AlertTriangle size={14} />
                                                    Отменить все {g.futureCount} будущих броней серии?
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => setConfirmCancelGroupId(null)}
                                                        className="flex-1 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                                                    >
                                                        Нет
                                                    </button>
                                                    <button
                                                        onClick={() => handleCancelSeries(g.recurringGroupId)}
                                                        disabled={isCancelling}
                                                        className="flex-1 py-1.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-60 transition-colors flex items-center justify-center gap-1"
                                                    >
                                                        {isCancelling ? <Loader2 size={12} className="animate-spin" /> : null}
                                                        Отменить серию
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setConfirmCancelGroupId(g.recurringGroupId)}
                                                className="w-full py-2 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5"
                                            >
                                                <Trash2 size={13} />
                                                Отменить серию
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            ) : null}

            {/* ── Chessboard view ── */}
            {viewMode === 'chess' ? (
                <CrmChessboardView />
            ) : viewMode === 'list' ? (
                <>
                    {/* Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                            { label: 'Всего броней', value: stats.total, color: 'text-gray-700' },
                            { label: 'Предстоит', value: stats.upcoming, color: 'text-blue-600' },
                            { label: 'С клиентом', value: stats.linked, color: 'text-unbox-green' },
                            { label: 'Без клиента', value: stats.unlinked, color: 'text-amber-600' },
                        ].map(s => (
                            <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 text-center">
                                <div className={clsx('text-2xl font-bold', s.color)}>{s.value}</div>
                                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Filter tabs */}
                    <div className="flex gap-1 flex-wrap">
                        {FILTERS.map(f => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                className={clsx(
                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors',
                                    filter === f.key
                                        ? 'bg-unbox-green text-white'
                                        : 'bg-white border border-gray-200 text-gray-600 hover:border-unbox-green hover:text-unbox-green'
                                )}
                            >
                                {f.label}
                                {f.count !== undefined && (
                                    <span className={clsx(
                                        'px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                                        filter === f.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                                    )}>
                                        {f.count}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    {loadingClients ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="animate-spin text-unbox-green" size={28} />
                        </div>
                    ) : filteredBookings.length === 0 ? (
                        <div className="text-center py-16">
                            <Calendar size={40} className="mx-auto text-gray-200 mb-3" />
                            <div className="text-gray-400 text-sm">
                                {filter === 'upcoming' ? 'Нет предстоящих бронирований' :
                                 filter === 'unlinked' ? 'Все активные брони уже привязаны к клиентам' :
                                 filter === 'linked' ? 'Нет броней с привязанными клиентами' :
                                 'Бронирований нет'}
                            </div>
                            {filter === 'unlinked' && stats.total > 0 && (
                                <p className="text-xs text-gray-400 mt-1">Отлично!</p>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {filteredBookings.map(booking => {
                                const allLinked = sessionsByBookingId.get(booking.id) || [];
                                const linkedSession = allLinked[0];
                                const linkedClient = linkedSession ? clientById.get(linkedSession.clientId) : undefined;
                                return (
                                    <BookingCard
                                        key={booking.id}
                                        booking={booking}
                                        linkedClient={linkedClient}
                                        linkedSessionId={linkedSession?.id}
                                        linkedSessions={allLinked}
                                        clientById={clientById}
                                        onLink={handleOpenModal}
                                    />
                                );
                            })}
                        </div>
                    )}
                </>
            ) : null}

            {/* Link session modal */}
            {modalBooking && (
                <LinkSessionModal
                    booking={modalBooking}
                    clients={clients.filter(c => c.isActive)}
                    existingSessionClientId={modalExistingClientId}
                    onClose={() => {
                        setModalBooking(null);
                        setModalExistingSessionId(undefined);
                        setModalExistingClientId(undefined);
                    }}
                    onConfirm={handleLinkSession}
                />
            )}
        </div>
    );
}

// ─── Grid House: CrmBookings ─────────────────────────────────────────────────

interface GHCrmBookingsProps {
    viewMode: 'list' | 'chess' | 'series';
    setViewMode: (v: 'list' | 'chess' | 'series') => void;
    filter: FilterType;
    setFilter: (f: FilterType) => void;
    stats: { total: number; upcoming: number; linked: number; unlinked: number };
    filteredBookings: BookingHistoryItem[];
    loadingClients: boolean;
    loadingGroups: boolean;
    recurringGroups: any[];
    confirmCancelGroupId: string | null;
    setConfirmCancelGroupId: (id: string | null) => void;
    cancellingGroupId: string | null;
    handleCancelSeries: (groupId: string) => Promise<void>;
    handleOpenModal: (booking: BookingHistoryItem, existingSessionId?: string, existingClientId?: string) => void;
    sessionsByBookingId: Map<string, any[]>;
    clientById: Map<string, CrmClient>;
    clients: CrmClient[];
    modalBooking: BookingHistoryItem | null;
    setModalBooking: (b: BookingHistoryItem | null) => void;
    modalExistingClientId?: string;
    setModalExistingSessionId: (id: string | undefined) => void;
    setModalExistingClientId: (id: string | undefined) => void;
    handleLinkSession: (clientId: string, price: number, notes: string, slotDuration?: number) => Promise<void>;
}

const ghMono = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: GH.ink60 };
const ghHairline = `1px solid ${GH.ink10}`;

function GridHouseCrmBookings(props: GHCrmBookingsProps) {
    const {
        viewMode, setViewMode, filter, setFilter, stats, filteredBookings,
        loadingClients, loadingGroups, recurringGroups,
        confirmCancelGroupId, setConfirmCancelGroupId, cancellingGroupId, handleCancelSeries,
        handleOpenModal, sessionsByBookingId, clientById, clients,
        modalBooking, setModalBooking, modalExistingClientId,
        setModalExistingSessionId, setModalExistingClientId, handleLinkSession,
    } = props;

    const VIEW_MODES: { key: typeof viewMode; label: string }[] = [
        { key: 'list', label: 'Список' },
        { key: 'chess', label: 'Шахматка' },
        { key: 'series', label: 'Серии' },
    ];

    const GH_FILTERS: { key: FilterType; label: string; count?: number }[] = [
        { key: 'upcoming', label: 'Предстоящие', count: stats.upcoming },
        { key: 'unlinked', label: 'Без клиента', count: stats.unlinked },
        { key: 'linked', label: 'С клиентом', count: stats.linked },
        { key: 'past', label: 'Прошедшие' },
        { key: 'all', label: 'Все', count: stats.total },
    ];

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper, minHeight: '100vh' }}>
            {/* ── Head ── */}
            <div style={{ padding: '48px 32px 0' }}>
                <div style={ghMono}>CRM · Бронирования</div>
                <h1 style={{ fontFamily: GH_SANS, fontSize: 'clamp(36px, 4.5vw, 56px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 0.95, margin: '8px 0 0' }}>
                    Мои бронирования.
                </h1>
            </div>

            {/* ── Anchor KPI + secondary ── */}
            <div style={{
                display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                padding: '32px 32px 24px', flexWrap: 'wrap', gap: 24,
            }}>
                <div>
                    <div style={{ fontSize: 'clamp(48px, 5vw, 72px)', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                        {stats.upcoming}
                    </div>
                    <div style={{ ...ghMono, marginTop: 4 }}>предстоит</div>
                </div>
                <div style={{ display: 'flex', gap: 24 }}>
                    {[
                        { label: 'Всего', value: stats.total },
                        { label: 'С клиентом', value: stats.linked, color: GH.accent },
                        { label: 'Без клиента', value: stats.unlinked, color: stats.unlinked > 0 ? GH.danger : undefined },
                    ].map(kpi => (
                        <div key={kpi.label} style={{ textAlign: 'right' as const }}>
                            <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: kpi.color || GH.ink }}>
                                {kpi.value}
                            </div>
                            <div style={{ ...ghMono, fontSize: 9 }}>{kpi.label}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── View mode tabs ── */}
            <div style={{ display: 'flex', margin: '0 32px', borderBottom: `2px solid ${GH.ink}` }}>
                {VIEW_MODES.map(v => (
                    <button
                        key={v.key}
                        onClick={() => setViewMode(v.key)}
                        style={{
                            fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                            padding: '10px 20px',
                            background: viewMode === v.key ? GH.ink : 'transparent',
                            color: viewMode === v.key ? GH.paper : GH.ink60,
                            border: 'none', cursor: 'pointer',
                            marginBottom: -2,
                            borderBottom: viewMode === v.key ? `2px solid ${GH.ink}` : '2px solid transparent',
                            transition: 'all 120ms',
                        }}
                    >
                        {v.label}
                    </button>
                ))}
            </div>

            {/* ── Content ── */}
            <div style={{ padding: '0 32px 64px' }}>
                {viewMode === 'chess' ? (
                    <div style={{ marginTop: 24 }}><CrmChessboardView /></div>
                ) : viewMode === 'series' ? (
                    <GHSeriesView
                        loadingGroups={loadingGroups} recurringGroups={recurringGroups}
                        confirmCancelGroupId={confirmCancelGroupId} setConfirmCancelGroupId={setConfirmCancelGroupId}
                        cancellingGroupId={cancellingGroupId} handleCancelSeries={handleCancelSeries}
                    />
                ) : (
                    <>
                        {/* Filter row */}
                        <div style={{ display: 'flex', gap: 0, borderBottom: ghHairline, marginTop: 24 }}>
                            {GH_FILTERS.map(f => (
                                <button
                                    key={f.key}
                                    onClick={() => setFilter(f.key)}
                                    style={{
                                        fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                                        padding: '10px 16px', background: 'transparent',
                                        color: filter === f.key ? GH.ink : GH.ink60,
                                        border: 'none',
                                        borderBottom: filter === f.key ? `2px solid ${GH.ink}` : '2px solid transparent',
                                        marginBottom: -1, cursor: 'pointer', transition: 'color 120ms',
                                    }}
                                >
                                    {f.label}{f.count !== undefined ? ` ${f.count}` : ''}
                                </button>
                            ))}
                        </div>

                        {/* Table header */}
                        {!loadingClients && filteredBookings.length > 0 && (
                            <div style={{
                                display: 'grid', gridTemplateColumns: '48px 120px 1fr 140px 100px',
                                padding: '8px 0', borderBottom: ghHairline,
                            }}>
                                {['№', 'Дата', 'Клиент', 'Кабинет', 'Статус'].map(h => (
                                    <div key={h} style={{ ...ghMono, fontSize: 9 }}>{h}</div>
                                ))}
                            </div>
                        )}

                        {/* Rows */}
                        {loadingClients ? (
                            <div style={{ padding: '80px 0', textAlign: 'center' }}>
                                <div style={ghMono}>Загрузка...</div>
                            </div>
                        ) : filteredBookings.length === 0 ? (
                            <div style={{ padding: '80px 0', textAlign: 'center' }}>
                                <h2 style={{ fontFamily: GH_SANS, fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', color: GH.ink30 }}>
                                    {filter === 'upcoming' ? 'Нет предстоящих.' :
                                     filter === 'unlinked' ? 'Все привязаны.' :
                                     filter === 'linked' ? 'Нет привязанных.' :
                                     'Бронирований нет.'}
                                </h2>
                            </div>
                        ) : (
                            <div>
                                {filteredBookings.map((booking, idx) => {
                                    const allLinked = sessionsByBookingId.get(booking.id) || [];
                                    const linkedSession = allLinked[0];
                                    const linkedClient = linkedSession ? clientById.get(linkedSession.clientId) : undefined;
                                    return (
                                        <GHBookingRow
                                            key={booking.id}
                                            booking={booking} index={idx}
                                            linkedClient={linkedClient}
                                            linkedSessionId={linkedSession?.id}
                                            linkedSessions={allLinked}
                                            clientById={clientById}
                                            onLink={handleOpenModal}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Footer */}
            <div style={{ borderTop: ghHairline, padding: '16px 32px', textAlign: 'center' }}>
                <span style={ghMono}>Unbox · CRM · Бронирования · {new Date().getFullYear()}</span>
            </div>

            {/* Legacy modal */}
            {modalBooking && (
                <LinkSessionModal
                    booking={modalBooking}
                    clients={clients.filter(c => c.isActive)}
                    existingSessionClientId={modalExistingClientId}
                    onClose={() => {
                        setModalBooking(null);
                        setModalExistingSessionId(undefined);
                        setModalExistingClientId(undefined);
                    }}
                    onConfirm={handleLinkSession}
                />
            )}
        </div>
    );
}

// ─── GH: Строка бронирования ─────────────────────────────────────────────────

function GHBookingRow({ booking, index, linkedClient, linkedSessionId, linkedSessions, clientById, onLink }: {
    booking: BookingHistoryItem; index: number;
    linkedClient?: CrmClient; linkedSessionId?: string; linkedSessions?: any[];
    clientById: Map<string, CrmClient>;
    onLink: (b: BookingHistoryItem, sid?: string, cid?: string) => void;
}) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const { dateObj } = getSafeBookingDate(booking);
    const isActive = booking.status === 'confirmed' || booking.status === 'completed';
    const hasMultiple = (linkedSessions?.length || 0) > 1;

    return (
        <div
            style={{
                display: 'grid', gridTemplateColumns: '48px 120px 1fr 140px 100px',
                alignItems: 'center', padding: '12px 0', borderBottom: ghHairline,
                opacity: isActive ? 1 : 0.4, transition: 'background 120ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = GH.ink5)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
            {/* № */}
            <div style={{ fontFamily: GH_MONO, fontSize: 10, color: GH.ink30, letterSpacing: '0.14em' }}>
                {String(index + 1).padStart(2, '0')}
            </div>

            {/* Дата + время */}
            <div>
                <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {safeFormat(dateObj, 'd MMM', { locale: ru })}
                </div>
                <div style={{ fontFamily: GH_MONO, fontSize: 9, color: GH.ink60, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                    {booking.startTime || '—'}{booking.duration ? ` · ${booking.duration}\u2032` : ''}
                </div>
            </div>

            {/* Клиент */}
            <div>
                {hasMultiple ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {linkedSessions!.map((sess, idx) => {
                            const cl = clientById.get(sess.clientId);
                            return (
                                <span key={sess.id} style={{ fontSize: 13, fontWeight: 500 }}>
                                    {cl?.name || '—'}{idx < linkedSessions!.length - 1 ? ' \u00b7' : ''}
                                </span>
                            );
                        })}
                        {isActive && (
                            <button onClick={() => onLink(booking, linkedSessionId, linkedClient?.id)}
                                style={{ fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: GH.ink60, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                                Изм.
                            </button>
                        )}
                    </div>
                ) : linkedClient ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{linkedClient.name}</span>
                        {linkedClient.aliasCode && (
                            <span style={{ fontFamily: GH_MONO, fontSize: 10, color: GH.ink30 }}>{linkedClient.aliasCode}</span>
                        )}
                        {isActive && (
                            <button onClick={() => onLink(booking, linkedSessionId, linkedClient.id)}
                                style={{ fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: GH.ink60, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                                Изм.
                            </button>
                        )}
                    </div>
                ) : isActive ? (
                    <button onClick={() => onLink(booking)}
                        style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: GH.accent, background: 'none', border: `1px solid ${GH.accent}`, padding: '4px 12px', cursor: 'pointer' }}>
                        + Привязать
                    </button>
                ) : (
                    <span style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: GH.ink30 }}>Неактивна</span>
                )}
            </div>

            {/* Кабинет */}
            <div style={{ fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.ink60 }}>
                {resource?.name || booking.resourceId}
            </div>

            {/* Статус */}
            <div style={{
                fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
                color: booking.status === 'cancelled' || booking.status === 'no_show' ? GH.danger : GH.ink60,
            }}>
                {BOOKING_STATUS_LABELS[booking.status] || booking.status}
            </div>
        </div>
    );
}

// ─── GH: Вид серий ───────────────────────────────────────────────────────────

function GHSeriesView({ loadingGroups, recurringGroups, confirmCancelGroupId, setConfirmCancelGroupId, cancellingGroupId, handleCancelSeries }: {
    loadingGroups: boolean; recurringGroups: any[];
    confirmCancelGroupId: string | null; setConfirmCancelGroupId: (id: string | null) => void;
    cancellingGroupId: string | null; handleCancelSeries: (groupId: string) => Promise<void>;
}) {
    if (loadingGroups) {
        return <div style={{ padding: '80px 0', textAlign: 'center' }}><div style={ghMono}>Загрузка...</div></div>;
    }
    if (recurringGroups.length === 0) {
        return (
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
                <h2 style={{ fontFamily: GH_SANS, fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', color: GH.ink30 }}>Серий нет.</h2>
                <div style={{ ...ghMono, marginTop: 8 }}>Создайте через шахматку</div>
            </div>
        );
    }
    return (
        <div style={{ marginTop: 24 }}>
            {/* Table header */}
            <div style={{
                display: 'grid', gridTemplateColumns: '1fr 110px 80px 80px 140px',
                padding: '8px 0', borderBottom: ghHairline,
            }}>
                {['Кабинет', 'Паттерн', 'Осталось', 'След.', ''].map(h => (
                    <div key={h || 'empty'} style={{ ...ghMono, fontSize: 9 }}>{h}</div>
                ))}
            </div>
            {recurringGroups.map(g => {
                const resource = RESOURCES.find((r: any) => r.id === g.resourceId);
                const patternLabel = g.pattern === 'monthly' ? 'Ежемес.' : g.pattern === 'biweekly' ? '2 нед.' : 'Еженед.';
                const isConfirming = confirmCancelGroupId === g.recurringGroupId;
                const isCancelling = cancellingGroupId === g.recurringGroupId;
                return (
                    <div key={g.recurringGroupId}
                        style={{
                            display: 'grid', gridTemplateColumns: '1fr 110px 80px 80px 140px',
                            alignItems: 'center', padding: '14px 0', borderBottom: ghHairline, transition: 'background 120ms',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = GH.ink5)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{resource?.name || g.resourceId}</div>
                            <div style={{ fontFamily: GH_MONO, fontSize: 9, color: GH.ink60, letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 2 }}>
                                {g.startTime} · {g.duration}\u2032
                            </div>
                        </div>
                        <div style={{ fontFamily: GH_MONO, fontSize: 10, color: GH.ink60, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{patternLabel}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{g.futureCount}</div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                            {g.nextDate ? format(new Date(g.nextDate + 'T00:00:00'), 'd MMM', { locale: ru }) : '—'}
                        </div>
                        <div>
                            {isConfirming ? (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={() => setConfirmCancelGroupId(null)}
                                        style={{ fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' as const, padding: '5px 10px', background: 'transparent', border: ghHairline, cursor: 'pointer', color: GH.ink60 }}>
                                        Нет
                                    </button>
                                    <button onClick={() => handleCancelSeries(g.recurringGroupId)} disabled={isCancelling}
                                        style={{ fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' as const, padding: '5px 10px', background: GH.danger, color: GH.paper, border: 'none', cursor: 'pointer', opacity: isCancelling ? 0.5 : 1 }}>
                                        {isCancelling ? '...' : 'Да'}
                                    </button>
                                </div>
                            ) : (
                                <button onClick={() => setConfirmCancelGroupId(g.recurringGroupId)}
                                    style={{ fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' as const, padding: '5px 10px', background: 'transparent', border: `1px solid ${GH.danger}`, color: GH.danger, cursor: 'pointer' }}>
                                    Отменить
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
