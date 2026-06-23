import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Briefcase, CheckSquare, ChevronDown, Clock, MapPin, MessageCircle, Plus, ShieldCheck } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { BookingDetailSheet } from './BookingDetailSheet';
import { usePullToRefresh } from './usePullToRefresh';
import { PullIndicator } from './PullIndicator';
import { prepareRepeat } from './repeatBooking';
import { priceLabel } from './priceLabel';
import { NotificationsBell } from './NotificationsBell';
import { adminTasksApi, type AdminTask } from '../../api/adminTasks';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import { getRecurrence, withRecurrence, nextDeadline } from './admin/taskRecurrence';
import { toast } from 'sonner';
import type { BookingHistoryItem } from '../../store/types';

const sectionPad: React.CSSProperties = { padding: '0 16px' };

export function MobileToday() {
    const navigate = useNavigate();
    // Селективные селекторы вместо whole-store: ре-рендер только при
    // изменении именно этих полей, а не любого поля стора (баланс, users…).
    // Это убирает основной стуттер при скролле/обновлении данных.
    const currentUser = useUserStore(s => s.currentUser);
    const bookings = useUserStore(s => s.bookings);
    const fetchBookings = useUserStore(s => s.fetchBookings);
    const [openBooking, setOpenBooking] = useState<BookingHistoryItem | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [repeatOpen, setRepeatOpen] = useState(false);
    const pull = usePullToRefresh(async () => {
        setRefreshing(true);
        try { await fetchBookings(); } finally { setRefreshing(false); }
    });

    useEffect(() => {
        fetchBookings();
    }, [fetchBookings]);

    // Tasks-for-you mini-section. Lazy fetch — only when this component
    // mounts. Failures stay silent so the rest of the page works without
    // an admin-tasks backend (e.g. for clients).
    //
    // 2026-05-15 spec: show ONLY tasks within the next ~3 days (or already
    // overdue). The full Kanban lives at /m/admin/tasks — this mini block
    // is meant to surface "что горит" without becoming a long list.
    const [myTasks, setMyTasks] = useState<AdminTask[]>([]);
    useEffect(() => {
        if (!currentUser?.id) return;
        adminTasksApi.list({ assigneeId: currentUser.id })
            .then(list => {
                const horizonMs = Date.now() + 3 * 24 * 3600 * 1000;
                setMyTasks(list.filter(t => {
                    if (t.status === 'DONE') return false;
                    if (!t.deadline) return false;
                    return new Date(t.deadline).getTime() <= horizonMs;
                }));
            })
            .catch(() => {});
    }, [currentUser?.id]);

    const completeTask = async (id: string) => {
        const task = myTasks.find(t => t.id === id);
        try {
            await adminTasksApi.update(id, { status: 'DONE' });
            setMyTasks(prev => prev.filter(t => t.id !== id));
            toast.success('Готово ✓');
            // Auto-spawn next iteration for recurring tasks. Same logic as in
            // /m/admin/tasks — keeps both surfaces consistent.
            if (task) {
                const rec = getRecurrence(task);
                if (rec) {
                    const prevDl = task.deadline ? new Date(task.deadline) : null;
                    const created = await adminTasksApi.create({
                        title: task.title,
                        description: task.description,
                        priority: task.priority,
                        assigneeId: task.assigneeId,
                        assigneeName: task.assigneeName,
                        deadline: nextDeadline(prevDl, rec).toISOString(),
                        labels: withRecurrence(task.labels, rec),
                    }).catch(() => null);
                    if (created) {
                        setMyTasks(prev => [created, ...prev]);
                        toast.info('Создана следующая регулярная', { duration: 3000 });
                    }
                }
            }
        } catch { toast.error('Не получилось'); }
    };

    const myBookings = useMemo(() => {
        if (!currentUser) return [];
        return bookings.filter(b =>
            (b.userId === currentUser.email || (b as any).user_uuid === currentUser.id)
            && b.status === 'confirmed'
        );
    }, [bookings, currentUser]);

    const now = new Date();
    const sortedFuture = useMemo(() => {
        return myBookings
            .map(b => ({ b, dt: bookingStartDate(b) }))
            .filter(x => x.dt && x.dt.getTime() + (x.b.duration ?? 60) * 60000 > now.getTime())
            .sort((a, b) => (a.dt!.getTime() - b.dt!.getTime()));
    }, [myBookings, now]);

    const active = sortedFuture.find(x => x.dt!.getTime() <= now.getTime() && x.dt!.getTime() + (x.b.duration ?? 60) * 60000 > now.getTime());
    const upcoming = sortedFuture.filter(x => x !== active).slice(0, 6);

    /** Detect the user's REGULAR slot — the (resource + weekday + time)
     *  triple they've booked ≥3 times in the last 60 days. Returns the
     *  most-recent matching booking so we have a `BookingHistoryItem` to
     *  feed into `prepareRepeat`, and the suggested next-date (next
     *  occurrence of that weekday that's strictly in the future). If the
     *  user has already booked that exact slot ahead, we hide the CTA so
     *  it doesn't nag. */
    const regularSlot = useMemo(() => {
        const SIXTY_DAYS = 60 * 24 * 3600 * 1000;
        const horizon = now.getTime() - SIXTY_DAYS;
        const recent = myBookings
            .map(b => ({ b, dt: bookingStartDate(b) }))
            .filter(x => x.dt && x.dt.getTime() >= horizon && x.dt.getTime() <= now.getTime())
            .filter(x => x.b.status === 'confirmed' || x.b.status === 'completed');

        const buckets = new Map<string, { count: number; latest: { b: BookingHistoryItem; dt: Date } }>();
        for (const x of recent) {
            const key = `${x.b.resourceId}|${x.b.startTime}|${x.dt!.getDay()}|${x.b.duration}`;
            const ex = buckets.get(key);
            if (!ex) {
                buckets.set(key, { count: 1, latest: { b: x.b, dt: x.dt! } });
            } else {
                ex.count++;
                if (x.dt!.getTime() > ex.latest.dt.getTime()) ex.latest = { b: x.b, dt: x.dt! };
            }
        }

        const candidates = [...buckets.values()].filter(v => v.count >= 3);
        if (candidates.length === 0) return null;
        // Pick the bucket with the most-recent latest occurrence (so the
        // suggestion always reflects the slot the user actively uses now,
        // not one they did 3 times then dropped).
        candidates.sort((a, b) => b.latest.dt.getTime() - a.latest.dt.getTime());
        const winner = candidates[0];

        // Compute next occurrence of the same weekday strictly after today.
        const targetWeekday = winner.latest.dt.getDay();
        const next = new Date();
        next.setHours(0, 0, 0, 0);
        do {
            next.setDate(next.getDate() + 1);
        } while (next.getDay() !== targetWeekday);

        // Hide CTA if user already booked the same cabinet+time on `next`.
        const nextKey = `${winner.latest.b.resourceId}|${winner.latest.b.startTime}`;
        const alreadyBooked = sortedFuture.some(x => {
            if (!x.dt) return false;
            const sameDay = x.dt.getFullYear() === next.getFullYear()
                && x.dt.getMonth() === next.getMonth()
                && x.dt.getDate() === next.getDate();
            return sameDay && `${x.b.resourceId}|${x.b.startTime}` === nextKey;
        });
        if (alreadyBooked) return null;

        return { booking: winner.latest.b, count: winner.count, nextDate: next };
    }, [myBookings, sortedFuture, now]);

    /** Last 5 distinct (cabinet+startTime+weekday) past sessions for "повторить" menu. */
    const lastFive = useMemo(() => {
        const past = myBookings
            .map(b => ({ b, dt: bookingStartDate(b) }))
            .filter(x => x.dt && x.dt.getTime() + (x.b.duration ?? 60) * 60000 <= now.getTime())
            .sort((a, b) => b.dt!.getTime() - a.dt!.getTime());
        // Dedupe by `(resource|startTime|weekday)` so the menu doesn't repeat
        // identical recurring slots — the goal is to surface up to 5 *kinds*
        // of sessions the user runs, not the literal last 5 dates.
        const seen = new Set<string>();
        const out: { b: BookingHistoryItem; dt: Date }[] = [];
        for (const x of past) {
            const key = `${x.b.resourceId}|${x.b.startTime}|${x.dt!.getDay()}|${x.b.duration}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ b: x.b, dt: x.dt! });
            if (out.length >= 5) break;
        }
        return out;
    }, [myBookings, now]);

    if (!currentUser) return null;

    const goToFind = () => navigate('/m/find');

    // Workspace shortcuts in the header. Visible to specialists/admins so they
    // can pop into CRM or Admin panel without going into the Profile tab.
    const isAdmin = currentUser.role === 'owner'
        || currentUser.role === 'senior_admin'
        || currentUser.role === 'admin'
        || currentUser.isAdmin;
    const isSpecialist = currentUser.role === 'specialist' || isAdmin;

    // Credit-line traffic light: same logic as backend billing_defer.py — if
    // user is over the credit limit (> 100% utilisation) we show red, > 80%
    // amber. Surfaces here so users notice before they get blocked.
    const balance = currentUser.balance ?? 0;
    const credit = currentUser.creditLimit ?? 0;
    const debt = balance < 0 ? -balance : 0;
    let creditWarn: { tone: 'urgent' | 'warn'; text: string } | null = null;
    if (credit > 0 && debt > 0) {
        const ratio = debt / credit;
        if (ratio > 1.0) {
            creditWarn = { tone: 'urgent', text: `Долг ${debt.toFixed(0)} ₾ превысил кредитный лимит. Пополни баланс — следующая бронь может уйти на одобрение.` };
        } else if (ratio >= 0.8) {
            creditWarn = { tone: 'warn', text: `Использовано ${Math.round(ratio * 100)}% кредитного лимита (долг ${debt.toFixed(0)} ₾). Лучше пополнить заранее.` };
        }
    } else if (credit === 0 && debt > 0) {
        creditWarn = { tone: 'urgent', text: `Баланс минусовой (−${debt.toFixed(0)} ₾) и кредитного лимита нет. Пополни баланс перед следующей бронью.` };
    }

    const repeatBooking = (booking: BookingHistoryItem) => {
        if (prepareRepeat(booking)) navigate('/m/checkout');
    };

    return (
        <>
            <div style={{
                paddingTop: 8,
                // Bottom padding leaves room for sticky CTA above tab bar.
                paddingBottom: 'calc(120px + env(safe-area-inset-bottom, 0px))',
                display: 'flex', flexDirection: 'column', gap: 20,
            }}>
                <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />

                {/* Header */}
                <div style={{ ...sectionPad, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#666', fontWeight: 500 }}>
                            Привет, {currentUser.name?.split(' ')[0]}
                        </div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: '4px 0 0' }}>
                            Сегодня
                        </h1>
                    </div>
                    <NotificationsBell />
                </div>

                {/* Workspace shortcut row — quick jump into CRM / Admin without
                    going through Profile. Hidden for plain clients. */}
                {(isSpecialist || isAdmin) && (
                    <div style={sectionPad}>
                        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                            {isSpecialist && (
                                <button
                                    onClick={() => navigate('/m/crm')}
                                    style={workspaceChip}
                                >
                                    <Briefcase size={14} /> CRM
                                </button>
                            )}
                            {isAdmin && (
                                <button
                                    onClick={() => navigate('/m/admin')}
                                    style={workspaceChip}
                                >
                                    <ShieldCheck size={14} /> Админка
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Credit-line warning */}
                {creditWarn && (
                    <div style={sectionPad}>
                        <div style={{
                            background: creditWarn.tone === 'urgent' ? '#FEF2F2' : '#FEF3C7',
                            border: `1px solid ${creditWarn.tone === 'urgent' ? '#FCA5A5' : '#FCD34D'}`,
                            color: creditWarn.tone === 'urgent' ? '#991B1B' : '#8A5A00',
                            borderRadius: 12,
                            padding: '10px 12px',
                            display: 'flex',
                            gap: 10,
                            alignItems: 'flex-start',
                            fontSize: 13,
                            lineHeight: 1.4,
                        }}>
                            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                            <span>{creditWarn.text}</span>
                        </div>
                    </div>
                )}

                {/* Tasks-soon — compact card showing only tasks with deadline
                    within ~3 days (or overdue). Full board at /m/admin/tasks. */}
                {myTasks.length > 0 && (
                    <div style={sectionPad}>
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            marginBottom: 6,
                        }}>
                            <SectionTitle>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <CheckSquare size={11} /> Скоро · {myTasks.length}
                                </span>
                            </SectionTitle>
                            {isAdmin && (
                                <button
                                    onClick={() => navigate('/m/admin/tasks')}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: '#666',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        padding: 0,
                                    }}
                                >
                                    Все →
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {myTasks.slice(0, 3).map(t => {
                                const overdue = t.deadline && new Date(t.deadline).getTime() < Date.now();
                                return (
                                    <div key={t.id} style={{
                                        background: '#fff',
                                        border: `1px solid ${overdue ? '#FCA5A5' : 'rgba(0,0,0,0.06)'}`,
                                        borderRadius: 10,
                                        padding: '6px 10px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        minHeight: 36,
                                    }}>
                                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <div style={{
                                                fontSize: 12,
                                                fontWeight: 600,
                                                lineHeight: 1.25,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                flex: 1,
                                                minWidth: 0,
                                            }}>
                                                {t.priority === 'HIGH' && <span style={{ color: '#C8253A' }}>⚠ </span>}
                                                {t.title}
                                            </div>
                                            {t.deadline && (
                                                <span style={{
                                                    fontSize: 10,
                                                    color: overdue ? '#C8253A' : '#888',
                                                    fontWeight: overdue ? 700 : 500,
                                                    flexShrink: 0,
                                                }}>
                                                    {overdue
                                                        ? 'просрочена'
                                                        : new Date(t.deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => completeTask(t.id)}
                                            style={{
                                                background: '#0E0E0E',
                                                color: '#fff',
                                                border: 'none',
                                                borderRadius: 6,
                                                width: 22,
                                                height: 22,
                                                fontSize: 12,
                                                fontWeight: 700,
                                                cursor: 'pointer',
                                                fontFamily: 'inherit',
                                                flexShrink: 0,
                                                display: 'grid',
                                                placeItems: 'center',
                                            }}
                                            aria-label="Пометить выполненной"
                                        >
                                            ✓
                                        </button>
                                    </div>
                                );
                            })}
                            {myTasks.length > 3 && isAdmin && (
                                <button
                                    onClick={() => navigate('/m/admin/tasks')}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: '#666',
                                        fontSize: 11,
                                        cursor: 'pointer',
                                        padding: '2px 0',
                                        textAlign: 'center',
                                        fontFamily: 'inherit',
                                    }}
                                >
                                    Ещё {myTasks.length - 3} →
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Active session */}
                {active && (
                    <div style={sectionPad}>
                        <SectionTitle>Сейчас идёт</SectionTitle>
                        <ActiveCard booking={active.b} dt={active.dt!} onOpen={() => setOpenBooking(active.b)} />
                    </div>
                )}

                {/* Regular-slot CTA — Egor 2026-05-27. If the user has a
                    weekly pattern (e.g. Tue 17:00 Cabinet 5) and hasn't yet
                    booked the next occurrence, surface a 1-tap shortcut. */}
                {regularSlot && (
                    <div style={sectionPad}>
                        <button
                            onClick={() => repeatBooking(regularSlot.booking)}
                            style={{
                                width: '100%',
                                background: 'linear-gradient(135deg, #1B7430, #2B9447)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 14,
                                padding: '14px 16px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                textAlign: 'left',
                            }}
                        >
                            <div style={{
                                width: 38, height: 38, borderRadius: 10,
                                background: 'rgba(255,255,255,0.2)',
                                display: 'grid', placeItems: 'center',
                                flexShrink: 0, fontSize: 18,
                            }}>
                                🔁
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 600, marginBottom: 2 }}>
                                    Ваш постоянный слот · {regularSlot.count}× за 2 мес.
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>
                                    {(RESOURCES.find(r => r.id === regularSlot.booking.resourceId)?.name) || regularSlot.booking.resourceId}
                                    {' · '}
                                    {regularSlot.booking.startTime}
                                </div>
                                <div style={{ fontSize: 12, opacity: 0.95, marginTop: 2 }}>
                                    Забронировать на {regularSlot.nextDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })}
                                </div>
                            </div>
                            <ArrowRight size={18} />
                        </button>
                    </div>
                )}

                {/* Quick actions */}
                <div style={sectionPad}>
                    <SectionTitle>Быстро</SectionTitle>
                    <button
                        onClick={goToFind}
                        style={{
                            width: '100%',
                            background: '#0E0E0E',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 14,
                            padding: '18px 20px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            textAlign: 'left',
                            fontSize: 17,
                            fontWeight: 700,
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Plus size={20} />
                            Забронировать
                        </span>
                        <ArrowRight size={18} />
                    </button>

                    {lastFive.length > 0 && (
                        <div style={{
                            marginTop: 8,
                            background: '#F4F4F2',
                            borderRadius: 12,
                            overflow: 'hidden',
                        }}>
                            <button
                                onClick={() => setRepeatOpen(o => !o)}
                                style={{
                                    width: '100%',
                                    background: 'transparent',
                                    border: 'none',
                                    padding: '12px 14px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: '#0E0E0E',
                                }}
                            >
                                Повторить из последних
                                <ChevronDown
                                    size={16}
                                    style={{
                                        transition: 'transform 0.15s',
                                        transform: repeatOpen ? 'rotate(180deg)' : 'none',
                                        opacity: 0.6,
                                    }}
                                />
                            </button>
                            {repeatOpen && (
                                <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                                    {lastFive.map(({ b, dt }) => (
                                        <RepeatRow key={b.id} booking={b} dt={dt} onPick={() => repeatBooking(b)} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Admin contact — small Telegram-blue link, always visible
                    so users can ping support when something's off without
                    digging into the Profile tab. */}
                <div style={sectionPad}>
                    <a
                        href="https://t.me/UnboxCenter"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '12px 14px',
                            background: '#229ED9',
                            color: '#fff',
                            borderRadius: 12,
                            textDecoration: 'none',
                            fontFamily: 'inherit',
                            fontSize: 14,
                            fontWeight: 700,
                        }}
                    >
                        <MessageCircle size={16} />
                        <span style={{ flex: 1 }}>Связь с администратором</span>
                        <span style={{ fontSize: 12, opacity: 0.85 }}>↗</span>
                    </a>
                </div>

                {/* Upcoming */}
                <div style={sectionPad}>
                    <SectionTitle>Ближайшие</SectionTitle>
                    {upcoming.length === 0 ? (
                        <div style={{
                            background: '#F4F4F2',
                            borderRadius: 14,
                            padding: 18,
                            textAlign: 'center',
                            color: '#666',
                            fontSize: 14,
                        }}>
                            Ближайших сессий нет
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {upcoming.map(({ b, dt }) => (
                                <CompactRow key={b.id} booking={b} dt={dt!} onOpen={() => setOpenBooking(b)} />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Sticky CTA above tab bar */}
            <div style={{
                position: 'fixed',
                bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '100%',
                maxWidth: 480,
                padding: '8px 16px',
                background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, #fff 30%)',
                zIndex: 90,
                pointerEvents: 'none',
            }}>
                <button
                    onClick={goToFind}
                    style={{
                        pointerEvents: 'auto',
                        width: '100%',
                        background: '#fff',
                        color: '#0E0E0E',
                        border: '1px solid #0E0E0E',
                        borderRadius: 12,
                        padding: '14px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 15,
                        fontWeight: 700,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                    }}
                >
                    Найти свободный кабинет
                    <ArrowRight size={18} />
                </button>
            </div>

            {openBooking && (
                <BookingDetailSheet
                    booking={openBooking}
                    onClose={() => setOpenBooking(null)}
                />
            )}
        </>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#999',
            marginBottom: 8,
        }}>
            {children}
        </div>
    );
}

/** Big inverted card for the currently-running session. */
function ActiveCard({ booking, dt, onOpen }: { booking: BookingHistoryItem; dt: Date; onOpen: () => void }) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const location = LOCATIONS.find(l => l.id === resource?.locationId);
    const endStr = formatHHMM(new Date(dt.getTime() + (booking.duration ?? 60) * 60000));
    return (
        <button
            onClick={onOpen}
            style={{
                width: '100%',
                background: '#0E0E0E',
                color: '#fff',
                border: 'none',
                borderRadius: 14,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
            }}
        >
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Идёт сейчас
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={16} /> {booking.startTime}–{endStr}
            </div>
            <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, opacity: 0.85 }}>
                <MapPin size={14} /> {resource?.name ?? booking.resourceId}
                {location && <span style={{ opacity: 0.6 }}>· {location.name}</span>}
            </div>
        </button>
    );
}

/** Compact 2-line row for upcoming sessions. */
function CompactRow({ booking, dt, onOpen }: { booking: BookingHistoryItem; dt: Date; onOpen: () => void }) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const location = LOCATIONS.find(l => l.id === resource?.locationId);
    const dateStr = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const weekday = dt.toLocaleDateString('ru-RU', { weekday: 'short' }).toUpperCase().replace('.', '');

    return (
        <button
            onClick={onOpen}
            style={{
                width: '100%',
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                color: '#0E0E0E',
            }}
        >
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>
                {dateStr}, {weekday}, {booking.startTime}, {resource?.name ?? booking.resourceId}
                {booking.isReRentListed && (
                    <span style={{
                        marginLeft: 6,
                        background: '#FEF3C7', color: '#8A5A00',
                        fontSize: 10, fontWeight: 700,
                        padding: '2px 6px', borderRadius: 999,
                        verticalAlign: 'middle',
                    }}>на пересдаче</span>
                )}
            </div>
            <div style={{ fontSize: 12, color: '#666', lineHeight: 1.3 }}>
                {location?.address ?? '—'}
                {' · '}{priceLabel(booking)}
            </div>
        </button>
    );
}

/** Row inside the "Повторить из последних" dropdown. */
function RepeatRow({ booking, dt, onPick }: { booking: BookingHistoryItem; dt: Date; onPick: () => void }) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const weekday = dt.toLocaleDateString('ru-RU', { weekday: 'short' }).toUpperCase().replace('.', '');
    return (
        <button
            onClick={onPick}
            style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid rgba(0,0,0,0.04)',
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 13,
                color: '#0E0E0E',
                textAlign: 'left',
            }}
        >
            <div>
                <div style={{ fontWeight: 700 }}>
                    {weekday}, {booking.startTime}
                </div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                    {resource?.name ?? booking.resourceId} · {formatBookingDuration(booking.duration ?? 60)}
                </div>
            </div>
            <ArrowRight size={16} color="#999" />
        </button>
    );
}

function bookingStartDate(b: BookingHistoryItem): Date | null {
    try {
        const d = b.date instanceof Date ? b.date : new Date(b.date as any);
        if (isNaN(d.getTime()) || !b.startTime) return null;
        const [h, m] = b.startTime.split(':').map(Number);
        const out = new Date(d);
        out.setHours(h, m, 0, 0);
        return out;
    } catch {
        return null;
    }
}

function formatHHMM(d: Date) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

const workspaceChip: React.CSSProperties = {
    background: '#0E0E0E',
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '8px 14px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flex: '0 0 auto',
};
