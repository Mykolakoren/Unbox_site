import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft, Gift, Clock, Check, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { bonusesApi, type Bonus } from '../../api/bonuses';

type Filter = 'active' | 'used' | 'expired' | 'all';

const FILTER_LABEL: Record<Filter, string> = {
    active: 'Активные',
    used: 'Использованные',
    expired: 'Истёкшие',
    all: 'Все',
};

/**
 * Mobile cabinet: Бонусы — full bonus history with active/used/expired
 * filters. Replaces the cramped 5-item preview inside MobileProfile when
 * the user needs to audit "where did my free hours go".
 */
export function MobileBonuses() {
    const navigate = useNavigate();
    const [bonuses, setBonuses] = useState<Bonus[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<Filter>('active');

    const load = async () => {
        setLoading(true);
        try {
            const list = await bonusesApi.getMyBonuses();
            setBonuses(list);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось загрузить');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        return bonuses
            .filter(b => filter === 'all' ? true : b.status === filter)
            .sort((a, b) => {
                // Soonest-expiring first within active; newest-created first for the rest.
                if (filter === 'active') {
                    const ax = a.expiresAt ? parseISO(a.expiresAt).getTime() : Infinity;
                    const bx = b.expiresAt ? parseISO(b.expiresAt).getTime() : Infinity;
                    return ax - bx;
                }
                return parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime();
            });
    }, [bonuses, filter]);

    const totals = useMemo(() => {
        const active = bonuses.filter(b => b.status === 'active');
        const totalActiveHours = active.reduce((s, b) => s + (b.quantity || 0), 0);
        return { totalActiveHours, activeCount: active.length };
    }, [bonuses]);

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
                Бонусы
            </h1>

            {/* Hero strip — total active hours */}
            <div style={{
                background: 'linear-gradient(135deg, #FEF3C7, #FCD34D)',
                color: '#78350F',
                borderRadius: 14,
                padding: '16px 18px',
                marginBottom: 14,
                display: 'flex', alignItems: 'center', gap: 14,
            }}>
                <Gift size={28} />
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.75 }}>
                        Активных бонусов
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'ui-monospace, "SF Mono", monospace' }}>
                            {totals.totalActiveHours}
                        </span>
                        <span style={{ fontSize: 13 }}>ч</span>
                        <span style={{ fontSize: 12, opacity: 0.75, marginLeft: 6 }}>
                            ({totals.activeCount})
                        </span>
                    </div>
                </div>
            </div>

            {/* Filter chips */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                {(['active', 'used', 'expired', 'all'] as Filter[]).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        style={{
                            flex: 1,
                            padding: '7px 0',
                            background: filter === f ? '#0E0E0E' : 'rgba(0,0,0,0.04)',
                            color: filter === f ? '#fff' : '#0E0E0E',
                            border: 'none',
                            borderRadius: 8,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        {FILTER_LABEL[f]}
                    </button>
                ))}
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                    <Loader2 size={20} className="animate-spin" style={{ color: '#888' }} />
                </div>
            ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#888', fontSize: 13 }}>
                    Нет бонусов в этом фильтре
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {filtered.map(b => {
                        const status = b.status;
                        const palette = status === 'active'
                            ? { bg: 'rgba(252,211,77,0.20)', fg: '#78350F', label: 'Активен' }
                            : status === 'used'
                                ? { bg: 'rgba(0,0,0,0.04)', fg: '#0E0E0E', label: 'Использован' }
                                : { bg: 'rgba(179,38,30,0.08)', fg: '#B3261E', label: 'Истёк' };
                        const StatusIcon = status === 'active' ? Gift : status === 'used' ? Check : X;
                        const expiryStr = b.expiresAt
                            ? format(parseISO(b.expiresAt), 'd MMM', { locale: ru })
                            : null;
                        return (
                            <div key={b.id} style={{
                                background: '#fff',
                                border: '1px solid rgba(0,0,0,0.06)',
                                borderRadius: 11,
                                padding: '11px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                opacity: status === 'expired' ? 0.55 : 1,
                            }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: 8,
                                    background: palette.bg, color: palette.fg,
                                    display: 'grid', placeItems: 'center', flexShrink: 0,
                                }}>
                                    <StatusIcon size={14} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0E0E0E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {b.description || b.type || 'Бонус'} · {b.quantity} ч
                                    </div>
                                    <div style={{ fontSize: 11, color: '#888', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ color: palette.fg, fontWeight: 700 }}>{palette.label}</span>
                                        <span>·</span>
                                        <span>{format(parseISO(b.createdAt), 'd MMM yyyy', { locale: ru })}</span>
                                        {expiryStr && status === 'active' && (
                                            <>
                                                <span>·</span>
                                                <Clock size={10} />
                                                <span>до {expiryStr}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{
                marginTop: 16,
                padding: 12,
                background: 'rgba(252,211,77,0.10)',
                borderRadius: 10,
                fontSize: 11,
                color: '#78350F',
                lineHeight: 1.5,
            }}>
                💡 Бонусы списываются автоматически при оплате брони (FIFO — раньше истекающие первыми).
                Приветственный бонус 1 час действует 90 дней.
            </div>
        </div>
    );
}
