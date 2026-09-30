import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, AlertCircle, Calendar, ChevronRight, ChevronLeft } from 'lucide-react';
import { format } from 'date-fns';
import { crmApi, type CrmDashboard } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { useCrmDataVersion } from './crmDataVersion';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';
import { formatGel, formatMoney, formatMonthLabel } from '../../../utils/format';

/**
 * Mobile CRM Финансы — money snapshot for the active specialist.
 *
 *   Top: month revenue + total debt strip.
 *   Middle: month picker (current + 5 back).
 *   Bottom: debt by client, tap → client detail.
 *
 * Tap a debt row to jump to /m/crm/clients/<id> where the specialist can
 * mark sessions paid or record a payment.
 *
 * Wave 1: заголовок «Финансы», стрелки месяца — значки 44 px с подписью для
 * диктора, светлая полоса итогов (долг — красным токеном), суммы —
 * formatGel/formatMoney («140 ₾», а не «140 GEL»), «Ср. чек» → «Средний чек».
 */
export function MobileCrmFinance() {
    const navigate = useNavigate();
    const { clients, fetchClients } = useCrmStore();
    const [monthOffset, setMonthOffset] = useState(0);
    // Данные храним вместе с месяцем, за который они пришли: при смене
    // месяца цифры прошлого не показываются под новым заголовком.
    const [loaded, setLoaded] = useState<{ month: string; data: CrmDashboard } | null>(null);
    const [loading, setLoading] = useState(true);
    // Сбой загрузки — отдельное состояние. Раньше при ошибке экран рисовал
    // «0 ₾» и «Нет задолженностей», и казалось, что все расплатились.
    const [failed, setFailed] = useState(false);
    const [retryTick, setRetryTick] = useState(0);
    const dataVersion = useCrmDataVersion();

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
        setFailed(false);
        crmApi.getDashboard(undefined, monthParam)
            .then(d => { if (!cancelled) setLoaded({ month: monthParam, data: d }); })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [monthParam, retryTick, dataVersion]);

    const dashboard = !failed && loaded?.month === monthParam ? loaded.data : null;
    const pending = loading && !dashboard;

    const debts = useMemo(() => {
        if (!dashboard?.debtByClient) return [];
        return [...dashboard.debtByClient].sort((a, b) => b.totalDebt - a.totalDebt);
    }, [dashboard]);

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: '2px 2px 12px' }}>
                Финансы
            </h1>

            {/* Month picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Button
                    variant="secondary"
                    size="touch"
                    icon={<ChevronLeft size={20} aria-hidden="true" />}
                    aria-label="Предыдущий месяц"
                    onClick={() => setMonthOffset(o => o - 1)}
                />
                <div style={{
                    flex: 1, textAlign: 'center', padding: '0 10px',
                    minHeight: 44,
                    border: '1px solid var(--color-ink-08)', borderRadius: 8,
                    fontSize: 14, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                    <Calendar size={16} color={COLOR.ink60} aria-hidden="true" />
                    {formatMonthLabel(monthDate, { capitalize: true })}
                </div>
                <Button
                    variant="secondary"
                    size="touch"
                    icon={<ChevronRight size={20} aria-hidden="true" />}
                    aria-label="Следующий месяц"
                    disabled={monthOffset >= 0}
                    onClick={() => setMonthOffset(o => o + 1)}
                />
            </div>

            {/* Top totals strip */}
            <div style={{
                background: 'var(--color-sunken)',
                color: 'var(--color-ink)',
                borderRadius: 14,
                padding: '14px 16px',
                marginBottom: 14,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
            }}>
                <TotalCell
                    icon={<TrendingUp size={14} aria-hidden="true" />}
                    label="Доход за месяц"
                    value={dashboard?.revenueThisMonth}
                    loading={pending}
                />
                <TotalCell
                    icon={<AlertCircle size={14} aria-hidden="true" />}
                    label="Долг (всего)"
                    value={dashboard?.totalActiveDebt}
                    loading={pending}
                    warning
                />
            </div>

            {failed && !loading && (
                <ErrorBar
                    message="Не удалось загрузить финансы"
                    onRetry={() => setRetryTick(t => t + 1)}
                    className="mb-3"
                />
            )}

            {/* Secondary metrics */}
            {dashboard && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 6,
                    marginBottom: 14,
                }}>
                    <MiniMetric label="Сессий" value={dashboard.sessionsThisMonth} />
                    <MiniMetric label="Не оплачено" value={dashboard.unpaidSessions} />
                    <MiniMetric label="Средний чек" value={dashboard.avgCheck} money />
                </div>
            )}

            {/* Debt by client */}
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-ink-60)', marginBottom: 8 }}>
                Должники{dashboard ? ` · ${debts.length}` : ''}
            </div>
            {pending ? (
                <SkeletonList count={3} label="Загружаем должников" cardHeight={56} />
            ) : !dashboard ? (
                // Сбой: не пишем «Нет задолженностей» — мы этого не знаем.
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-ink-60)', fontSize: 14 }}>
                    —
                </div>
            ) : debts.length === 0 ? (
                <EmptyState compact title="Нет задолженностей" hint="Все клиенты рассчитались." />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {debts.map(d => (
                        <button
                            key={d.clientId}
                            onClick={() => navigate(`/m/crm/clients/${d.clientId}`)}
                            className="press"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '11px 12px',
                                minHeight: 56,
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-08)',
                                borderRadius: 10,
                                cursor: 'pointer',
                                textAlign: 'left',
                                width: '100%',
                                fontFamily: 'inherit',
                            }}
                        >
                            <div style={{
                                width: 36, height: 36, borderRadius: 9,
                                background: 'var(--status-danger-bg)',
                                color: 'var(--status-danger-fg)',
                                display: 'grid', placeItems: 'center',
                                fontSize: 14, fontWeight: 600,
                                flexShrink: 0,
                            }}>
                                {initials(d.clientName)}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {d.clientName}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1 }}>
                                    Не оплачено: {d.unpaidSessionsCount} {pluralizeSessions(d.unpaidSessionsCount)}
                                </div>
                            </div>
                            <div className="num" style={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: 'var(--status-danger-fg)',
                                textAlign: 'right',
                                whiteSpace: 'nowrap',
                            }}>
                                {formatMoney(d.totalDebt, { currency: d.currency || 'GEL' })}
                            </div>
                            <ChevronRight size={16} color={COLOR.ink40} aria-hidden="true" style={{ flexShrink: 0 }} />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-ink-60)', marginBottom: 4 }}>
                {icon} {label}
            </div>
            <div className="num" style={{
                fontSize: 20,
                fontWeight: 600,
                color: warning && (value ?? 0) > 0 ? 'var(--status-danger-fg)' : 'var(--color-ink)',
                lineHeight: 1.1,
            }}>
                {loading ? '…' : value === undefined || value === null ? '—' : formatGel(value)}
            </div>
        </div>
    );
}

function MiniMetric({ label, value, money }: { label: string; value: number | undefined; money?: boolean }) {
    return (
        <div style={{
            background: 'var(--color-card)',
            border: '1px solid var(--color-ink-08)',
            borderRadius: 10,
            padding: '9px 10px 10px',
        }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink-60)', marginBottom: 2 }}>
                {label}
            </div>
            <div className="num" style={{
                fontSize: 16, fontWeight: 600, color: 'var(--color-ink)',
            }}>
                {value === undefined || value === null ? '—' : money ? formatGel(value) : value.toFixed(0)}
            </div>
        </div>
    );
}

function initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?';
}

/** 1 сессия, 2 сессии, 5 сессий, 11 сессий, 21 сессия. */
function pluralizeSessions(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'сессия';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сессии';
    return 'сессий';
}
