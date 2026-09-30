import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { getMyBookingsPath } from '../utils/userPaths';
import { Bell, Clock, Trash2, CheckCircle2, X, Calendar as CalendarIcon } from 'lucide-react';
import { parseISO } from 'date-fns';
import { waitlistApi } from '../api/waitlist';
import { RESOURCES, LOCATIONS } from '../utils/data';
import type { WaitlistEntry } from '../store/types';
import { COLOR, RADIUS, STATUS, TEXT } from '../design/tokens';
import { formatDateLabel, formatTimeRange } from '../utils/format';
import { toastApiError } from '../utils/errors';
import { useInMobileShell } from '../utils/catalogPath';
import { SkeletonList } from '../components/ui/Skeleton';
import { ErrorBar } from '../components/ui/ErrorBar';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { MobilePageHeader } from '../components/ui/PageHeader';
import { undoToast } from '../components/ui/undoToast';

// Цвета — статус-токены: «ждём» янтарный, «освободилось» зелёный, «отменена» серый.
const STATUS_META: Record<WaitlistEntry['status'], { label: string; bg: string; fg: string }> = {
    active:    { label: 'Ждём',         bg: STATUS.pending.bg, fg: STATUS.pending.fg },
    fulfilled: { label: 'Освободилось', bg: STATUS.ok.bg,      fg: STATUS.ok.fg },
    cancelled: { label: 'Отменена',     bg: STATUS.muted.bg,   fg: STATUS.muted.fg },
};

/** Сколько ждать «Вернуть», прежде чем удалить подписку на сервере. */
const UNDO_MS = 5000;

/**
 * «Слежу за слотами» — /dashboard/waitlist, /crm/waitlist, /admin/my-waitlist
 * и /m/waitlist (внутри мобильного приложения).
 *
 * Волна 2 (G3-19): удаление — сразу из списка и 5 секунд на «Вернуть»; на
 * сервер запрос уходит, только если не вернули (восстановить подписку сервер
 * не умеет, поэтому ждём). Заголовок строки — «Любой кабинет в Unbox One»:
 * сервер сообщает об освобождении любого кабинета центра (waitlist_notify),
 * ниже мелко — какой кабинет человек смотрел.
 */
