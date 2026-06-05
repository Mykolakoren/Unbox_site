import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { getMyBookingsPath } from '../utils/userPaths';
import { Bell, MapPin, Clock, Trash2, CheckCircle2, X, Calendar as CalendarIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { waitlistApi } from '../api/waitlist';
import { RESOURCES, LOCATIONS } from '../utils/data';
import type { WaitlistEntry } from '../store/types';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

const STATUS_META: Record<WaitlistEntry['status'], { label: string; bg: string; fg: string }> = {
    active:    { label: 'Активна',     bg: '#FEF3C7', fg: '#92400E' },
    fulfilled: { label: 'Освободилось', bg: '#D1FAE5', fg: '#065F46' },
    cancelled: { label: 'Отменена',    bg: '#F3F4F6', fg: '#4B5563' },
};

export function MyWaitlistPage() {
    const [entries, setEntries] = useState<WaitlistEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [removingId, setRemovingId] = useState<string | null>(null);

    const load = async () => {
        try {
            const list = await waitlistApi.getMyWaitlist(0, 200);
            // Newest active first; then fulfilled; then cancelled
            const order = { active: 0, fulfilled: 1, cancelled: 2 } as const;
            list.sort((a, b) => {
                const so = order[a.status] - order[b.status];
                if (so !== 0) return so;
                return (b.createdAt || '').localeCompare(a.createdAt || '');
            });
            setEntries(list);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось загрузить подписки');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const remove = async (id: string) => {
        setRemovingId(id);
        try {
            await waitlistApi.removeFromWaitlist(id);
            setEntries(prev => prev.filter(e => e.id !== id));
            toast.success('Подписка отменена');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось отменить');
        } finally {
            setRemovingId(null);
        }
    };

    const stats = useMemo(() => ({
        active:    entries.filter(e => e.status === 'active').length,
        fulfilled: entries.filter(e => e.status === 'fulfilled').length,
        cancelled: entries.filter(e => e.status === 'cancelled').length,
    }), [entries]);

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, paddingBottom: 80 }}>
            <div style={{ padding: '24px 16px 0' }}>
                <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink30, marginBottom: 8 }}>
                    МОИ ПОДПИСКИ НА СЛОТЫ
                </div>
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                        <h1 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                            Слежу за слотами
                        </h1>
                        <p className="text-sm text-unbox-grey mt-1">
                            Уведомим в Telegram и в кабинете, когда любой кабинет в выбранном филиале освободится в это время.
                        </p>
                    </div>
                </div>

                <div className="flex gap-3 mb-5 text-sm" style={{ fontFamily: GH_MONO }}>
                    <span style={{ color: GH.ink60 }}>{stats.active} активных</span>
                    <span style={{ color: GH.ink30 }}>{stats.fulfilled} сработали</span>
                    {stats.cancelled > 0 && <span style={{ color: GH.ink30 }}>{stats.cancelled} отменены</span>}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
                    </div>
                ) : entries.length === 0 ? (
                    <EmptyState />
                ) : (
                    <ul className="space-y-2">
                        {entries.map(e => (
                            <EntryCard
                                key={e.id}
                                entry={e}
                                onRemove={remove}
                                removing={removingId === e.id}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <div
            className="rounded-2xl border border-dashed flex flex-col items-center text-center px-6 py-10"
            style={{ borderColor: GH.ink10, background: GH.ink5 }}
        >
            <div className="w-12 h-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center mb-3">
                <Bell size={22} />
            </div>
            <h3 className="text-base font-bold text-unbox-dark mb-1">Подписок пока нет</h3>
            <p className="text-sm text-unbox-grey mb-4 max-w-sm">
                Зайди в шахматку и нажми на занятый слот — мы пришлём уведомление, как только время в этом филиале освободится.
            </p>
            <Link
                to={getMyBookingsPath(useUserStore.getState().currentUser)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-unbox-green text-white"
            >
                <CalendarIcon size={14} /> Открыть шахматку
            </Link>
        </div>
    );
}

function EntryCard({ entry, onRemove, removing }: {
    entry: WaitlistEntry;
    onRemove: (id: string) => void;
    removing: boolean;
}) {
    const navigate = useNavigate();
    const resource = RESOURCES.find(r => r.id === entry.resourceId);
    const location = resource ? LOCATIONS.find(l => l.id === resource.locationId) : null;
    const meta = STATUS_META[entry.status];

    let dayLabel = '';
    let dateObj: Date | null = null;
    try {
        const d = parseISO(entry.date);
        dateObj = d;
        dayLabel = format(d, 'd MMMM yyyy, EEEE', { locale: ru });
    } catch {
        dayLabel = entry.date;
    }

    const goToChess = () => {
        // Drop the user straight on the chessboard at the right date with the
        // location pre-filtered. Avoids the "now hunt for the cabinet" step
        // admin flagged after slot-freed alerts. focusResourceId lets the page
        // also auto-pick the location filter from the resource → location map.
        navigate(getMyBookingsPath(useUserStore.getState().currentUser), {
            state: {
                targetDate: dateObj?.toISOString() ?? entry.date,
                focusResourceId: entry.resourceId,
                forceView: 'grid',
            },
        });
    };

    return (
        <li
            className="rounded-xl border bg-white p-3 sm:p-4"
            style={{ borderColor: GH.ink10, opacity: entry.status === 'cancelled' ? 0.6 : 1 }}
        >
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: meta.bg, color: meta.fg }}
                >
                    {entry.status === 'fulfilled'
                        ? <CheckCircle2 size={20} />
                        : entry.status === 'cancelled'
                            ? <X size={20} />
                            : <Bell size={20} />}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-unbox-dark text-[15px] truncate">
                            {resource?.name || entry.resourceId}
                        </span>
                        <span
                            className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={{ background: meta.bg, color: meta.fg }}
                        >
                            {meta.label}
                        </span>
                    </div>
                    {location && (
                        <div className="flex items-center gap-1 text-xs text-unbox-grey mt-0.5">
                            <MapPin size={12} className="shrink-0" />
                            <span className="truncate">{location.name}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-1 text-sm text-unbox-dark mt-2">
                        <Clock size={14} className="shrink-0 text-unbox-grey" />
                        <span className="capitalize">{dayLabel}</span>
                        <span className="text-unbox-grey">·</span>
                        <span className="font-semibold tabular-nums">
                            {entry.startTime}–{entry.endTime}
                        </span>
                    </div>
                </div>

                {entry.status === 'active' && (
                    <button
                        onClick={() => onRemove(entry.id)}
                        disabled={removing}
                        title="Отменить подписку"
                        className="p-2 -m-1 text-unbox-grey hover:text-red-600 disabled:opacity-50 transition-colors shrink-0"
                    >
                        <Trash2 size={18} />
                    </button>
                )}
            </div>

            {/* "Забронировать" — only on fulfilled rows. The slot has freed up
                somewhere in the same branch; sending the user to /dashboard/bookings
                with date + resource pre-filtered saves the manual hunt. */}
            {entry.status === 'fulfilled' && (
                <div className="mt-3 pt-3 border-t" style={{ borderColor: GH.ink10 }}>
                    <button
                        onClick={goToChess}
                        className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold"
                        style={{ background: GH.ink, color: GH.paper }}
                    >
                        <CalendarIcon size={14} /> Забронировать
                    </button>
                </div>
            )}
        </li>
    );
}
