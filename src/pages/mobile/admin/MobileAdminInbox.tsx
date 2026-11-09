import { useEffect, useState } from 'react';
import { Check, Clock, MapPin, X, Inbox, UserCheck, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { bookingsApi } from '../../../api/bookings';
import { specialistsApi, type SpecialistProfile } from '../../../api/specialists';
import { ADMIN_REQUESTS_CHANGED } from './sheetLayers';
import { useUserStore } from '../../../store/userStore';
import { RESOURCES } from '../../../utils/data';
import { formatBookingDuration } from '../../../utils/bookingHelpers';
import type { BookingHistoryItem } from '../../../store/types';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Field, TextArea } from '../../../components/ui/Field';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { formatDateLabel, formatGel } from '../../../utils/format';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { statusLabel } from '../../../design/statuses';
import { bookingDayKey } from '../../../utils/adminToday';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { Money } from '../../../components/ui/Money';

/** «через 9 ч» / «через 40 мин» / «уже началась» — время до начала (день и время — Тбилиси). */
function startsIn(b: BookingHistoryItem): string | null {
    const day = bookingDayKey(b.date as any);
    const m = /^(\d{1,2}):(\d{2})/.exec(b.startTime || '');
    if (!day || !m) return null;
    const [y, mo, d] = day.split('-').map(Number);
    const min = Math.round((Date.UTC(y, mo - 1, d, Number(m[1]) - 4, Number(m[2])) - Date.now()) / 60_000);
    if (min <= 0) return 'уже началась';
    if (min < 60) return `через ${min} мин`;
    const h = Math.round(min / 60);
    return h < 48 ? `через ${h} ч` : `через ${Math.round(h / 24)} дн.`;
}

/** Формат брони по-русски (с сервера приходит код: individual / group …). */
const FORMAT_LABEL: Record<string, string> = {
    individual: 'индивидуальная',
    group: 'групповая',
    intervision: 'интервизия',
};

/**
 * Mobile admin inbox — hot-booking approvals.
 *
 * Each row is one pending request: who, when, where. Action buttons:
 *   - Одобрить → bookingsApi.approveBooking
 *   - Отклонить → opens reason input → bookingsApi.rejectBooking
 *
 * Optimistic local-state update keeps the list snappy; on error we re-fetch.
 *
 * Wave 1: ошибка загрузки больше не рисует «Все заявки разобраны»; карточка
 * ожидания — янтарная («ждём»), а не красная; шторка причины — общий Sheet.
 */