export function MyWaitlistPage() {
    const inShell = useInMobileShell();
    const navigate = useNavigate();
    const [entries, setEntries] = useState<WaitlistEntry[]>([]);
    const [loading, setLoading] = useState(true);
    // Ошибка загрузки ≠ «подписок нет»: без этого флага сбой сети
    // показывал «Подписок пока нет».
    const [loadError, setLoadError] = useState(false);
    // Подписки, удаление которых ещё можно отменить: id → таймер.
    const pendingRemovals = useRef(new Map<string, number>());

    const load = async () => {
        setLoading(true);
        setLoadError(false);
        try {
            const list = await waitlistApi.getMyWaitlist(0, 200);
            // Newest active first; then fulfilled; then cancelled
            const order = { active: 0, fulfilled: 1, cancelled: 2 } as const;
            list.sort((a, b) => {
                const so = order[a.status] - order[b.status];
                if (so !== 0) return so;
                return (b.createdAt || '').localeCompare(a.createdAt || '');
            });
            setEntries(list.filter(e => !pendingRemovals.current.has(e.id)));
        } catch {
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    // Ушли со страницы — удаления, которые не вернули, отправляем сразу.
    useEffect(() => {
        const pending = pendingRemovals.current;
        return () => {
            pending.forEach((timer, id) => {
                window.clearTimeout(timer);
                waitlistApi.removeFromWaitlist(id).catch(() => {});
            });
            pending.clear();
        };
    }, []);

    const remove = (entry: WaitlistEntry) => {
        const index = entries.findIndex(e => e.id === entry.id);
        setEntries(prev => prev.filter(e => e.id !== entry.id));
        const timer = window.setTimeout(async () => {
            pendingRemovals.current.delete(entry.id);
            try {
                await waitlistApi.removeFromWaitlist(entry.id);
            } catch (e) {
                // Не удалилось — возвращаем строку на место и говорим об этом.
                setEntries(prev => {
                    const next = [...prev];
                    next.splice(Math.min(index, next.length), 0, entry);
                    return next;
                });
                toastApiError(e, 'Не удалось отменить подписку');
            }
        }, UNDO_MS);
        pendingRemovals.current.set(entry.id, timer);
        undoToast('Больше не следим за этим временем', () => {
            window.clearTimeout(timer);
            pendingRemovals.current.delete(entry.id);
            setEntries(prev => {
                if (prev.some(e => e.id === entry.id)) return prev;
                const next = [...prev];
                next.splice(Math.min(index, next.length), 0, entry);
                return next;
            });
        }, UNDO_MS);
    };

    const stats = useMemo(() => ({
        active:    entries.filter(e => e.status === 'active').length,
        fulfilled: entries.filter(e => e.status === 'fulfilled').length,
        cancelled: entries.filter(e => e.status === 'cancelled').length,
    }), [entries]);

    // Куда вести «найти время»: в приложении — «Свободно», на компьютере — шахматка.
    const findPath = inShell ? '/m/find' : getMyBookingsPath(useUserStore.getState().currentUser);

    return (
        <div style={{ color: COLOR.ink, paddingBottom: 80 }}>
            {inShell && <MobilePageHeader title="Слежу за слотами" fallbackTo="/m/me" />}
            <div style={{ padding: inShell ? '8px 16px 0' : '24px 16px 0' }}>
                {!inShell && (
                    <h1 style={{ fontSize: TEXT.heading, fontWeight: 600, lineHeight: 1.2, margin: '0 0 4px' }}>
                        Слежу за слотами
                    </h1>
                )}
                <p style={{ fontSize: TEXT.small, color: COLOR.ink60, margin: '0 0 16px', lineHeight: 1.5 }}>
                    Напишем в Telegram и в уведомлениях, когда в этом центре освободится любой кабинет в выбранное время.
                </p>

                {/* Счётчики — только после ответа сервера, не «0 активных» во время загрузки. */}
                {!loading && !loadError && entries.length > 0 && (
                    <div style={{ display: 'flex', gap: 12, marginBottom: 16, fontSize: TEXT.small, color: COLOR.ink60 }}>
                        <span>Ждём: <span className="num">{stats.active}</span></span>
                        <span>Освободилось: <span className="num">{stats.fulfilled}</span></span>
                        {stats.cancelled > 0 && <span>Отменены: <span className="num">{stats.cancelled}</span></span>}
                    </div>
                )}

                {loading ? (
                    <SkeletonList count={3} label="Загружаем подписки" />
                ) : loadError ? (
                    <ErrorBar message="Не удалось загрузить подписки" onRetry={load} />
                ) : entries.length === 0 ? (
                    <EmptyState
                        icon={<Bell size={28} />}
                        title="Вы пока ни за чем не следите"
                        hint={inShell
                            ? 'Если нужное время занято, в «Свободно» нажмите «Сообщить, когда освободится».'
                            : 'Откройте шахматку и нажмите на занятое время — мы сообщим, когда в этом центре что-то освободится.'}
                        action={{ label: inShell ? 'Найти время' : 'Открыть шахматку', onClick: () => navigate(findPath) }}
                    />
                ) : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {entries.map(e => (
                            <EntryCard key={e.id} entry={e} inShell={inShell} onRemove={remove} />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function EntryCard({ entry, inShell, onRemove }: {
    entry: WaitlistEntry;
    inShell: boolean;
    onRemove: (entry: WaitlistEntry) => void;
}) {
    const navigate = useNavigate();
    const resource = RESOURCES.find(r => r.id === entry.resourceId);
    const location = resource ? LOCATIONS.find(l => l.id === resource.locationId) : null;
    const meta = STATUS_META[entry.status];

    // «Чт, 1 октября» (год — только если не текущий); раньше было
    // «1 Октября 2026, Четверг» через capitalize.
    const dayLabel = formatDateLabel(entry.date, { capitalize: true, withYear: 'auto', fallback: entry.date });
    let dateObj: Date | null = null;
    try {
        dateObj = parseISO(entry.date);
    } catch {
        dateObj = null;
    }

    const goToBook = () => {
        if (inShell) {
            // В приложении — «Свободно» на этот день.
            navigate(`/m/find?date=${encodeURIComponent(entry.date)}`);
            return;
        }
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

    const title = location ? `Любой кабинет в ${location.name}` : (resource?.name || entry.resourceId);
    const Icon = entry.status === 'fulfilled' ? CheckCircle2 : entry.status === 'cancelled' ? X : Bell;

    return (
        <li style={{
            background: COLOR.card,
            border: `1px solid ${COLOR.ink10}`,
            borderRadius: RADIUS.sheet,
            padding: 16,
        }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div aria-hidden="true" style={{
                    width: 40, height: 40, borderRadius: 999, flexShrink: 0,
                    display: 'grid', placeItems: 'center',
                    background: meta.bg, color: meta.fg,
                }}>
                    <Icon size={20} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: TEXT.body, fontWeight: 600, color: entry.status === 'cancelled' ? COLOR.ink60 : COLOR.ink }}>
                            {title}
                        </span>
                        <span className="ui-badge" style={{ background: meta.bg, color: meta.fg }}>{meta.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: TEXT.small, marginTop: 6 }}>
                        <Clock size={14} aria-hidden="true" color={COLOR.ink60} style={{ flexShrink: 0 }} />
                        <span>{dayLabel}</span>
                        <span aria-hidden="true" style={{ color: COLOR.ink60 }}>·</span>
                        <span className="num" style={{ fontWeight: 600 }}>
                            {formatTimeRange(entry.startTime, entry.endTime)}
                        </span>
                    </div>
                    {location && resource && (
                        <div style={{ fontSize: TEXT.small, color: COLOR.ink60, marginTop: 2 }}>
                            Вы смотрели {resource.name}
                        </div>
                    )}
                </div>

                {entry.status === 'active' && (
                    <button
                        type="button"
                        onClick={() => onRemove(entry)}
                        aria-label={`Перестать следить: ${title}, ${dayLabel}, ${formatTimeRange(entry.startTime, entry.endTime)}`}
                        style={{
                            width: 44, height: 44, margin: -8, flexShrink: 0,
                            display: 'grid', placeItems: 'center',
                            background: 'transparent', border: 'none', cursor: 'pointer', color: COLOR.ink60,
                        }}
                    >
                        <Trash2 size={18} aria-hidden="true" />
                    </button>
                )}
            </div>

            {/* «Забронировать» — только у сработавших: время освободилось. */}
            {entry.status === 'fulfilled' && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${COLOR.ink10}` }}>
                    <Button block icon={<CalendarIcon size={16} aria-hidden="true" />} onClick={goToBook}>
                        Забронировать
                    </Button>
                </div>
            )}
        </li>
    );
}
