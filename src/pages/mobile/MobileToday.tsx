import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Briefcase, Check, CheckSquare, ChevronDown, Gift, MapPin, MessageCircle, Plus, Repeat, ShieldCheck } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { RESOURCES } from '../../utils/data';
import { BookingDetailSheet } from './BookingDetailSheet';
import { usePullToRefresh } from './usePullToRefresh';
import { PullIndicator } from './PullIndicator';
import { LoadErrorCard, SkeletonRows, StaleBar } from './LoadStates';
import { prepareRepeat } from './repeatBooking';
import { priceTrail } from './priceLabel';
import { NotificationsBell } from './NotificationsBell';
import { adminTasksApi, type AdminTask } from '../../api/adminTasks';
import { bonusesApi } from '../../api/bonuses';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import { getRecurrence, withRecurrence, nextDeadline } from './admin/taskRecurrence';
import { toast } from 'sonner';
import type { BookingHistoryItem } from '../../store/types';
import { canBookCabinets, ADMIN_ROLES } from '../../utils/permissions';
import { useSpecialistApplicationStatus } from '../../hooks/useSpecialistApplication';
import { SpecialistGateCard } from '../../components/SpecialistGate';
import { COLOR, RADIUS, STATUS, TEXT } from '../../design/tokens';
import { formatDateLabel, formatDayMonth, formatGel, formatRelativeDay, formatStartsIn, formatWeekdayShort } from '../../utils/format';
import { fmtHours } from '../../utils/paymentPriority';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { ListGroup, ListIcon, ListRow } from '../../components/ui/ListRow';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { TelegramConnectCard, isTelegramLinked } from './TelegramConnectCard';
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
        // Задачи — только у сотрудников (клиент получал 403 на каждый заход, 10.10).
        if (!currentUser?.id || !ADMIN_ROLES.includes(currentUser.role || '')) return;
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
                paddingBottom: 24,
                display: 'flex', flexDirection: 'column', gap: 20,
            }}>
                <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />

                {/* Шапка: «Сегодня» и дата, справа колокольчик (09.11 фаза 3 — общая крупная шапка). */}
                <MobilePageHeader
                    variant="large"
                    title="Сегодня"
                    subtitle={formatDateLabel(now, { capitalize: true })}
                    action={<NotificationsBell />}
                />

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
                            illustration="chair"
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
                        <ListGroup
                            title={<>Дальше</>}
                            aside={
                                <button type="button" onClick={() => navigate('/m/bookings')} style={linkBtn}>
                                    Все брони
                                </button>
                            }
                        >
                            {nextRows.map(({ b, dt }) => (
                                <NextRow key={b.id} booking={b} dt={dt!} onOpen={() => setOpenBooking(b)} />
                            ))}
                        </ListGroup>
                    </div>
                )}

                {/* ── Ниже — спокойнее: предупреждения, привычный слот, задачи, связь. */}

                {/* Credit-line warning — статус, поэтому цветом. */}
                {creditWarn && (
                    <div style={sectionPad}>
                        <div role="status" style={{
                            background: creditWarn.tone === 'urgent' ? STATUS.danger.bg : STATUS.pending.bg,
                            color: creditWarn.tone === 'urgent' ? STATUS.danger.fg : STATUS.pending.fg,
                            borderRadius: RADIUS.sheet,
                            padding: '12px 16px',
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

                {/* Ревью №9 (09.11): пока бот не подключён — подтверждения, напоминания
                    и «пересдачу забрали» человек не получит. Скрывается на неделю. */}
                {canBook && !isTelegramLinked(currentUser) && (
                    <div style={sectionPad}>
                        <TelegramConnectCard user={currentUser} />
                    </div>
                )}

                {/* Regular-slot CTA — Egor 2026-05-27. If the user has a
                    weekly pattern (e.g. Tue 17:00 Cabinet 5) and hasn't yet
                    booked the next occurrence, surface a 1-tap shortcut. */}
                {canBook && regularSlot && (
                    <div style={sectionPad}>
                        <ListGroup aria-label="Постоянный слот">
                            <ListRow
                                onClick={() => repeatBooking(regularSlot.booking)}
                                lead={<ListIcon><Repeat size={20} /></ListIcon>}
                                title={<>
                                    Ваш постоянный слот: {(RESOURCES.find(r => r.id === regularSlot.booking.resourceId)?.name) || regularSlot.booking.resourceId}
                                    {' · '}
                                    <span className="num">{regularSlot.booking.startTime}</span>
                                </>}
                                subtitle={`Забронировать на ${formatDateLabel(regularSlot.nextDate)} · ${regularSlot.count}× за 2 мес.`}
                            />
                        </ListGroup>
                    </div>
                )}

                {/* Повторить из последних — свёрнуто. */}
                {canBook && lastFive.length > 0 && (
                    <div style={sectionPad}>
                        <ListGroup aria-label="Повторить из последних">
                            <ListRow
                                onClick={() => setRepeatOpen(o => !o)}
                                lead={<ListIcon><Repeat size={20} /></ListIcon>}
                                title="Повторить из последних"
                                chevron={false}
                                trail={
                                    <ChevronDown
                                        size={18}
                                        aria-hidden="true"
                                        color={COLOR.ink60}
                                        style={{ transition: 'transform 0.15s', transform: repeatOpen ? 'rotate(180deg)' : 'none' }}
                                    />
                                }
                                aria-label={repeatOpen ? 'Свернуть: повторить из последних' : 'Показать: повторить из последних'}
                            />
                            {repeatOpen && lastFive.map(({ b, dt }) => (
                                <RepeatRow key={b.id} booking={b} dt={dt} onPick={() => repeatBooking(b)} />
                            ))}
                        </ListGroup>
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
                        <ListGroup aria-label="Задачи на днях">
                            {myTasks.slice(0, 3).map(t => {
                                const overdue = !!t.deadline && new Date(t.deadline).getTime() < Date.now();
                                return (
                                    <ListRow
                                        key={t.id}
                                        tone={overdue ? 'danger' : undefined}
                                        title={<>
                                            {t.priority === 'HIGH' && (
                                                <AlertTriangle size={14} aria-label="Важно" style={{ display: 'inline-block', color: STATUS.danger.fg, verticalAlign: '-2px', marginRight: 4 }} />
                                            )}
                                            {t.title}
                                        </>}
                                        subtitle={t.deadline
                                            ? (overdue
                                                ? <span style={{ color: STATUS.danger.fg, fontWeight: 600 }}>просрочена</span>
                                                : `до ${formatDayMonth(t.deadline)}`)
                                            : undefined}
                                        action={
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                icon={<Check size={18} strokeWidth={2.5} aria-hidden="true" />}
                                                onClick={() => completeTask(t.id)}
                                                aria-label="Пометить выполненной"
                                            />
                                        }
                                    />
                                );
                            })}
                        </ListGroup>
                        {myTasks.length > 3 && isAdmin && (
                            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
                                <button type="button" onClick={() => navigate('/m/admin/tasks')} style={{ ...linkBtn, margin: 0 }}>
                                    Ещё {myTasks.length - 3}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Рабочие места и связь с администратором — одна тихая группа строк
                    внизу (09.11 фаза 3: было — кнопка «CRM» в рамке и отдельная карточка). */}
                <div style={sectionPad}>
                    <ListGroup aria-label="Ещё">
                        {showCrm && (
                            <ListRow
                                onClick={() => navigate('/m/crm')}
                                lead={<ListIcon><Briefcase size={20} /></ListIcon>}
                                title="Psy-CRM"
                                subtitle="Клиенты, сессии, заметки"
                            />
                        )}
                        {isAdmin && (
                            <ListRow
                                onClick={() => navigate('/m/admin')}
                                lead={<ListIcon><ShieldCheck size={20} /></ListIcon>}
                                title="Админка"
                            />
                        )}
                        <ListRow
                            href="https://t.me/UnboxCenter"
                            target="_blank"
                            lead={<ListIcon><MessageCircle size={20} /></ListIcon>}
                            title="Написать администратору"
                        />
                    </ListGroup>
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
    const soft = `${COLOR.onPanel}B3`;   // 70 % — вторичный текст на тёмном (≈11:1)
    const line = `${COLOR.onPanel}26`;
    return (
        <section
            aria-label="Ближайшая встреча"
            style={{
                background: COLOR.panel,
                color: COLOR.onPanel,
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
                fontSize: TEXT.small, color: COLOR.onPanel,
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
                            border: `1px solid ${COLOR.onPanel}4D`, color: COLOR.onPanel, textDecoration: 'none',
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
                        border: 'none', background: COLOR.onPanel, color: COLOR.panel,
                        fontFamily: 'inherit', fontSize: TEXT.body, fontWeight: 600, cursor: 'pointer',
                    }}
                >
                    Детали
                </button>
            </div>
        </section>
    );
}

/** Строка «Дальше»: «Завтра · 09:00–10:00», ниже кабинет · центр, справа всегда
 *  одно и то же — сумма или «Абонемент»; бейдж — только «ждёт одобрения» /
 *  «на пересдаче» (09.11 фаза 3: «Оплачено» у каждой строки — шум). */
function NextRow({ booking, dt, onOpen }: { booking: BookingHistoryItem; dt: Date; onOpen: () => void }) {
    const place = bookingPlace(booking);
    const price = priceTrail(booking);
    const badge = booking.status === 'pending_approval'
        ? <StatusBadge kind="booking" status="pending_approval" />
        : booking.isReRentListed
            ? <StatusBadge kind="booking" status="re-rent-listed" />
            : null;
    return (
        <ListRow
            onClick={onOpen}
            title={<>{formatRelativeDay(dt, { capitalize: true })} · <span className="num" style={{ whiteSpace: 'nowrap' }}>{bookingTimeRange(booking, dt)}</span></>}
            subtitle={place.title}
            meta={badge ?? undefined}
            trail={<span className="num">{price.main}</span>}
            trailSub={price.sub ? <span className="num">{price.sub}</span> : undefined}
        />
    );
}

/** Row inside the "Повторить из последних" dropdown. */
function RepeatRow({ booking, dt, onPick }: { booking: BookingHistoryItem; dt: Date; onPick: () => void }) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    return (
        <ListRow
            onClick={onPick}
            lead={<ListIcon>{null}</ListIcon>}
            title={<>{formatWeekdayShort(dt)}, <span className="num">{booking.startTime}</span></>}
            subtitle={`${resource?.name ?? booking.resourceId} · ${formatBookingDuration(booking.duration ?? 60)}`}
        />
    );
}

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
