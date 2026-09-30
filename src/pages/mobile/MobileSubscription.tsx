import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Snowflake, ArrowLeft, Calendar, Clock, RefreshCw, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { api } from '../../api/client';
import { fmtHours, reservedSubscriptionHours } from '../../utils/paymentPriority';
import { COLOR, STATUS } from '../../design/tokens';
import { formatDayMonth } from '../../utils/format';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';

/**
 * Mobile cabinet: Абонемент — full subscription view with hours remaining,
 * freeze button, expiry, plan comparison link. Replaces the cramped sub
 * row inside MobileProfile when the user needs the full picture before
 * deciding to freeze or top up.
 */
export function MobileSubscription() {
    const navigate = useNavigate();
    const { currentUser, fetchCurrentUser, bookings, fetchBookings } = useUserStore();
    const [busy, setBusy] = useState(false);
    const { confirm } = useConfirmDialog();

    const sub = currentUser?.subscription;

    useEffect(() => {
        if (!currentUser) fetchCurrentUser().catch(() => {});
    }, [currentUser, fetchCurrentUser]);

    // Брони нужны, чтобы честно показать остаток: часы будущих броней ещё не
    // списаны (спишутся за сутки до встречи), но уже обещаны (G4-client-mobile-M1).
    useEffect(() => {
        if (currentUser && bookings.length === 0) fetchBookings().catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id]);
    const reserved = reservedSubscriptionHours(sub, bookings, currentUser?.email);

    const handleFreeze = async () => {
        if (!sub) return;
        // Wave 1: общее окно подтверждения вместо системного confirm().
        const ok = await confirm(sub.isFrozen
            ? {
                title: 'Возобновить абонемент?',
                body: 'Часы и срок абонемента снова начнут тратиться.',
                confirmLabel: 'Возобновить',
                cancelLabel: 'Не сейчас',
            }
            : {
                title: 'Заморозить абонемент?',
                body: `Пока абонемент заморожен, часы и срок не тратятся. Заморозок осталось: ${sub.freezeCount}.`,
                confirmLabel: 'Заморозить',
                cancelLabel: 'Не сейчас',
            });
        if (!ok) return;
        setBusy(true);
        try {
            await api.post('/subscriptions/toggle-freeze');
            await fetchCurrentUser();
            toast.success(sub.isFrozen ? 'Возобновлено' : 'Заморожено');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось изменить заморозку');
        } finally {
            setBusy(false);
        }
    };

    if (!currentUser) {
        return (
            <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
                <Loader2 size={20} className="animate-spin" style={{ color: COLOR.ink60 }} />
            </div>
        );
    }

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            <button
                onClick={() => navigate(-1)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', color: COLOR.ink60,
                    minHeight: 44, padding: 0, cursor: 'pointer', fontSize: 13,
                    fontFamily: 'inherit',
                }}
            >
                <ArrowLeft size={14} /> Назад
            </button>

            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, marginBottom: 14 }}>
                Абонемент
            </h1>

            {!sub ? (
                <NoSubscription onChoose={() => navigate('/m/tariffs')} />
            ) : (
                <>
                    {/* Hero card with remaining hours */}
                    <div style={{
                        // Заморожен — статус «инфо», а не декоративный голубой.
                        background: sub.isFrozen ? STATUS.info.bg : COLOR.ink,
                        color: sub.isFrozen ? COLOR.ink : COLOR.onInk,
                        borderRadius: 16,
                        padding: '20px 20px 22px',
                        marginBottom: 14,
                    }}>
                        <div style={{
                            fontSize: 12, fontWeight: 600,
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                            opacity: 0.8, marginBottom: 8,
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                            {sub.isFrozen && <Snowflake size={14} aria-hidden="true" />}
                            {sub.isFrozen ? 'Заморожен' : 'Активный'}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
                            {sub.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                            <span className="num" style={{
                                fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em',
                                lineHeight: 1,
                            }}>
                                {sub.remainingHours.toFixed(1)}
                            </span>
                            <span style={{ fontSize: 14, opacity: 0.7 }}>
                                / {sub.totalHours} ч
                            </span>
                        </div>
                        {!!sub.bonusHours && (
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                                Из них {sub.bonusHours} ч — бонусные
                            </div>
                        )}
                        {reserved > 0.01 && (
                            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6, lineHeight: 1.4 }}>
                                {fmtHours(reserved)} уже в будущих бронях — спишутся за сутки до встреч.
                                {' '}Свободно для новых: {fmtHours(Math.max(0, sub.remainingHours - reserved))}
                            </div>
                        )}
                    </div>

                    {/* Stats grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                        <StatBox
                            icon={<Calendar size={13} />}
                            label="Истекает"
                            value={formatDayMonth(sub.expiryDate, { withYear: 'auto' })}
                        />
                        <StatBox
                            icon={<RefreshCw size={13} />}
                            label="Бесплатных переносов"
                            value={String(sub.freeReschedules)}
                        />
                        <StatBox
                            icon={<Snowflake size={13} />}
                            label="Заморозок осталось"
                            value={String(sub.freezeCount)}
                        />
                        <StatBox
                            icon={<Clock size={13} />}
                            label="Использовано"
                            value={`${(sub.totalHours - sub.remainingHours).toFixed(1)} ч`}
                        />
                    </div>

                    {sub.isFrozen && sub.frozenUntil && (
                        <div style={{
                            background: STATUS.info.bg,
                            border: `1px solid ${STATUS.info.fg}33`,
                            borderRadius: 10, padding: '10px 12px',
                            fontSize: 12, color: STATUS.info.fg,
                            marginBottom: 14,
                            display: 'flex', alignItems: 'flex-start', gap: 6,
                        }}>
                            <Snowflake size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                            <span>Заморожен до {formatDayMonth(sub.frozenUntil)}. Часы и срок не тратятся.</span>
                        </div>
                    )}

                    {/* Action: freeze / unfreeze */}
                    {sub.freezeCount > 0 && (
                        <Button
                            block
                            variant={sub.isFrozen ? 'primary' : 'secondary'}
                            onClick={handleFreeze}
                            loading={busy}
                            icon={<Snowflake size={16} aria-hidden="true" />}
                            style={{ marginBottom: 10 }}
                        >
                            {sub.isFrozen ? 'Возобновить' : 'Заморозить абонемент'}
                        </Button>
                    )}

                    <Button block variant="quiet" onClick={() => navigate('/m/tariffs')}>
                        Сравнить тарифы →
                    </Button>
                </>
            )}
        </div>
    );
}

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div style={{
            background: COLOR.card,
            border: `1px solid ${COLOR.ink05}`,
            borderRadius: 10,
            padding: '10px 12px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: COLOR.ink60, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                {icon} {label}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLOR.ink }}>{value}</div>
        </div>
    );
}

/** Абонемента нет — общий EmptyState: что видим + что сделать. */
function NoSubscription({ onChoose }: { onChoose: () => void }) {
    return (
        <EmptyState
            icon={<Ticket size={28} />}
            title="Абонемента пока нет"
            hint="Подберите тариф под вашу частоту брони — от 10 ч в месяц. Скидка к стандартному часу — от 22% до 50%."
            action={{ label: 'Выбрать абонемент', onClick: onChoose }}
        />
    );
}
