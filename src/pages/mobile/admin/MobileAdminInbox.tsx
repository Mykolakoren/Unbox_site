import { useEffect, useState } from 'react';
import { Check, Clock, MapPin, X } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { bookingsApi } from '../../../api/bookings';
import { useUserStore } from '../../../store/userStore';
import { RESOURCES } from '../../../utils/data';
import { formatBookingDuration } from '../../../utils/bookingHelpers';
import type { BookingHistoryItem } from '../../../store/types';

/**
 * Mobile admin inbox — hot-booking approvals.
 *
 * Each row is one pending request: who, when, where. Action buttons:
 *   - Одобрить → bookingsApi.approveBooking
 *   - Отклонить → opens reason input → bookingsApi.rejectBooking
 *
 * Optimistic local-state update keeps the list snappy; on error we re-fetch.
 *
 * CRM access requests / specialist applications can be added here too in
 * a later iteration — same pattern, different endpoints.
 */
export function MobileAdminInbox() {
    const { users, fetchUsers } = useUserStore();
    const [items, setItems] = useState<BookingHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [rejecting, setRejecting] = useState<BookingHistoryItem | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    const reload = () => {
        setLoading(true);
        bookingsApi.getPendingApprovals()
            .then(setItems)
            .catch(() => toast.error('Не удалось загрузить заявки'))
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
            toast.success('Одобрено');
        } catch (e: any) {
            toast.error('Не получилось одобрить');
            reload();
        } finally { setBusy(null); }
    };

    const submitReject = async () => {
        if (!rejecting) return;
        const reason = rejectReason.trim();
        if (!reason) {
            toast.error('Укажи причину отказа — её увидит специалист');
            return;
        }
        setBusy(rejecting.id);
        try {
            await bookingsApi.rejectBooking(rejecting.id, reason);
            setItems(prev => prev.filter(x => x.id !== rejecting.id));
            toast.success('Отклонено');
            setRejecting(null);
            setRejectReason('');
        } catch (e: any) {
            toast.error('Не получилось отклонить');
            reload();
        } finally { setBusy(null); }
    };

    return (
        <>
            <div style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ padding: '0 16px' }}>
                    <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                        Заявки
                    </h1>
                    <p style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                        Hot-booking, ждут одобрения. Тут же будут CRM-доступы и заявки в специалисты.
                    </p>
                </div>

                {loading && <div style={{ padding: '0 16px', color: '#666', fontSize: 14 }}>Загружаю…</div>}

                {!loading && items.length === 0 && (
                    <div style={{ padding: '0 16px' }}>
                        <div style={{
                            background: '#E6F4EA',
                            border: '1px solid #A7E1B8',
                            color: '#1B6E36',
                            borderRadius: 14,
                            padding: 18,
                            textAlign: 'center',
                            fontSize: 14,
                        }}>
                            ✓ Все заявки разобраны.
                        </div>
                    </div>
                )}

                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map(b => {
                        const user = userByEmail(b.userId);
                        const resource = RESOURCES.find(r => r.id === b.resourceId);
                        const dt = b.date ? new Date(b.date as any) : null;
                        const dateLabel = dt ? fmtDate(dt, 'EEEE, d MMMM', { locale: ru }) : '—';
                        const isThisItemBusy = busy === b.id;
                        return (
                            <div key={b.id} style={{
                                background: '#fff',
                                border: '1px solid #FCA5A5',
                                borderRadius: 14,
                                padding: 14,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                            }}>
                                <div style={{
                                    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                                    textTransform: 'uppercase', color: '#991B1B',
                                }}>
                                    Hot-booking · ждёт ответа
                                </div>

                                <div style={{ fontSize: 15, fontWeight: 700 }}>
                                    {user?.name || b.userId}
                                </div>
                                {user?.email && user.email !== user.name && (
                                    <div style={{ fontSize: 11, color: '#666', marginTop: -4 }}>
                                        {user.email}
                                    </div>
                                )}

                                <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: '#444' }}>
                                    <Clock size={14} />
                                    {dateLabel}, {b.startTime} · {formatBookingDuration(b.duration ?? 60)}
                                </div>
                                <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: '#444' }}>
                                    <MapPin size={14} />
                                    {resource?.name ?? b.resourceId}
                                </div>

                                <div style={{ fontSize: 12, color: '#666' }}>
                                    {(b.finalPrice ?? 0).toFixed(0)} ₾ · {b.format}
                                    {user && (
                                        <> · Баланс: {(user.balance ?? 0).toFixed(0)} ₾</>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                    <button
                                        onClick={() => approve(b)}
                                        disabled={isThisItemBusy}
                                        style={{
                                            flex: 1,
                                            background: '#0E0E0E',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: 10,
                                            padding: '10px 12px',
                                            fontSize: 13,
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            fontFamily: 'inherit',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 6,
                                            opacity: isThisItemBusy ? 0.6 : 1,
                                        }}
                                    >
                                        <Check size={14} /> Одобрить
                                    </button>
                                    <button
                                        onClick={() => { setRejecting(b); setRejectReason(''); }}
                                        disabled={isThisItemBusy}
                                        style={{
                                            flex: 1,
                                            background: '#fff',
                                            color: '#C8253A',
                                            border: '1px solid #FCA5A5',
                                            borderRadius: 10,
                                            padding: '10px 12px',
                                            fontSize: 13,
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            fontFamily: 'inherit',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 6,
                                        }}
                                    >
                                        <X size={14} /> Отклонить
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {rejecting && (
                <div
                    onClick={() => setRejecting(null)}
                    style={{
                        position: 'fixed', inset: 0,
                        background: 'rgba(0,0,0,0.55)',
                        zIndex: 200,
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            width: '100%',
                            maxWidth: 480,
                            background: '#fff',
                            borderRadius: '20px 20px 0 0',
                            padding: 20,
                            paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                            // Высокое содержимое не уходит под тулбар Safari —
                            // ограничиваем высоту (dvh) и даём внутренний скролл.
                            maxHeight: 'calc(100dvh - 16px)',
                            overflowY: 'auto',
                            WebkitOverflowScrolling: 'touch',
                        }}
                    >
                        <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Причина отказа</h3>
                        <div style={{ fontSize: 13, color: '#666' }}>
                            Специалист увидит этот текст в TG-уведомлении.
                        </div>
                        <textarea
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            placeholder="Например: «слот зарезервирован для группового тренинга»"
                            rows={3}
                            style={{
                                background: '#F4F4F2',
                                border: 'none',
                                borderRadius: 10,
                                padding: '10px 12px',
                                fontSize: 14,
                                fontFamily: 'inherit',
                                resize: 'none',
                                outline: 'none',
                            }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                onClick={() => setRejecting(null)}
                                disabled={busy === rejecting.id}
                                style={{
                                    flex: 1,
                                    background: '#F4F4F2',
                                    color: '#0E0E0E',
                                    border: 'none',
                                    borderRadius: 10,
                                    padding: 12,
                                    fontSize: 14, fontWeight: 700,
                                    fontFamily: 'inherit',
                                    cursor: 'pointer',
                                }}
                            >
                                Назад
                            </button>
                            <button
                                onClick={submitReject}
                                disabled={busy === rejecting.id}
                                style={{
                                    flex: 1,
                                    background: '#C8253A',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: 10,
                                    padding: 12,
                                    fontSize: 14, fontWeight: 700,
                                    fontFamily: 'inherit',
                                    cursor: 'pointer',
                                    opacity: busy === rejecting.id ? 0.7 : 1,
                                }}
                            >
                                {busy === rejecting.id ? 'Отклоняю…' : 'Отклонить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
