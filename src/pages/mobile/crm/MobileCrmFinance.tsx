import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, AlertCircle, Loader2, Calendar, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { crmApi, type CrmDashboard } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';

/**
 * Mobile CRM Финансы — money snapshot for the active specialist.
 *
 *   Top: month revenue + total debt strip.
 *   Middle: month picker (current + 5 back).
 *   Bottom: debt by client, tap → client detail.
 *
 * Tap a debt row to jump to /m/crm/clients/<id> where the specialist can
 * mark sessions paid or record a payment.
 */
export function MobileCrmFinance() {
    const navigate = useNavigate();
    const { clients, fetchClients } = useCrmStore();
    const [monthOffset, setMonthOffset] = useState(0);
    const [dashboard, setDashboard] = useState<CrmDashboard | null>(null);
    const [loading, setLoading] = useState(true);

    const monthDate = useMemo(() => {
        const d = new Date();
        d.setMonth(d.getMonth() + monthOffset, 1);
        return d;
    }, [monthOffset]);

    const monthParam = useMemo(() => format(monthDate, 'yyyy-MM'), [monthDate]);

    useEffect(() => {
        if (clients.length === 0) fetchClients().catch(() => {});
    }, [clients.length, fetchClients]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        crmApi.getDashboard(undefined, monthParam)
            .then(d => { if (!cancelled) setDashboard(d); })
            .catch(() => { if (!cancelled) setDashboard(null); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [monthParam]);

    const debts = useMemo(() => {
        if (!dashboard?.debtByClient) return [];
        return [...dashboard.debtByClient].sort((a, b) => b.totalDebt - a.totalDebt);
    }, [dashboard]);

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            {/* Month picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <button
                    onClick={() => setMonthOffset(o => o - 1)}
                    style={navBtn}
                >‹</button>
                <div style={{
                    flex: 1, textAlign: 'center', padding: '8px 10px',
                    border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8,
                    fontSize: 13, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                    <Calendar size={14} style={{ opacity: 0.6 }} />
                    {format(monthDate, 'LLLL yyyy', { locale: ru })}
                </div>
                <button
                    onClick={() => setMonthOffset(o => o + 1)}
                    disabled={monthOffset >= 0}
                    style={{ ...navBtn, opacity: monthOffset >= 0 ? 0.3 : 1 }}
                >›</button>
            </div>

            {/* Top totals strip */}
            <div style={{
                background: '#0E0E0E',
                color: '#fff',
                borderRadius: 14,
                padding: '14px 16px',
                marginBottom: 14,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
            }}>
                <TotalCell
                    icon={<TrendingUp size={12} />}
                    label="Доход за месяц"
                    value={dashboard?.revenueThisMonth}
                    loading={loading}
                />
                <TotalCell
                    icon={<AlertCircle size={12} />}
                    label="Долг (всего)"
                    value={dashboard?.totalActiveDebt}
                    loading={loading}
                    warning
                />
            </div>

            {/* Secondary metrics */}
            {dashboard && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 6,
                    marginBottom: 14,
                }}>
                    <MiniMetric label="Сессий" value={dashboard.sessionsThisMonth} unit="" />
                    <MiniMetric label="Не оплачено" value={dashboard.unpaidSessions} unit="" />
                    <MiniMetric label="Ср. чек" value={dashboard.avgCheck} unit="₾" />
                </div>
            )}

            {/* Debt by client */}
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginBottom: 8 }}>
                Должники · {debts.length}
            </div>
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                    <Loader2 size={18} className="animate-spin" style={{ color: '#888' }} />
                </div>
            ) : debts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: '#888', fontSize: 13 }}>
                    Нет задолженностей
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {debts.map(d => (
                        <button
                            key={d.clientId}
                            onClick={() => navigate(`/m/crm/clients/${d.clientId}`)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '11px 12px',
                                background: '#fff',
                                border: '1px solid rgba(0,0,0,0.04)',
                                borderRadius: 10,
                                cursor: 'pointer',
                                textAlign: 'left',
                                width: '100%',
                            }}
                        >
                            <div style={{
                                width: 36, height: 36, borderRadius: 9,
                                background: 'rgba(179,38,30,0.08)',
                                color: '#B3261E',
                                display: 'grid', placeItems: 'center',
                                fontSize: 13, fontWeight: 700,
                                flexShrink: 0,
                            }}>
                                {initials(d.clientName)}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#0E0E0E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {d.clientName}
                                </div>
                                <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                                    {d.unpaidSessionsCount} {pluralizeSessions(d.unpaidSessionsCount)} не оплачено
                                </div>
                            </div>
                            <div style={{
                                fontSize: 14,
                                fontWeight: 700,
                                fontFamily: 'ui-monospace, "SF Mono", monospace',
                                color: '#B3261E',
                                textAlign: 'right',
                            }}>
                                {d.totalDebt.toFixed(0)}<span style={{ fontSize: 10, color: '#888' }}> {d.currency || '₾'}</span>
                            </div>
                            <ChevronRight size={14} style={{ color: '#999', flexShrink: 0 }} />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

const navBtn: React.CSSProperties = {
    width: 32, height: 32,
    border: '1px solid rgba(0,0,0,0.12)',
    background: '#fff',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 700,
    color: '#0E0E0E',
    cursor: 'pointer',
    display: 'grid', placeItems: 'center',
};

function TotalCell({
    icon, label, value, loading, warning,
}: {
    icon: React.ReactNode;
    label: string;
    value?: number;
    loading?: boolean;
    warning?: boolean;
}) {
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, opacity: 0.65, marginBottom: 4 }}>
                {icon} {label}
            </div>
            <div style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: 'ui-monospace, "SF Mono", monospace',
                color: warning && (value || 0) > 0 ? '#FF8B7A' : '#fff',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
            }}>
                {loading ? '…' : (value || 0).toFixed(0)}
                <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>₾</span>
            </div>
        </div>
    );
}

function MiniMetric({ label, value, unit }: { label: string; value: number | undefined; unit: string }) {
    return (
        <div style={{
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.06)',
            borderRadius: 10,
            padding: '9px 10px 10px',
        }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 2 }}>
                {label}
            </div>
            <div style={{
                fontSize: 16, fontWeight: 700, color: '#0E0E0E',
                fontFamily: 'ui-monospace, "SF Mono", monospace',
                letterSpacing: '-0.01em',
            }}>
                {value !== undefined ? value.toFixed(0) : '—'}
                {unit && <span style={{ fontSize: 10, color: '#888', marginLeft: 2 }}>{unit}</span>}
            </div>
        </div>
    );
}

function initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?';
}

function pluralizeSessions(n: number): string {
    if (n === 1) return 'сессия';
    if (n >= 2 && n <= 4) return 'сессии';
    return 'сессий';
}
