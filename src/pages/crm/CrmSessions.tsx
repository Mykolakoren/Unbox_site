import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import {
    Calendar,
    Plus,
    Check,
    X,
    Loader2,
    Banknote,
    ChevronLeft,
    ChevronRight,
    Pencil,
    Trash2,
    ChevronDown,
    LayoutGrid,
} from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, addMonths, subMonths, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import type { CrmSession, CrmSessionCreate, CrmSessionUpdate, CrmClient } from '../../api/crm';

const STATUS_COLORS: Record<string, string> = {
    PLANNED: 'bg-blue-100 text-blue-700 border-blue-200',
    COMPLETED: 'bg-green-100 text-green-700 border-green-200',
    CANCELLED_CLIENT: 'bg-red-100 text-red-600 border-red-200',
    CANCELLED_THERAPIST: 'bg-orange-100 text-orange-700 border-orange-200',
};

const STATUS_LABELS: Record<string, string> = {
    PLANNED: 'Запланирована',
    COMPLETED: 'Завершена',
    CANCELLED_CLIENT: 'Отмена (клиент)',
    CANCELLED_THERAPIST: 'Отмена (терапевт)',
};

/** Сессия уже прошла по времени */
function isPastSession(session: CrmSession): boolean {
    return new Date(session.date) < new Date();
}

/** Эффективный статус: PLANNED + в прошлом → COMPLETED */
function getEffectiveStatus(session: CrmSession): string {
    if (session.status === 'PLANNED' && isPastSession(session)) return 'COMPLETED';
    return session.status;
}

