import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ChevronRight, ChevronLeft } from 'lucide-react';
import { crmApi, type CrmDashboard } from '../../../api/crm';
import { useCrmDataVersion } from './crmDataVersion';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';
import { formatGel, formatMoney, formatMonthLabel } from '../../../utils/format';
import { tbilisiToday } from '../../../utils/crmNextSession';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { usePullToRefresh } from '../usePullToRefresh';
import { PullIndicator } from '../PullIndicator';

/** Прокручивается документ, а не <main> оболочки — его и проверяем. */
const docScroller = () => (document.scrollingElement as HTMLElement | null);

/**
 * Psy-CRM на телефоне — «Финансы».
 *
 * Волна 3 (G6-16, решение В1):
 *   - блок месяца: «Касса · с долгами» — все оплаты, датированные месяцем
 *     (в т.ч. оплата старых долгов), и число сессий месяца. «Средний чек»
 *     убран: сервер его не считает, всегда было «—»;
 *   - «Долги сейчас» — отдельный раздел ВНЕ выбора месяца: общий долг,
 *     сколько сессий без оплаты, список должников (тап — карточка клиента,
 *     там «Отметить оплату»). Листание месяцев их не меняет — так честно;
 *   - сбой загрузки — ErrorBar и «—», не «0 ₾» и не «Нет задолженностей»;
 *   - потянуть вниз — обновить.
 * Месяц считается по Батуми.
 */
export function MobileCrmFinance() {
    const navigate = useNavigate();
    const [monthOffset, setMonthOffset] = useState(0);
    // Данные храним вместе с месяцем, за который они пришли: при смене
    // месяца цифры прошлого не показываются под новым заголовком.
    const [loaded, setLoaded] = useState<{ month: string; data: CrmDashboard } | null>(null);
    const [loading, setLoading] = useState(true);
    // Сбой загрузки — отдельное состояние. Раньше при ошибке экран рисовал
    // «0 ₾» и «Нет задолженностей», и казалось, что все расплатились.
    const [failed, setFailed] = useState(false);
    const dataVersion = useCrmDataVersion();
    useDocumentTitle('Финансы · Psy-CRM');

    // Месяц по Батуми: «2026-10» + сдвиг.
    const monthParam = useMemo(() => {
        const [y, m] = tbilisiToday().split('-').map(Number);
        const idx = y * 12 + (m - 1) + monthOffset;
        return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
    }, [monthOffset]);

    // Номер запроса: ответ за прошлый месяц не перезапишет выбранный.
    const reqSeq = useRef(0);
    const load = useCallback(async () => {
        const seq = ++reqSeq.current;
        setLoading(true);
        setFailed(false);
        try {
            const d = await crmApi.getDashboard(undefined, monthParam);
            if (seq === reqSeq.current) setLoaded({ month: monthParam, data: d });
        } catch {
            if (seq === reqSeq.current) setFailed(true);
        } finally {
            if (seq === reqSeq.current) setLoading(false);
        }
    }, [monthParam]);

    useEffect(() => { load(); }, [load, dataVersion]);

    const [refreshing, setRefreshing] = useState(false);
    const pull = usePullToRefresh(async () => {
        setRefreshing(true);
        try { await load(); } finally { setRefreshing(false); }
    }, 70, docScroller);

    const dashboard = !failed && loaded?.month === monthParam ? loaded.data : null;
    const pending = loading && !dashboard;

    const debts = useMemo(() => {
        if (!dashboard?.debtByClient) return [];
        return [...dashboard.debtByClient].sort((a, b) => b.totalDebt - a.totalDebt);
    }, [dashboard]);

    const byCurrency = (m?: Record<string, number>) => {
        const entries = Object.entries(m ?? {}).filter(([, v]) => v > 0);
        return entries.length > 1 ? entries.map(([cur, v]) => formatMoney(v, { currency: cur })).join(' + ') : '';
    };

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />
            <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: '2px 2px 12px' }}>
                Финансы
            </h1>

            {failed && !loading && (
                <ErrorBar
                    message="Не удалось загрузить финансы"
                    onRetry={() => load()}
                    className="mb-3"
                />
            )}

            {/* ── Месяц ─────────────────────────────────────────────── */}
            <section aria-labelledby="crm-fin-month" style={{ marginBottom: 20 }}>
                <h2 id="crm-fin-month" style={sectionTitle}>Месяц</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
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
                        {formatMonthLabel(`${monthParam}-15`, { capitalize: true })}
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
                <div style={totalsCard}>
                    <TotalCell
                        label="Касса · с долгами"
                        hint="Все оплаты за месяц, вместе с оплатой старых долгов"
                        value={dashboard?.revenueThisMonth}
                        extra={byCurrency(dashboard?.revenueByCurrency)}
                        loading={pending}
                        money
                    />
                    <TotalCell
                        label="Сессий за месяц"
                        value={dashboard?.sessionsThisMonth}
                        loading={pending}
                    />
                </div>
            </section>

            {/* ── Долги сейчас — не зависят от месяца ───────────────── */}
            <section aria-labelledby="crm-fin-debts">
                <h2 id="crm-fin-debts" style={sectionTitle}>Долги сейчас</h2>
                <div style={{ ...totalsCard, marginBottom: 10 }}>
                    <TotalCell
                        label="Долг всего"
                        value={dashboard?.totalActiveDebt}
                        extra={byCurrency(dashboard?.debtByCurrency)}
                        loading={pending}
                        money
                        warning
                    />
                    <TotalCell
                        label="Сессий без оплаты"
                        value={dashboard?.unpaidSessions}
                        loading={pending}
                    />
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
                                aria-label={`${d.clientName}: долг ${formatMoney(d.totalDebt, { currency: d.currency || 'GEL' })} — открыть карточку`}
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
                                        Без оплаты: {d.unpaidSessionsCount} {pluralizeSessions(d.unpaidSessionsCount)}
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
            </section>
        </div>
    );
}

function TotalCell({
    label, hint, value, extra, loading, warning, money,
}: {
    label: string;
    hint?: string;
    value?: number;
    extra?: string;
    loading?: boolean;
    warning?: boolean;
    money?: boolean;
}) {
    const shown = loading ? '…'
        : value === undefined || value === null ? '—'
        : money ? formatGel(value) : String(Math.round(value));
    return (
        <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink-60)', marginBottom: 4 }}>
                {label}
            </div>
            <div className="num" style={{
                fontSize: 20,
                fontWeight: 600,
                color: warning && (value ?? 0) > 0 ? 'var(--status-danger-fg)' : 'var(--color-ink)',
                lineHeight: 1.1,
            }}>
                {shown}
            </div>
            {extra && !loading && (
                <div className="num" style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 4 }}>{extra}</div>
            )}
            {hint && (
                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 4, lineHeight: 1.35 }}>{hint}</div>
            )}
        </div>
    );
}

const sectionTitle: React.CSSProperties = {
    margin: '0 2px 8px', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: 'var(--color-ink-60)',
};

const totalsCard: React.CSSProperties = {
    background: 'var(--color-sunken)',
    color: 'var(--color-ink)',
    borderRadius: 14,
    padding: '14px 16px',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
};

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
