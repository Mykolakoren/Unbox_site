import { useEffect, useState } from 'react';
import { Check, Clock, MapPin, X, Inbox, UserCheck, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { bookingsApi } from '../../../api/bookings';
import { specialistsApi, type SpecialistProfile } from '../../../api/specialists';
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
        setBusy(b.id);
        try {
            await bookingsApi.approveBooking(b.id);
            setItems(prev => prev.filter(x => x.id !== b.id));
            toast.success('Бронь одобрена');
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
            <div style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ padding: '0 16px' }}>
                    <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                        Заявки
                    </h1>
                    <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                        Срочные брони и анкеты специалистов, которые ждут вашего решения.
                    </p>
                </div>

                {specPending.length > 0 && (
                    <div style={{ padding: '0 16px' }}>
                        <Link
                            to="/m/admin/specialists?filter=pending"
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12, minHeight: 48,
                                background: 'var(--status-pending-bg)', color: 'var(--status-pending-fg)',
                                borderRadius: 14, padding: '10px 14px', textDecoration: 'none',
                            }}
                        >
                            <UserCheck size={20} aria-hidden="true" />
                            <span style={{ flex: 1 }}>
                                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
                                    Специалисты на проверке: {specPending.length}
                                </span>
                                <span style={{ display: 'block', fontSize: 12 }}>
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
                        const formatLabel = b.format ? (FORMAT_LABEL[b.format] ?? b.format) : null;
                        return (
                            <div key={b.id} style={{
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-10)',
                                borderRadius: 14,
                                padding: 14,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                            }}>
                                <div>
                                    <span className="ui-badge ui-badge--pending">
                                        <Clock size={14} aria-hidden="true" /> Срочная бронь · ждёт ответа
                                    </span>
                                </div>

                                <div style={{ fontSize: 16, fontWeight: 600 }}>
                                    {user?.name || b.userId}
                                </div>
                                {user?.email && user.email !== user.name && (
                                    <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: -4 }}>
                                        {user.email}
                                    </div>
                                )}

                                <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-ink-80)' }}>
                                    <Clock size={14} aria-hidden="true" />
                                    {dateLabel}, {b.startTime} · {formatBookingDuration(b.duration ?? 60)}
                                </div>
                                <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-ink-80)' }}>
                                    <MapPin size={14} aria-hidden="true" />
                                    {resource?.name ?? b.resourceId}
                                </div>

                                <div style={{ fontSize: 14, color: 'var(--color-ink-80)' }}>
                                    {formatGel(b.finalPrice ?? 0)}
                                    {formatLabel && <> · {formatLabel}</>}
                                    {user && (
                                        <> · Баланс: <span style={{ color: (user.balance ?? 0) < 0 ? 'var(--status-danger-fg)' : undefined }}>{formatGel(user.balance ?? 0)}</span></>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                    <Button
                                        style={{ flex: 1 }}
                                        loading={isThisItemBusy}
                                        icon={<Check size={16} aria-hidden="true" />}
                                        onClick={() => approve(b)}
                                    >
                                        Одобрить
                                    </Button>
                                    <Button
                                        variant="secondary"
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
