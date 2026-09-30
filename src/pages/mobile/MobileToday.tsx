import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ArrowUpRight, Briefcase, Check, CheckSquare, ChevronDown, ChevronRight, Gift, MapPin, MessageCircle, Plus, Repeat, ShieldCheck } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { RESOURCES } from '../../utils/data';
import { BookingDetailSheet } from './BookingDetailSheet';
import { usePullToRefresh } from './usePullToRefresh';
import { PullIndicator } from './PullIndicator';
import { LoadErrorCard, SkeletonRows, StaleBar } from './LoadStates';
import { prepareRepeat } from './repeatBooking';
import { priceLabel } from './priceLabel';
import { NotificationsBell } from './NotificationsBell';
import { adminTasksApi, type AdminTask } from '../../api/adminTasks';
import { bonusesApi } from '../../api/bonuses';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import { getRecurrence, withRecurrence, nextDeadline } from './admin/taskRecurrence';
import { toast } from 'sonner';
import type { BookingHistoryItem } from '../../store/types';
import { canBookCabinets } from '../../utils/permissions';
import { useSpecialistApplicationStatus } from '../../hooks/useSpecialistApplication';
import { SpecialistGateCard } from '../../components/SpecialistGate';
import { COLOR, RADIUS, STATUS, TEXT } from '../../design/tokens';
import { formatDateLabel, formatDayMonth, formatGel, formatRelativeDay, formatStartsIn, formatWeekdayShort } from '../../utils/format';
import { fmtHours } from '../../utils/paymentPriority';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { canUsePsyCrm } from './crmAccess';
import {
    bookingEndDate, bookingPlace, bookingStartDate, bookingTimeRange, isLiveBooking, mapsUrl, paymentLine,
} from './bookingView';

const sectionPad: React.CSSProperties = { padding: '0 16px' };

/**
 * /m/today — «Сегодня», вариант V1 «Карточка встречи» (решение владельца 30.09).
 *
 * Сверху — тёмная карточка ближайшей встречи (в том числе брони, которая
 * ждёт одобрения администратора): относительный день и «через 3 ч», время,
 * кабинет и адрес, строка оплаты, «Маршрут» и «Детали». Ниже одна главная
 * кнопка «Забронировать кабинет», затем «Дальше» — три следующие брони.
 * Остальное (анкета, кредит, постоянный слот, задачи, связь с админом) —
 * ниже и спокойнее. Закреплённая внизу кнопка поиска убрана: она
 * дублировала кнопку и вкладку «Свободно» (X2-17).
 */
