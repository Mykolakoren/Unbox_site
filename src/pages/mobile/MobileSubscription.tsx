import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Snowflake, ArrowLeft, Calendar, Clock, RefreshCw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { api } from '../../api/client';

/**
 * Mobile cabinet: Абонемент — full subscription view with hours remaining,
 * freeze button, expiry, plan comparison link. Replaces the cramped sub
 * row inside MobileProfile when the user needs the full picture before
 * deciding to freeze or top up.
 */
export function MobileSubscription() {
    const navigate = useNavigate();
    const { currentUser, fetchCurrentUser } = useUserStore();
    const [busy, setBusy] = useState(false);

    const sub = currentUser?.subscription;

    useEffect(() => {
        if (!currentUser) fetchCurrentUser().catch(() => {});
    }, [currentUser, fetchCurrentUser]);

    const handleFreeze = async () => {
        if (!sub) return;
        if (sub.isFrozen) {
            if (!confirm('Возобновить абонемент?')) return;
        } else {
            if (!confirm(`Заморозить абонемент? Останется ${sub.freezeCount > 0 ? `${sub.freezeCount}` : '0'} заморозок.`)) return;
        }
        setBusy(true);
        try {
            await api.post('/subscriptions/toggle-freeze');
            await fetchCurrentUser();
            toast.success(sub.isFrozen ? 'Возобновлено' : 'Заморожено');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось');
        } finally {
            setBusy(false);
        }
    };

    if (!currentUser) {
        return (
            <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
                <Loader2 size={20} className="animate-spin" style={{ color: '#888' }} />
            </div>
        );
    }

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            <button
                onClick={() => navigate(-1)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', color: '#666',
                    padding: '6px 0', cursor: 'pointer', fontSize: 13,
                    marginBottom: 8,
                }}
            >
                <ArrowLeft size={14} /> Назад
            </button>

            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, marginBottom: 14 }}>
                Абонемент
            </h1>

            {!sub ? (
                <EmptyState onChoose={() => navigate('/subscriptions')} />
            ) : (
                <>
                    {/* Hero card with remaining hours */}
                    <div style={{
                        background: sub.isFrozen ? 'rgba(76,138,255,0.08)' : '#0E0E0E',
                        color: sub.isFrozen ? '#0E0E0E' : '#fff',
                        borderRadius: 16,
                        padding: '20px 20px 22px',
                        marginBottom: 14,
                    }}>
                        <div style={{
                            fontSize: 10, fontWeight: 700,
                            letterSpacing: '0.10em', textTransform: 'uppercase',
                            opacity: 0.7, marginBottom: 8,
                        }}>
                            {sub.isFrozen ? '❄️ Заморожен' : 'Активный'}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
                            {sub.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                            <span style={{
                                fontSize: 44, fontWeight: 800, letterSpacing: '-0.02em',
                                fontFamily: 'ui-monospace, "SF Mono", monospace',
                                lineHeight: 1,
                            }}>
                                {sub.remainingHours.toFixed(1)}
                            </span>
                            <span style={{ fontSize: 14, opacity: 0.6 }}>
                                / {sub.totalHours} ч
                            </span>
                        </div>
                        {!!sub.bonusHours && (
                            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
                                Из них {sub.bonusHours} ч — бонусные
                            </div>
                        )}
                    </div>

                    {/* Stats grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                        <StatBox
                            icon={<Calendar size={13} />}
                            label="Истекает"
                            value={format(parseISO(sub.expiryDate), 'd MMM yyyy', { locale: ru })}
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
                            background: 'rgba(76,138,255,0.10)',
                            border: '1px solid rgba(76,138,255,0.25)',
                            borderRadius: 10, padding: '10px 12px',
                            fontSize: 12, color: '#1E3A8A',
                            marginBottom: 14,
                        }}>
                            ❄️ Заморожен до {format(parseISO(sub.frozenUntil), 'd MMMM', { locale: ru })}.
                            Часы и срок не тратятся.
                        </div>
                    )}

                    {/* Action: freeze / unfreeze */}
                    {sub.freezeCount > 0 && (
                        <button
                            onClick={handleFreeze}
                            disabled={busy}
                            style={{
                                width: '100%',
                                padding: '12px',
                                background: sub.isFrozen ? '#0E0E0E' : 'rgba(76,138,255,0.10)',
                                color: sub.isFrozen ? '#fff' : '#1E3A8A',
                                border: 'none', borderRadius: 10,
                                fontWeight: 700, fontSize: 14,
                                cursor: busy ? 'wait' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                marginBottom: 10,
                            }}
                        >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <Snowflake size={14} />}
                            {sub.isFrozen ? 'Возобновить' : 'Заморозить абонемент'}
                        </button>
                    )}

                    <button
                        onClick={() => navigate('/subscriptions')}
                        style={{
                            width: '100%',
                            padding: '10px',
                            background: 'rgba(0,0,0,0.05)',
                            color: '#0E0E0E',
                            border: 'none', borderRadius: 10,
                            fontWeight: 600, fontSize: 13,
                            cursor: 'pointer',
                        }}
                    >
                        Сравнить тарифы →
                    </button>
                </>
            )}
        </div>
    );
}

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div style={{
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.06)',
            borderRadius: 10,
            padding: '10px 12px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                {icon} {label}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0E0E0E' }}>{value}</div>
        </div>
    );
}

function EmptyState({ onChoose }: { onChoose: () => void }) {
    return (
        <div style={{
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.06)',
            borderRadius: 14,
            padding: '24px 18px',
            textAlign: 'center',
        }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Абонемента пока нет</div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 16, lineHeight: 1.45 }}>
                Подберите тариф под вашу частоту брони — от 10 ч в месяц.
                Скидка к стандартному часу — от 22% до 50%.
            </div>
            <button
                onClick={onChoose}
                style={{
                    padding: '11px 22px',
                    background: '#0E0E0E', color: '#fff',
                    border: 'none', borderRadius: 9,
                    fontWeight: 700, fontSize: 13,
                    cursor: 'pointer',
                }}
            >
                Выбрать абонемент →
            </button>
        </div>
    );
}