export function CrmSessions() {
    const navigate = useNavigate();
    const { sessions, clients, fetchSessions, fetchClients, createSession, updateSession, deleteSession, quickPaySession, loading } =
        useCrmStore();
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
    const futureEnd = format(addDays(new Date(), 60), 'yyyy-MM-dd');
    // dateFrom: earlier of month start or today (to always include upcoming)
    const dateFrom = monthStart < todayStr ? monthStart : todayStr;
    // dateTo: later of month end or +60 days (to always include near future)
    const dateTo = monthEnd > futureEnd ? monthEnd : futureEnd;

    useEffect(() => {
        fetchClients();
    }, [fetchClients]);

    useEffect(() => {
        fetchSessions({
            dateFrom,
            dateTo,
            status: statusFilter !== 'all' ? statusFilter : undefined,
        });
    }, [fetchSessions, dateFrom, dateTo, statusFilter]);

    const clientMap = useMemo(() => {
        const map = new Map<string, CrmClient>();
        clients.forEach((c) => map.set(c.id, c));
        return map;
    }, [clients]);

    // Upcoming groups: days >= today, sorted ascending, limited to today + next day with sessions
    const upcomingGroups = useMemo(() => {
        const groups: Record<string, typeof sessions> = {};
        sessions.forEach((s) => {
            const day = format(parseISO(s.date), 'yyyy-MM-dd');
            if (day >= todayStr) {
                if (!groups[day]) groups[day] = [];
                groups[day].push(s);
            }
        });
        const sorted = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
        return sorted.slice(0, 2);
    }, [sessions, todayStr]);

    // Past groups: days < today within selected month, sorted newest first
    const pastGroups = useMemo(() => {
        const groups: Record<string, typeof sessions> = {};
        sessions.forEach((s) => {
            const day = format(parseISO(s.date), 'yyyy-MM-dd');
            if (day < todayStr && day >= monthStart && day <= monthEnd) {
                if (!groups[day]) groups[day] = [];
                groups[day].push(s);
            }
        });
        return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
    }, [sessions, todayStr, monthStart, monthEnd]);

    const stats = useMemo(() => {
        const monthSessions = sessions.filter((s) => {
            const day = format(parseISO(s.date), 'yyyy-MM-dd');
            return day >= monthStart && day <= monthEnd;
        });
        const total = monthSessions.length;
        const completed = monthSessions.filter((s) => getEffectiveStatus(s) === 'COMPLETED').length;
        const unpaid = monthSessions.filter((s) => {
            const eff = getEffectiveStatus(s);
            return !s.isPaid && eff !== 'CANCELLED_CLIENT' && eff !== 'CANCELLED_THERAPIST';
        }).length;
        const revenue = monthSessions
            .filter((s) => s.isPaid)
            .reduce((sum, s) => sum + (s.price || 0), 0);
        return { total, completed, unpaid, revenue };
    }, [sessions, monthStart, monthEnd]);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Сессии</h1>
                    <p className="text-unbox-grey text-sm">Управление расписанием и оплатой</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => navigate('/dashboard/bookings', { state: { openGrid: true } })}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-unbox-light text-unbox-dark rounded-xl font-medium text-sm hover:bg-unbox-light/40 transition-colors shadow-sm"
                    >
                        <LayoutGrid className="w-4 h-4" />
                        Расписание
                    </button>
                    <button
                        onClick={() => setShowForm(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-unbox-green text-white rounded-xl font-medium text-sm hover:bg-unbox-dark transition-colors shadow-md"
                    >
                        <Plus className="w-4 h-4" />
                        Новая сессия
                    </button>
                </div>
            </div>

            {/* Month Navigation + Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-2 bg-white rounded-xl border border-unbox-light px-1 py-1 shadow-sm">
                    <button
                        onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                        className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-medium text-sm w-32 text-center capitalize">
                        {format(currentMonth, 'LLLL yyyy', { locale: ru })}
                    </span>
                    <button
                        onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                        className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {['all', 'PLANNED', 'COMPLETED', 'CANCELLED_CLIENT'].map((s) => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                                statusFilter === s
                                    ? 'bg-unbox-green text-white border-unbox-green'
                                    : 'bg-white text-unbox-grey border-unbox-light hover:bg-unbox-light/30'
                            }`}
                        >
                            {s === 'all' ? 'Все' : STATUS_LABELS[s]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniStat label="Всего" value={stats.total} />
                <MiniStat label="Завершено" value={stats.completed} />
                <MiniStat label="Неоплачено" value={stats.unpaid} color={stats.unpaid > 0 ? 'red' : undefined} />
                <MiniStat label="Оплачено" value={`${stats.revenue} ₾`} color="green" />
            </div>

            {/* New Session Form */}
            {showForm && (
                <SessionForm
                    clients={clients.filter((c) => c.isActive)}
                    onSave={async (data) => {
                        await createSession(data);
                        setShowForm(false);
                        toast.success('Сессия создана');
                    }}
                    onCancel={() => setShowForm(false)}
                />
            )}

            {/* Sessions by Date */}
            {loading && !sessions.length ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-unbox-grey" />
                </div>
            ) : upcomingGroups.length === 0 && pastGroups.length === 0 ? (
                <div className="text-center py-12 text-unbox-grey">
                    <Calendar className="w-16 h-16 mx-auto mb-3 opacity-40" />
                    <p className="font-medium text-lg">Нет сессий</p>
                    <p className="text-sm mt-1">За выбранный период сессий не найдено</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Upcoming: today + next day */}
                    {upcomingGroups.length > 0 && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wide text-unbox-green">Предстоящие</span>
                                <div className="flex-1 h-px bg-unbox-green/20" />
                            </div>
                            {upcomingGroups.map(([day, daySessions]) => (
                                <DayGroup key={day} day={day} daySessions={daySessions} clientMap={clientMap} editingId={editingId} setEditingId={setEditingId} updateSession={updateSession} deleteSession={deleteSession} quickPaySession={quickPaySession} onBookRoom={(d) => navigate('/dashboard/bookings', { state: { openGrid: true, targetDate: d } })} />
                            ))}
                        </div>
                    )}
                    {/* Past: days in selected month */}
                    {pastGroups.length > 0 && (
                        <div className="space-y-6">
                            {upcomingGroups.length > 0 && (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-unbox-grey">История</span>
                                    <div className="flex-1 h-px bg-unbox-light" />
                                </div>
                            )}
                            {pastGroups.map(([day, daySessions]) => (
                                <DayGroup key={day} day={day} daySessions={daySessions} clientMap={clientMap} editingId={editingId} setEditingId={setEditingId} updateSession={updateSession} deleteSession={deleteSession} quickPaySession={quickPaySession} onBookRoom={(d) => navigate('/dashboard/bookings', { state: { openGrid: true, targetDate: d } })} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Day Group ─────────────────────────────────────────────────────────────────

function DayGroup({
    day,
    daySessions,
    clientMap,
    editingId,
    setEditingId,
    updateSession,
    deleteSession,
    quickPaySession,
    onBookRoom,
}: {
    day: string;
    daySessions: CrmSession[];
    clientMap: Map<string, CrmClient>;
    editingId: string | null;
    setEditingId: (id: string | null) => void;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<void>;
    deleteSession: (id: string) => Promise<void>;
    quickPaySession: (id: string) => Promise<{ amount: number; currency: string }>;
    onBookRoom?: (day: string) => void;
}) {
    const navigate = useNavigate();
    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-unbox-grey capitalize">
                    {format(parseISO(day), 'EEEE, d MMMM', { locale: ru })}
                </div>
                {onBookRoom && (
                    <button
                        onClick={() => onBookRoom(day)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-unbox-light bg-white hover:bg-unbox-light/40 text-unbox-grey hover:text-unbox-dark transition-colors"
                    >
                        <Calendar className="w-3.5 h-3.5" />
                        Забронировать кабинет
                    </button>
                )}
            </div>
            <div className="space-y-2">
                {daySessions
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((session) => {
                        const client = clientMap.get(session.clientId);
                        const dt = parseISO(session.date);
                        const isEditing = editingId === session.id;
                        const effectiveStatus = getEffectiveStatus(session);
                        const isCancelled = effectiveStatus === 'CANCELLED_CLIENT' || effectiveStatus === 'CANCELLED_THERAPIST';
                        return (
                            <div key={session.id} className="space-y-0">
                                <div
                                    className={`bg-white rounded-xl border shadow-sm p-4 flex items-center gap-4 transition-all hover:shadow-md ${
                                        isEditing
                                            ? 'border-unbox-green rounded-b-none'
                                            : !session.isPaid && !isCancelled
                                            ? 'border-orange-200'
                                            : 'border-unbox-light'
                                    }`}
                                >
                                    <div className="w-14 text-center shrink-0">
                                        <div className="text-lg font-bold text-unbox-dark">{format(dt, 'HH:mm')}</div>
                                        <div className="text-xs text-unbox-grey">{session.durationMinutes} мин</div>
                                    </div>
                                    <div className="w-px h-10 bg-unbox-light shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-unbox-dark truncate">
                                            {client?.name || 'Неизвестный клиент'}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                            <StatusBadgeDropdown
                                                session={session}
                                                onUpdate={async (status) => {
                                                    await updateSession(session.id, { status });
                                                    toast.success('Статус обновлён');
                                                }}
                                            />
                                            {session.isBooked ? (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">
                                                    Кабинет ✓
                                                </span>
                                            ) : !isCancelled && (
                                                <button
                                                    onClick={() => navigate('/dashboard/bookings', {
                                                        state: {
                                                            crmMode: {
                                                                sessionId: session.id,
                                                                clientId: session.clientId,
                                                                clientName: client?.name || 'Клиент',
                                                                date: session.date,
                                                                duration: session.durationMinutes,
                                                            },
                                                        },
                                                    })}
                                                    className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 transition-colors"
                                                >
                                                    + Кабинет
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0 flex items-center gap-2">
                                        <div>
                                            <div className="font-semibold text-unbox-dark">
                                                {session.price ?? client?.basePrice ?? '—'} {client?.currency || '₾'}
                                            </div>
                                            {session.isPaid ? (
                                                <span className="text-xs text-green-600">Оплачено</span>
                                            ) : (
                                                <span className="text-xs text-orange-500">Не оплачено</span>
                                            )}
                                        </div>
                                        {!session.isPaid && !isCancelled && (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const result = await quickPaySession(session.id);
                                                        toast.success(`Оплачено: ${result.amount} ${result.currency}`);
                                                    } catch (e: any) {
                                                        toast.error(e.message || 'Ошибка');
                                                    }
                                                }}
                                                className="p-2 bg-green-50 hover:bg-green-100 text-green-600 rounded-lg transition-colors"
                                                title="Быстрая оплата"
                                            >
                                                <Banknote className="w-4 h-4" />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setEditingId(isEditing ? null : session.id)}
                                            className={`p-2 rounded-lg transition-colors ${
                                                isEditing
                                                    ? 'bg-unbox-light text-unbox-green'
                                                    : 'hover:bg-unbox-light/50 text-unbox-grey hover:text-unbox-green'
                                            }`}
                                            title="Редактировать"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={async () => {
                                                if (!confirm('Удалить сессию?')) return;
                                                try {
                                                    await deleteSession(session.id);
                                                    toast.success('Сессия удалена');
                                                } catch (e: any) {
                                                    toast.error(e.message || 'Ошибка');
                                                }
                                            }}
                                            className="p-2 hover:bg-red-50 text-unbox-grey hover:text-red-500 rounded-lg transition-colors"
                                            title="Удалить"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                                {isEditing && (
                                    <SessionEditPanel
                                        session={session}
                                        clientCurrency={client?.currency}
                                        onSave={async (data) => {
                                            await updateSession(session.id, data);
                                            setEditingId(null);
                                            toast.success('Сессия обновлена');
                                        }}
                                        onCancel={() => setEditingId(null)}
                                    />
                                )}
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}

// ── Status Badge Dropdown ─────────────────────────────────────────────────────

function StatusBadgeDropdown({
    session,
    onUpdate,
}: {
    session: CrmSession;
    onUpdate: (status: string) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const effectiveStatus = getEffectiveStatus(session);
    const past = isPastSession(session);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const options = past
        ? ['COMPLETED', 'CANCELLED_CLIENT', 'CANCELLED_THERAPIST']
        : ['PLANNED', 'COMPLETED', 'CANCELLED_CLIENT', 'CANCELLED_THERAPIST'];

    const handleSelect = async (status: string) => {
        setOpen(false);
        if (status === effectiveStatus && !(session.status === 'PLANNED' && status === 'COMPLETED')) return;
        setSaving(true);
        try {
            await onUpdate(status);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((v) => !v)}
                disabled={saving}
                className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    STATUS_COLORS[effectiveStatus] || 'bg-unbox-light/50'
                } ${past ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            >
                {saving ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                    STATUS_LABELS[effectiveStatus] || effectiveStatus
                )}
                {past && <ChevronDown className="w-3 h-3 opacity-60" />}
            </button>
            {open && (
                <div className="absolute left-0 top-full mt-1 z-10 bg-white border border-unbox-light rounded-xl shadow-lg py-1 min-w-[160px]">
                    {options.map((s) => (
                        <button
                            key={s}
                            onClick={() => handleSelect(s)}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-unbox-light/40 transition-colors flex items-center gap-2 ${
                                s === effectiveStatus ? 'font-medium' : ''
                            }`}
                        >
                            <span
                                className={`w-2 h-2 rounded-full ${
                                    s === 'COMPLETED'
                                        ? 'bg-green-500'
                                        : s === 'CANCELLED_CLIENT'
                                        ? 'bg-red-500'
                                        : s === 'CANCELLED_THERAPIST'
                                        ? 'bg-orange-500'
                                        : 'bg-blue-500'
                                }`}
                            />
                            {STATUS_LABELS[s]}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Mini Stat ────────────────────────────────────────────────────────────────

function MiniStat({ label, value, color }: { label: string; value: number | string; color?: string }) {
    const textColor = color === 'red' ? 'text-red-600' : color === 'green' ? 'text-green-600' : 'text-unbox-dark';
    return (
        <div className="bg-white rounded-xl border border-unbox-light p-3 shadow-sm">
            <div className={`text-xl font-bold ${textColor}`}>{value}</div>
            <div className="text-xs text-unbox-grey">{label}</div>
        </div>
    );
}

// ── Session Edit Panel ────────────────────────────────────────────────────────

function SessionEditPanel({
    session,
    clientCurrency,
    onSave,
    onCancel,
}: {
    session: import('../../api/crm').CrmSession;
    clientCurrency?: string;
    onSave: (data: CrmSessionUpdate) => Promise<void>;
    onCancel: () => void;
}) {
    const [date, setDate] = useState(format(parseISO(session.date), "yyyy-MM-dd'T'HH:mm"));
    const [duration, setDuration] = useState(String(session.durationMinutes));
    const [status, setStatus] = useState(getEffectiveStatus(session));
    const [price, setPrice] = useState(String(session.price ?? ''));
    const [isPaid, setIsPaid] = useState(session.isPaid);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await onSave({
                date: new Date(date).toISOString(),
                durationMinutes: Number(duration),
                status,
                price: price ? Number(price) : undefined,
                isPaid,
            });
        } catch (err: any) {
            toast.error(err.message || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="bg-unbox-light/40 border border-unbox-green border-t-0 rounded-b-xl px-4 py-3 space-y-3 animate-in fade-in slide-in-from-top-1"
        >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">Дата и время</label>
                    <input
                        type="datetime-local"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">Длительность</label>
                    <select
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                    >
                        <option value="30">30 мин</option>
                        <option value="45">45 мин</option>
                        <option value="50">50 мин</option>
                        <option value="60">60 мин</option>
                        <option value="90">90 мин</option>
                        <option value="120">2 часа</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">Статус</label>
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as typeof status)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                    >
                        <option value="PLANNED">Запланирована</option>
                        <option value="COMPLETED">Завершена</option>
                        <option value="CANCELLED_CLIENT">Отмена (клиент)</option>
                        <option value="CANCELLED_THERAPIST">Отмена (терапевт)</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">
                        Цена {clientCurrency ? `(${clientCurrency})` : ''}
                    </label>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                    />
                </div>
            </div>

            <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-unbox-dark cursor-pointer">
                    <input
                        type="checkbox"
                        checked={isPaid}
                        onChange={(e) => setIsPaid(e.target.checked)}
                        className="rounded"
                    />
                    Оплачено
                </label>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-3 py-1.5 text-xs text-unbox-grey hover:bg-unbox-light/50 rounded-lg transition-colors"
                    >
                        Отмена
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-unbox-green text-white text-xs font-medium rounded-lg hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                    >
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Сохранить
                    </button>
                </div>
            </div>
        </form>
    );
}

// ── Session Form ─────────────────────────────────────────────────────────────

function SessionForm({
    clients,
    onSave,
    onCancel,
}: {
    clients: CrmClient[];
    onSave: (data: CrmSessionCreate) => Promise<void>;
    onCancel: () => void;
}) {
    const [clientId, setClientId] = useState('');
    const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    const [duration, setDuration] = useState('60');
    const [price, setPrice] = useState('');
    const [saving, setSaving] = useState(false);

    const selectedClient = clients.find((c) => c.id === clientId);

    useEffect(() => {
        if (selectedClient) {
            setPrice(String(selectedClient.basePrice));
        }
    }, [selectedClient]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!clientId) return;
        setSaving(true);
        try {
            await onSave({
                clientId,
                date: new Date(date).toISOString(),
                durationMinutes: Number(duration),
                price: price ? Number(price) : undefined,
            });
        } catch (err: any) {
            toast.error(err.message || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl border border-unbox-light shadow-sm p-5 space-y-4 animate-in fade-in slide-in-from-top-2"
        >
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Новая сессия</h3>
                <button type="button" onClick={onCancel} className="p-1 hover:bg-unbox-light/50 rounded-lg">
                    <X className="w-5 h-5 text-unbox-grey" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Клиент <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        required
                    >
                        <option value="">Выберите клиента</option>
                        {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name} {c.aliasCode ? `#${c.aliasCode}` : ''}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Дата и время <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="datetime-local"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        required
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Длительность (мин)</label>
                    <select
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                    >
                        <option value="30">30 минут</option>
                        <option value="45">45 минут</option>
                        <option value="50">50 минут</option>
                        <option value="60">60 минут</option>
                        <option value="90">90 минут</option>
                        <option value="120">2 часа</option>
                    </select>
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Стоимость {selectedClient && `(${selectedClient.currency})`}
                    </label>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        placeholder={selectedClient ? String(selectedClient.basePrice) : '0'}
                    />
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-sm text-unbox-grey hover:bg-unbox-light/50 rounded-xl transition-colors"
                >
                    Отмена
                </button>
                <button
                    type="submit"
                    disabled={saving || !clientId}
                    className="flex items-center gap-2 px-5 py-2 bg-unbox-green text-white text-sm font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Создать
                </button>
            </div>
        </form>
    );
}
