import { useEffect, useState, useMemo } from 'react';
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
} from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CrmChessboardView } from '../../components/crm/CrmChessboardView';

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
interface LinkSessionModalProps {
    booking: BookingHistoryItem;
    clients: CrmClient[];
    existingSessionClientId?: string;
    onClose: () => void;
    onConfirm: (clientId: string, price: number, notes: string) => Promise<void>;
}

function LinkSessionModal({ booking, clients, existingSessionClientId, onClose, onConfirm }: LinkSessionModalProps) {
    const [selectedClientId, setSelectedClientId] = useState(existingSessionClientId || '');
    const [price, setPrice] = useState('');
    const [notes, setNotes] = useState('');
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);

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

    const selectedClient = clients.find(c => c.id === selectedClientId);

    // Pre-fill price from selected client
    useEffect(() => {
        if (selectedClient && !price) {
            setPrice(String(selectedClient.basePrice || ''));
        }
    }, [selectedClientId]);

    const handleSubmit = async () => {
        if (!selectedClientId) {
            toast.error('Выберите клиента');
            return;
        }
        setSaving(true);
        try {
            await onConfirm(selectedClientId, Number(price) || 0, notes);
            onClose();
        } catch {
            toast.error('Ошибка при создании сессии');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-gray-100">
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
                    {/* Client picker */}
                    <div>
                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider block mb-2">
                            Клиент *
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
                                    onClick={() => setSelectedClientId(client.id)}
                                    className={clsx(
                                        'w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors border-b border-gray-100 last:border-0',
                                        selectedClientId === client.id
                                            ? 'bg-unbox-green/10 text-unbox-dark'
                                            : 'hover:bg-white'
                                    )}
                                >
                                    <div className={clsx(
                                        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                                        selectedClientId === client.id ? 'bg-unbox-green text-white' : 'bg-gray-200 text-gray-600'
                                    )}>
                                        {client.name[0].toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-medium text-sm truncate">{client.name}</div>
                                        {client.aliasCode && (
                                            <div className="text-[10px] text-gray-400 font-mono">{client.aliasCode}</div>
                                        )}
                                    </div>
                                    {selectedClientId === client.id && (
                                        <UserCheck size={14} className="ml-auto text-unbox-green shrink-0" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Price */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider block mb-1.5">
                                Стоимость ({selectedClient?.currency || 'GEL'})
                            </label>
                            <input
                                type="number"
                                value={price}
                                onChange={e => setPrice(e.target.value)}
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
                                value={booking.duration || ''}
                                disabled
                                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-100 bg-gray-50 text-gray-500"
                            />
                        </div>
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider block mb-1.5">
                            Заметка к сессии
                        </label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Тема сессии, подготовка..."
                            rows={2}
                            className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-unbox-green resize-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-5 pt-0">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                        Отмена
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={saving || !selectedClientId}
                        className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        {existingSessionClientId ? 'Сохранить' : 'Создать сессию'}
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
    onLink: (booking: BookingHistoryItem, existingSessionId?: string, existingClientId?: string) => void;
}

function BookingCard({ booking, linkedClient, linkedSessionId, onLink }: BookingCardProps) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const { dateStr, dateObj } = getSafeBookingDate(booking);

    const isPast = dateObj ? isBefore(dateObj, new Date()) : false;
    const isActive = booking.status === 'confirmed' || booking.status === 'completed';

    return (
        <div className={clsx(
            'bg-white rounded-2xl border transition-shadow hover:shadow-md p-4',
            linkedClient ? 'border-unbox-green/40' : 'border-gray-100',
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

            {/* Linked client or link button */}
            {linkedClient ? (
                <div className="flex items-center justify-between bg-unbox-light/40 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-unbox-green text-white flex items-center justify-center text-xs font-bold shrink-0">
                            {linkedClient.name[0].toUpperCase()}
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
    const { currentUser, bookings: allBookings } = useUserStore();
    const { clients, sessions, fetchClients, fetchSessions } = useCrmStore();

    const [viewMode, setViewMode] = useState<'list' | 'chess'>('list');
    const [filter, setFilter] = useState<FilterType>('upcoming');
    const [modalBooking, setModalBooking] = useState<BookingHistoryItem | null>(null);
    const [modalExistingSessionId, setModalExistingSessionId] = useState<string | undefined>();
    const [modalExistingClientId, setModalExistingClientId] = useState<string | undefined>();
    const [loadingClients, setLoadingClients] = useState(false);

    // Load clients and sessions on mount
    useEffect(() => {
        if (clients.length === 0) {
            setLoadingClients(true);
            fetchClients().finally(() => setLoadingClients(false));
        }
        fetchSessions();
    }, []);

    // Filter bookings by specialist email
    const myBookings = useMemo(() =>
        allBookings.filter(b => b.userId === currentUser?.email),
        [allBookings, currentUser?.email]
    );

    // Build lookup: bookingId → session
    const sessionByBookingId = useMemo(() => {
        const map = new Map<string, typeof sessions[0]>();
        sessions.forEach(s => { if (s.bookingId) map.set(s.bookingId, s); });
        return map;
    }, [sessions]);

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
        setModalBooking(booking);
        setModalExistingSessionId(existingSessionId);
        setModalExistingClientId(existingClientId);
    };

    const handleLinkSession = async (clientId: string, price: number, notes: string) => {
        if (!modalBooking) return;

        const { dateStr: bookingDate } = getSafeBookingDate(modalBooking);
        const timeStr = modalBooking.startTime && /^\d{2}:\d{2}/.test(modalBooking.startTime)
            ? modalBooking.startTime
            : '00:00';
        const sessionDate = `${bookingDate || new Date().toISOString().split('T')[0]}T${timeStr}:00`;

        if (modalExistingSessionId) {
            // Update existing session
            await useCrmStore.getState().updateSession(modalExistingSessionId, {
                date: sessionDate,
                durationMinutes: modalBooking.duration || 60,
                price: price || undefined,
                notes: notes || undefined,
            });
            toast.success('Сессия обновлена');
        } else {
            // Create new session
            await useCrmStore.getState().createSession({
                clientId,
                date: sessionDate,
                durationMinutes: modalBooking.duration || 60,
                price: price || undefined,
                notes: notes || undefined,
                bookingId: modalBooking.id,
                isBooked: true,
            });
            toast.success('Сессия создана и привязана к бронированию');
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
                </div>
            </div>

            {/* ── Chessboard view ── */}
            {viewMode === 'chess' ? (
                <CrmChessboardView />
            ) : (
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
                                const linkedSession = sessionByBookingId.get(booking.id);
                                const linkedClient = linkedSession ? clientById.get(linkedSession.clientId) : undefined;
                                return (
                                    <BookingCard
                                        key={booking.id}
                                        booking={booking}
                                        linkedClient={linkedClient}
                                        linkedSessionId={linkedSession?.id}
                                        onLink={handleOpenModal}
                                    />
                                );
                            })}
                        </div>
                    )}
                </>
            )}

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