export function MobileToday() {
    const navigate = useNavigate();
    // Селективные селекторы вместо whole-store: ре-рендер только при
    // изменении именно этих полей, а не любого поля стора (баланс, users…).
    // Это убирает основной стуттер при скролле/обновлении данных.
    const currentUser = useUserStore(s => s.currentUser);
    const bookings = useUserStore(s => s.bookings);
    const fetchBookings = useUserStore(s => s.fetchBookings);
    const bookingsStatus = useUserStore(s => s.bookingsStatus);
    const bookingsLoadedAt = useUserStore(s => s.bookingsLoadedAt);
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
            toast.success('Готово');
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

    // Свои брони. Волна 2 (G3-02): вместе с подтверждёнными — и те, что ждут
    // одобрения администратора, иначе «горячая» бронь пропадала с главной.
    const myBookings = useMemo(() => {
        if (!currentUser) return [];
        return bookings.filter(b =>
            (b.userId === currentUser.email || (!!currentUser.id && (b as any).userUuid === currentUser.id))
            && isLiveBooking(b)
        );
    }, [bookings, currentUser]);

    const now = new Date();
    const sortedFuture = useMemo(() => {
        return myBookings
            .map(b => ({ b, dt: bookingStartDate(b) }))
            .filter(x => x.dt && x.dt.getTime() + (x.b.duration ?? 60) * 60000 > now.getTime())
            .sort((a, b) => (a.dt!.getTime() - b.dt!.getTime()));
    }, [myBookings, now]);

    // Карточка встречи — идущая сейчас или ближайшая; «Дальше» — три следующие.
    const hero = sortedFuture[0] ?? null;
    const nextRows = sortedFuture.slice(1, 4);

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

    // G4-12: новичку без броней — про приветственный час, но только если он
    // правда есть; дата «до …» — из самого бонуса.
    const nothingBooked = bookingsLoadedAt != null && sortedFuture.length === 0;
    const [welcome, setWelcome] = useState<{ hours: number; until?: string } | null>(null);
    useEffect(() => {
        if (!nothingBooked || !currentUser?.id) return;
        let cancelled = false;
        bonusesApi.getMyBonuses()
            .then(list => {
                const active = list
                    .filter(b => b.status === 'active' && (b.type === 'free_hour' || b.type === 'freeHour'))
                    .filter(b => !(b.expiresAt && new Date(b.expiresAt).getTime() < Date.now()))
                    .sort((a, b) => (a.expiresAt ?? '9').localeCompare(b.expiresAt ?? '9'));
                const hours = active.reduce((s, b) => s + (b.quantity || 0), 0);
                if (!cancelled) setWelcome(hours > 0 ? { hours, until: active[0]?.expiresAt } : null);
            })
            .catch(() => { if (!cancelled) setWelcome(null); });
        return () => { cancelled = true; };
    }, [nothingBooked, currentUser?.id]);

    // Бронировать сервер даёт только специалистам и админам. Новичку (роль
    // user) вместо кнопок брони — карточка с анкетой: раньше он проходил весь
    // мастер и получал отказ на последней кнопке.
    const canBook = canBookCabinets(currentUser);
    const applicationStatus = useSpecialistApplicationStatus(currentUser, !!currentUser && !canBook);

    if (!currentUser) return null;

    const goToFind = () => navigate('/m/find');

    // Вход в рабочие места. CRM — по правилу сервера (X2-ia-navigation-M3):
    // обычный админ без права psy_crm.access кнопку «CRM» больше не видит.
    const isAdmin = currentUser.role === 'owner'
        || currentUser.role === 'senior_admin'
        || currentUser.role === 'admin'
        || currentUser.isAdmin;
    const showCrm = canUsePsyCrm(currentUser);

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
            creditWarn = { tone: 'urgent', text: `Долг ${formatGel(debt, { fraction: 0 })} превысил кредитный лимит. Пополните баланс — иначе следующая бронь уйдёт на одобрение.` };
        } else if (ratio >= 0.8) {
            creditWarn = { tone: 'warn', text: `Использовано ${Math.round(ratio * 100)}% кредитного лимита (долг ${formatGel(debt, { fraction: 0 })}). Лучше пополнить заранее.` };
        }
    } else if (credit === 0 && debt > 0) {
        creditWarn = { tone: 'urgent', text: `Баланс в минусе (${formatGel(-debt, { fraction: 0 })}), кредитного лимита нет. Пополните баланс перед следующей бронью.` };
    }

    const repeatBooking = (booking: BookingHistoryItem) => {
        if (prepareRepeat(booking)) navigate('/m/checkout');
    };

    const loading = bookingsLoadedAt == null && bookingsStatus !== 'error';
    const failed = bookingsLoadedAt == null && bookingsStatus === 'error';

    return (
        <>
            <div style={{
                paddingTop: 16,
                paddingBottom: 24,
                display: 'flex', flexDirection: 'column', gap: 20,
            }}>
                <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />

                {/* Шапка: «Сегодня» и дата, справа колокольчик. */}
                <div style={{ ...sectionPad, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h1 style={{ fontSize: TEXT.heading, fontWeight: 600, lineHeight: 1.2, margin: 0 }}>
                            Сегодня
                        </h1>
                        <div style={{ fontSize: TEXT.small, color: COLOR.ink60, marginTop: 4 }}>
                            {formatDateLabel(now, { capitalize: true })}
                        </div>
                    </div>
                    <NotificationsBell />
                </div>

                {/* Ещё не специалист — сначала анкета (или её статус). */}
                {!canBook && (
                    <div style={sectionPad}>
                        <SpecialistGateCard variant="mobile" status={applicationStatus} />
                    </div>
                )}

                {/* Ближайшая встреча. Пока брони грузятся — заглушка, при
                    сбое — ошибка с «Повторить» (раньше в обоих случаях писали
                    «нет», и клиент думал, что бронь слетела). */}
                <div style={sectionPad}>
                    <StaleBar status={bookingsStatus} loadedAt={bookingsLoadedAt} onRetry={() => { fetchBookings(); }} />
                    {bookingsLoadedAt == null && bookingsStatus !== 'error' ? (
                        <SkeletonRows count={1} height={236} />
                    ) : bookingsLoadedAt == null ? (
                        <LoadErrorCard
                            title="Не удалось загрузить брони"
                            text="Они никуда не делись — просто сейчас не загрузились."
                            onRetry={() => { fetchBookings(); }}
                        />
                    ) : hero ? (
                        <NextMeetingCard booking={hero.b} dt={hero.dt!} onDetails={() => setOpenBooking(hero.b)} />
                    ) : (
                        <EmptyState
                            compact
                            title="Пока ничего не забронировано"
                            hint={welcome
                                ? `У вас ${fmtHours(welcome.hours)} бесплатно${welcome.until ? ` — до ${formatDayMonth(welcome.until)}` : ''}. Хороший повод для первой брони.`
                                : canBook ? 'Свободное время — на вкладке «Свободно».' : undefined}
                        />
                    )}
                </div>

                {/* Одна главная кнопка — только тем, кому бронь откроется (иначе 403 в конце). */}
                {canBook && (
                    <div style={sectionPad}>
                        <Button block size="touch" icon={<Plus size={20} aria-hidden="true" />} onClick={goToFind} style={{ minHeight: 52 }}>
                            Забронировать кабинет
                        </Button>
                    </div>
                )}

                {/* «Дальше» — три следующие брони строками. */}
                {!loading && !failed && nextRows.length > 0 && (
                    <div style={sectionPad}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <SectionTitle>Дальше</SectionTitle>
                            <button type="button" onClick={() => navigate('/m/bookings')} style={linkBtn}>
                                Все брони
                            </button>
                        </div>
                        <div style={{ background: COLOR.card, border: `1px solid ${COLOR.ink10}`, borderRadius: RADIUS.sheet, overflow: 'hidden' }}>
                            {nextRows.map(({ b, dt }, i) => (
                                <NextRow key={b.id} booking={b} dt={dt!} first={i === 0} onOpen={() => setOpenBooking(b)} />
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Ниже — спокойнее: предупреждения, привычный слот, задачи, связь. */}

                {/* Credit-line warning — статус, поэтому цветом. */}
                {creditWarn && (
                    <div style={sectionPad}>
                        <div role="status" style={{
                            background: creditWarn.tone === 'urgent' ? STATUS.danger.bg : STATUS.pending.bg,
                            color: creditWarn.tone === 'urgent' ? STATUS.danger.fg : STATUS.pending.fg,
                            borderRadius: 12,
                            padding: '12px 14px',
                            display: 'flex',
                            gap: 10,
                            alignItems: 'flex-start',
                            fontSize: TEXT.small,
                            lineHeight: 1.45,
                        }}>
                            <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                            <span>{creditWarn.text}</span>
                        </div>
                    </div>
                )}

                {/* Regular-slot CTA — Egor 2026-05-27. If the user has a
                    weekly pattern (e.g. Tue 17:00 Cabinet 5) and hasn't yet
                    booked the next occurrence, surface a 1-tap shortcut. */}
                {canBook && regularSlot && (
                    <div style={sectionPad}>
                        <button
                            onClick={() => repeatBooking(regularSlot.booking)}
                            className="press"
                            style={quietCard}
                        >
                            <Repeat size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: TEXT.small, fontWeight: 600, lineHeight: 1.3 }}>
                                    Ваш постоянный слот: {(RESOURCES.find(r => r.id === regularSlot.booking.resourceId)?.name) || regularSlot.booking.resourceId}
                                    {' · '}
                                    <span className="num">{regularSlot.booking.startTime}</span>
                                </div>
                                <div style={{ fontSize: TEXT.caption, color: COLOR.ink60, marginTop: 2 }}>
                                    Забронировать на {formatDateLabel(regularSlot.nextDate)} · {regularSlot.count}× за 2 мес.
                                </div>
                            </div>
                            <ChevronRight size={18} color={COLOR.ink60} aria-hidden="true" />
                        </button>
                    </div>
                )}

                {/* Повторить из последних — свёрнуто. */}
                {canBook && lastFive.length > 0 && (
                    <div style={sectionPad}>
                        <div style={{ background: COLOR.card, border: `1px solid ${COLOR.ink10}`, borderRadius: RADIUS.sheet, overflow: 'hidden' }}>
                            <button
                                onClick={() => setRepeatOpen(o => !o)}
                                aria-expanded={repeatOpen}
                                style={{
                                    width: '100%',
                                    background: 'transparent',
                                    border: 'none',
                                    minHeight: 48,
                                    padding: '0 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    fontSize: TEXT.small,
                                    fontWeight: 600,
                                    color: COLOR.ink,
                                }}
                            >
                                Повторить из последних
                                <ChevronDown
                                    size={16}
                                    aria-hidden="true"
                                    color={COLOR.ink60}
                                    style={{
                                        transition: 'transform 0.15s',
                                        transform: repeatOpen ? 'rotate(180deg)' : 'none',
                                    }}
                                />
                            </button>
                            {repeatOpen && lastFive.map(({ b, dt }) => (
                                <RepeatRow key={b.id} booking={b} dt={dt} onPick={() => repeatBooking(b)} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Tasks-soon — compact card showing only tasks with deadline
                    within ~3 days (or overdue). Full board at /m/admin/tasks. */}
                {myTasks.length > 0 && (
                    <div style={sectionPad}>
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            marginBottom: 8,
                        }}>
                            <SectionTitle>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <CheckSquare size={14} aria-hidden="true" /> Задачи на днях · {myTasks.length}
                                </span>
                            </SectionTitle>
                            {isAdmin && (
                                <button type="button" onClick={() => navigate('/m/admin/tasks')} style={linkBtn}>
                                    Все задачи
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {myTasks.slice(0, 3).map(t => {
                                const overdue = t.deadline && new Date(t.deadline).getTime() < Date.now();
                                return (
                                    <div key={t.id} style={{
                                        background: COLOR.card,
                                        border: `1px solid ${overdue ? `${STATUS.danger.fg}4D` : COLOR.ink08}`,
                                        borderRadius: 10,
                                        padding: '6px 10px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        minHeight: 36,
                                    }}>
                                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <div style={{
                                                fontSize: TEXT.small,
                                                fontWeight: 600,
                                                lineHeight: 1.25,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                flex: 1,
                                                minWidth: 0,
                                            }}>
                                                {t.priority === 'HIGH' && (
                                                    <AlertTriangle size={12} aria-label="Важно" style={{ color: STATUS.danger.fg, verticalAlign: '-1px', marginRight: 4 }} />
                                                )}
                                                {t.title}
                                            </div>
                                            {t.deadline && (
                                                <span style={{
                                                    fontSize: TEXT.caption,
                                                    color: overdue ? STATUS.danger.fg : COLOR.ink60,
                                                    fontWeight: overdue ? 600 : 500,
                                                    flexShrink: 0,
                                                }}>
                                                    {overdue
                                                        ? 'просрочена'
                                                        : formatDayMonth(t.deadline)}
                                                </span>
                                            )}
                                        </div>
                                        {/* Кнопка 44×44 (цель касания), видимый квадрат — 24. */}
                                        <button
                                            onClick={() => completeTask(t.id)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                width: 44,
                                                height: 44,
                                                margin: '-10px -10px -10px 0',
                                                padding: 0,
                                                cursor: 'pointer',
                                                flexShrink: 0,
                                                display: 'grid',
                                                placeItems: 'center',
                                            }}
                                            aria-label="Пометить выполненной"
                                        >
                                            <span style={{
                                                background: COLOR.ink,
                                                color: COLOR.onInk,
                                                borderRadius: 6,
                                                width: 24,
                                                height: 24,
                                                display: 'grid',
                                                placeItems: 'center',
                                            }}>
                                                <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                            {myTasks.length > 3 && isAdmin && (
                                <button type="button" onClick={() => navigate('/m/admin/tasks')} style={{ ...linkBtn, alignSelf: 'center' }}>
                                    Ещё {myTasks.length - 3}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Рабочие места — тихие кнопки внизу, не над встречей. */}
                {(showCrm || isAdmin) && (
                    <div style={{ ...sectionPad, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {showCrm && (
                            <Button variant="secondary" icon={<Briefcase size={16} aria-hidden="true" />} onClick={() => navigate('/m/crm')}>
                                CRM
                            </Button>
                        )}
                        {isAdmin && (
                            <Button variant="secondary" icon={<ShieldCheck size={16} aria-hidden="true" />} onClick={() => navigate('/m/admin')}>
                                Админка
                            </Button>
                        )}
                    </div>
                )}

                {/* Связь с администратором — тихая строка. */}
                <div style={sectionPad}>
                    <a
                        href="https://t.me/UnboxCenter"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="press"
                        style={{ ...quietCard, textDecoration: 'none' }}
                    >
                        <MessageCircle size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: TEXT.small, fontWeight: 600 }}>Написать администратору</span>
                        <ArrowUpRight size={16} color={COLOR.ink60} aria-hidden="true" />
                    </a>
                </div>
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
        <h2 style={{
            fontSize: TEXT.caption,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: COLOR.ink60,
            margin: 0,
        }}>
            {children}
        </h2>
    );
}

/** Тёмная карточка ближайшей встречи (макет V1). */
function NextMeetingCard({ booking, dt, onDetails }: { booking: BookingHistoryItem; dt: Date; onDetails: () => void }) {
    const place = bookingPlace(booking);
    const end = bookingEndDate(booking, dt);
    const route = mapsUrl(place.location);
    const soft = `${COLOR.onInk}B3`;   // 70 % — вторичный текст на тёмном (≈11:1)
    const line = `${COLOR.onInk}26`;
    return (
        <section
            aria-label="Ближайшая встреча"
            style={{
                background: COLOR.ink,
                color: COLOR.onInk,
                borderRadius: RADIUS.sheet,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
            }}
        >
            <div style={{ fontSize: TEXT.caption, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: soft }}>
                {formatRelativeDay(dt)} · {formatStartsIn(dt, { end })}
            </div>
            <div className="num" style={{ fontSize: TEXT.heading, fontWeight: 600, lineHeight: 1 }}>
                {bookingTimeRange(booking, dt)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: TEXT.body, fontWeight: 600 }}>{place.title}</div>
                {place.address && <div style={{ fontSize: TEXT.small, color: soft }}>{place.address}</div>}
            </div>
            <div style={{
                borderTop: `1px solid ${line}`, paddingTop: 12,
                fontSize: TEXT.small, color: COLOR.onInk,
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
                <span>{paymentLine(booking, dt)}</span>
                {booking.isReRentListed && <StatusBadge kind="booking" status="re-rent-listed" />}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                {route && (
                    <a
                        href={route}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="press"
                        style={{
                            flex: 1, minHeight: 44, borderRadius: RADIUS.control,
                            border: `1px solid ${COLOR.onInk}4D`, color: COLOR.onInk, textDecoration: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            fontSize: TEXT.body, fontWeight: 600,
                        }}
                    >
                        <MapPin size={18} aria-hidden="true" /> Маршрут
                    </a>
                )}
                <button
                    type="button"
                    onClick={onDetails}
                    className="press"
                    style={{
                        flex: 1, minHeight: 44, borderRadius: RADIUS.control,
                        border: 'none', background: COLOR.onInk, color: COLOR.ink,
                        fontFamily: 'inherit', fontSize: TEXT.body, fontWeight: 600, cursor: 'pointer',
                    }}
                >
                    Детали
                </button>
            </div>
        </section>
    );
}

/** Строка «Дальше»: «Завтра · 09:00–10:00», ниже кабинет · центр, справа статус или сумма. */
function NextRow({ booking, dt, first, onOpen }: { booking: BookingHistoryItem; dt: Date; first: boolean; onOpen: () => void }) {
    const place = bookingPlace(booking);
    const right = booking.status === 'pending_approval'
        ? <StatusBadge kind="booking" status="pending_approval" />
        : booking.isReRentListed
            ? <StatusBadge kind="booking" status="re-rent-listed" />
            : booking.paymentStatus === 'paid'
                ? <StatusBadge kind="payment" status="paid" />
                : <span className="num" style={{ fontSize: TEXT.small, fontWeight: 600, whiteSpace: 'nowrap' }}>{priceLabel(booking)}</span>;
    return (
        <button
            type="button"
            onClick={onOpen}
            className="press"
            style={{
                width: '100%', minHeight: 64,
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px',
                background: 'transparent', border: 'none',
                borderTop: first ? 'none' : `1px solid ${COLOR.ink10}`,
                fontFamily: 'inherit', textAlign: 'left', color: COLOR.ink, cursor: 'pointer',
            }}
        >
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: TEXT.body, fontWeight: 600 }}>
                    {formatRelativeDay(dt, { capitalize: true })} · <span className="num">{bookingTimeRange(booking, dt)}</span>
                </span>
                <span style={{ display: 'block', fontSize: TEXT.small, color: COLOR.ink60 }}>{place.title}</span>
            </span>
            {right}
        </button>
    );
}

/** Row inside the "Повторить из последних" dropdown. */
function RepeatRow({ booking, dt, onPick }: { booking: BookingHistoryItem; dt: Date; onPick: () => void }) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    return (
        <button
            onClick={onPick}
            style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderTop: `1px solid ${COLOR.ink10}`,
                minHeight: 56,
                padding: '8px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: COLOR.ink,
                textAlign: 'left',
            }}
        >
            <div>
                <div style={{ fontSize: TEXT.small, fontWeight: 600 }}>
                    {formatWeekdayShort(dt)}, <span className="num">{booking.startTime}</span>
                </div>
                <div style={{ fontSize: TEXT.caption, color: COLOR.ink60, marginTop: 2 }}>
                    {resource?.name ?? booking.resourceId} · {formatBookingDuration(booking.duration ?? 60)}
                </div>
            </div>
            <ArrowRight size={16} color={COLOR.ink60} aria-hidden="true" />
        </button>
    );
}

const quietCard: React.CSSProperties = {
    width: '100%',
    minHeight: 48,
    background: COLOR.card,
    color: COLOR.ink,
    border: `1px solid ${COLOR.ink10}`,
    borderRadius: RADIUS.sheet,
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
};

const linkBtn: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: COLOR.accentInk,
    fontSize: TEXT.small,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    // Цель касания 44 px; отрицательный отступ — чтобы строка не выросла.
    minHeight: 44,
    padding: '0 8px',
    margin: '-12px -8px',
};