export function MobileAdminInbox() {
    const { users, fetchUsers } = useUserStore();
    const [items, setItems] = useState<BookingHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [rejecting, setRejecting] = useState<BookingHistoryItem | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const { confirm } = useConfirmDialog();

    // Волна 4 (G9-admin-mobile-M2): анкеты специалистов на проверке — здесь
    // же, а не только внутри «Специалистов».
    const [specPending, setSpecPending] = useState<SpecialistProfile[]>([]);
    useEffect(() => {
        specialistsApi.adminList()
            .then(list => setSpecPending(list.filter(s => s.applicationStatus === 'pending')))
            .catch(() => setSpecPending([]));
    }, []);

    const reload = () => {
        setLoading(true);
        bookingsApi.getPendingApprovals()
            .then(list => { setItems(list); setFailed(false); })
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        reload();
        if (!users || users.length === 0) fetchUsers().catch(() => {});
    }, []);

    const userByEmail = (email?: string) => users?.find(u => u.email === email);

    const approve = async (b: BookingHistoryItem) => {
        // Ревью 09.11 (№21): «Одобрить» спрашивает подтверждение — вернуть одобренную
        // бронь в «ждёт» сервер не умеет, поэтому «Вернуть» после нажатия не предлагаем.
        const who = userByEmail(b.userId)?.name || b.userId;
        const ok = await confirm({
            title: 'Одобрить бронь?',
            body: `${who}: ${b.date ? formatDateLabel(b.date as any) : ''}, ${b.startTime}. Отменить одобрение потом можно только отменой брони.`,
            confirmLabel: 'Одобрить',
            cancelLabel: 'Не сейчас',
        });
        if (!ok) return;
        setBusy(b.id);
        try {
            const res = await bookingsApi.approveBooking(b.id);
            setItems(prev => prev.filter(x => x.id !== b.id));
            window.dispatchEvent(new Event(ADMIN_REQUESTS_CHANGED));
            toast.success(res.approvalNote || 'Бронь одобрена');
        } catch {
            toast.error('Не удалось одобрить бронь. Попробуйте ещё раз');
            reload();
        } finally { setBusy(null); }
    };

    const submitReject = async () => {
        if (!rejecting) return;
        const reason = rejectReason.trim();
        if (!reason) {
            toast.error('Укажите причину отказа — её увидит специалист');
            return;
        }
        setBusy(rejecting.id);
        try {
            await bookingsApi.rejectBooking(rejecting.id, reason);
            setItems(prev => prev.filter(x => x.id !== rejecting.id));
            window.dispatchEvent(new Event(ADMIN_REQUESTS_CHANGED));
            toast.success('Бронь отклонена');
            setRejecting(null);
            setRejectReason('');
        } catch {
            toast.error('Не удалось отклонить бронь. Попробуйте ещё раз');
            reload();
        } finally { setBusy(null); }
    };

    return (
        <>
            <div style={{ paddingTop: 8, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 09.11 фаза 3: общая крупная шапка раздела. */}
                <MobilePageHeader
                    variant="large"
                    className="pb-0"
                    title="Заявки"
                    subtitle={<>
                        Срочные брони и анкеты специалистов, которые ждут вашего решения.
                        Число на вкладке «Заявки» — сколько их; колокольчик наверху — это уведомления, он считает другое.
                    </>}
                />

                {specPending.length > 0 && (
                    <div style={{ padding: '0 16px' }}>
                        <Link
                            to="/m/admin/specialists?filter=pending"
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12, minHeight: 48,
                                background: 'var(--status-pending-bg)', color: 'var(--status-pending-fg)',
                                borderRadius: 16, padding: '12px 16px', textDecoration: 'none',
                            }}
                        >
                            <UserCheck size={20} aria-hidden="true" />
                            <span style={{ flex: 1 }}>
                                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
                                    Специалисты на проверке: {specPending.length}
                                </span>
                                <span style={{ display: 'block', fontSize: 14 }}>
                                    {specPending.slice(0, 3).map(s => `${s.firstName} ${s.lastName}`.trim()).join(', ')}
                                    {specPending.length > 3 ? ' и другие' : ''}
                                </span>
                            </span>
                            <ChevronRight size={18} aria-hidden="true" />
                        </Link>
                    </div>
                )}

                {failed && !loading && (
                    <div style={{ padding: '0 16px' }}>
                        <ErrorBar message="Не удалось загрузить заявки" onRetry={reload} />
                    </div>
                )}

                {loading && items.length === 0 && (
                    <div style={{ padding: '0 16px' }}>
                        <SkeletonList count={2} label="Загружаем заявки" cardHeight={140} />
                    </div>
                )}

                {!loading && !failed && items.length === 0 && (
                    <div style={{ padding: '0 16px' }}>
                        <EmptyState
                            compact
                            icon={<Inbox size={28} />}
                            title={specPending.length > 0 ? "Срочных броней нет" : "Все заявки разобраны"}
                            hint="Новые срочные брони появятся здесь."
                        />
                    </div>
                )}

                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map(b => {
                        const user = userByEmail(b.userId);
                        const resource = RESOURCES.find(r => r.id === b.resourceId);
                        const dateLabel = b.date ? formatDateLabel(b.date as any) : '—';
                        const isThisItemBusy = busy === b.id;
                        const formatLabel = b.format ? (FORMAT_LABEL[b.format] ?? null) : null;
                        const price = Number(b.finalPrice ?? 0);
                        const bal = user ? Number(user.balance ?? 0) : null;
                        const short = bal !== null ? Math.round((price - bal) * 100) / 100 : null;
                        const when = startsIn(b);
                        return (
                            <div key={b.id} style={{
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-10)',
                                borderRadius: 16,
                                padding: 16,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                            }}>
                                <div>
                                    <span className="ui-badge ui-badge--pending">
                                        <Clock size={14} aria-hidden="true" /> {statusLabel('booking', 'pending_approval', 'staff')}{when ? ` · ${when}` : ''}
                                    </span>
                                </div>

                                {/* Цифры для решения — наверху (admin-design №15): хватает ли баланса. */}
                                <div data-decision-numbers style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <div>
                                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>Цена{formatLabel ? ` · ${formatLabel}` : ''}</div>
                                        <Money value={price} className="block text-body font-semibold" />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>Баланс клиента</div>
                                        {bal !== null
                                            ? <Money value={bal} tone="balance" className="block text-body font-semibold" />
                                            : <div style={{ fontSize: 16, fontWeight: 600 }}>—</div>}
                                    </div>
                                </div>
                                {short !== null && (
                                    <div style={{ fontSize: 14, fontWeight: 600, color: short > 0 ? 'var(--status-danger-fg)' : 'var(--status-ok-fg)', marginTop: -4 }}>
                                        {short > 0 ? <>не хватает <Money value={short} inline /></> : 'баланса хватает'}
                                    </div>
                                )}

                                {user ? (
                                    <Link
                                        to={`/m/admin/users/${encodeURIComponent(user.email)}`}
                                        style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 16, fontWeight: 600, color: 'var(--color-ink)', textDecoration: 'none' }}
                                    >
                                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name || user.email}</span>
                                        <ChevronRight size={16} aria-hidden="true" style={{ color: 'var(--color-ink-60)', flexShrink: 0 }} />
                                    </Link>
                                ) : (
                                    <div style={{ fontSize: 16, fontWeight: 600 }}>{b.userId}</div>
                                )}
                                {user?.email && user.email !== user.name && (
                                    <div style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: -8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {user.email}
                                    </div>
                                )}

                                <div className="num-inline" style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-ink-80)' }}>
                                    <Clock size={14} aria-hidden="true" />
                                    {dateLabel}, {b.startTime} · {formatBookingDuration(b.duration ?? 60)}
                                </div>
                                <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-ink-80)' }}>
                                    <MapPin size={14} aria-hidden="true" />
                                    {resource?.name ?? b.resourceId}
                                </div>


                                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                    {/* 09.11 фаза 3: решение в карточке — «вторая» кнопка (рамка), а не
                                        бирюзовая заливка: N мятных «Одобрить» подряд кричали громче цифр. */}
                                    <Button
                                        variant="secondary"
                                        style={{ flex: 1 }}
                                        loading={isThisItemBusy}
                                        icon={<Check size={16} aria-hidden="true" />}
                                        onClick={() => approve(b)}
                                    >
                                        Одобрить
                                    </Button>
                                    <Button
                                        variant="quiet"
                                        style={{ flex: 1 }}
                                        disabled={isThisItemBusy}
                                        icon={<X size={16} aria-hidden="true" />}
                                        onClick={() => { setRejecting(b); setRejectReason(''); }}
                                    >
                                        Отклонить
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {rejecting && (
                <Sheet
                    open
                    onClose={() => setRejecting(null)}
                    title="Причина отказа"
                    description="Специалист увидит этот текст в уведомлении в Telegram."
                    footer={
                        <>
                            <Button
                                variant="danger"
                                block
                                loading={busy === rejecting.id}
                                onClick={submitReject}
                            >
                                Отклонить бронь
                            </Button>
                            <Button
                                variant="secondary"
                                block
                                disabled={busy === rejecting.id}
                                onClick={() => setRejecting(null)}
                            >
                                Не отклонять
                            </Button>
                        </>
                    }
                >
                    <Field label="Причина">
                        <TextArea
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            placeholder="Например: «слот зарезервирован для группового тренинга»"
                            rows={3}
                        />
                    </Field>
                </Sheet>
            )}
        </>
    );
}
