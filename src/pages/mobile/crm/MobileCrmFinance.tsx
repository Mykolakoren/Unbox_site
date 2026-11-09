import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ChevronRight, ChevronLeft } from 'lucide-react';
import { crmApi, type CrmDashboard, type CrmSession, type CrmClient } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { UnpaidSessionsSheet } from '../../../components/crm/UnpaidSessionsSheet';
import { earnedByCurrency, isBillableStatus } from '../../../utils/sessionMoney';
import { totalInGel } from '../../../utils/currency';
import { useCrmDataVersion } from './crmDataVersion';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';
import { formatMoney, formatMonthLabel } from '../../../utils/format';
import { ListAvatar, ListGroup, ListRow } from '../../../components/ui/ListRow';
import { Money } from '../../../components/ui/Money';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { SummaryCard } from '../../../components/ui/SummaryCard';
import { addDaysYmd, tbilisiToday, utcNaiveToTbilisi } from '../../../utils/crmNextSession';
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
    const clients = useCrmStore(s => s.clients);
    const fetchClients = useCrmStore(s => s.fetchClients);
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    // Ревью п. 13: тап по должнику — сразу список неоплаченных (оплата в 1 тап).
    const [debtor, setDebtor] = useState<CrmClient | null>(null);
    // Решение владельца 5: «Заработано за месяц» — проведённые и оплаченные сессии
    // месяца по дате сессии (как «Заработано» на компьютере, earnedByCurrency).
    const [monthSessions, setMonthSessions] = useState<{ month: string; list: CrmSession[] } | null>(null);
    useEffect(() => { fetchClients(false, true).catch(() => {}); }, [fetchClients, dataVersion]);

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

    useEffect(() => {
        let alive = true;
        const from = `${monthParam}-01`;
        const [y, m] = monthParam.split('-').map(Number);
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const to = `${monthParam}-${String(last).padStart(2, '0')}`;
        // Сервер сравнивает в UTC — берём день запаса и оставляем дни месяца по Батуми.
        crmApi.getSessions({ dateFrom: addDaysYmd(from, -1), dateTo: to })
            .then(list => {
                if (!alive) return;
                setMonthSessions({
                    month: monthParam,
                    list: list.filter(s => (utcNaiveToTbilisi(s.date)?.date ?? '').startsWith(monthParam)),
                });
            })
            .catch(() => { if (alive) setMonthSessions(null); });
        return () => { alive = false; };
    }, [monthParam, dataVersion]);

    const earned = useMemo(() => {
        if (!monthSessions || monthSessions.month !== monthParam) return null;
        const byId = new Map(clients.map(c => [c.id, c]));
        const byCur = earnedByCurrency(monthSessions.list, id => byId.get(id), s => isBillableStatus(s.status) && !!s.isPaid);
        return { gel: Math.round(totalInGel(byCur) * 100) / 100, byCur };
    }, [monthSessions, monthParam, clients]);

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

    const monthLabel = formatMonthLabel(`${monthParam}-15`, { capitalize: true });
    const cell = (value: number | undefined, isLoading: boolean, tone?: 'debt') =>
        isLoading ? '…' : value === undefined || value === null ? '—'
            : <Money value={value} tone={tone} />;

    return (
        <div style={{ paddingBottom: 90 }}>
            <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />
            <MobilePageHeader variant="large" title="Финансы" />

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
            {failed && !loading && (
                <ErrorBar
                    message="Не удалось загрузить финансы"
                    onRetry={() => load()}
                />
            )}

            {/* ── Месяц ─────────────────────────────────────────────── */}
            <section aria-labelledby="crm-fin-month" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 id="crm-fin-month" style={sectionTitle}>Месяц</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button
                        variant="secondary"
                        icon={<ChevronLeft size={20} aria-hidden="true" />}
                        aria-label="Предыдущий месяц"
                        onClick={() => setMonthOffset(o => o - 1)}
                    />
                    <div style={{
                        flex: 1, textAlign: 'center', minHeight: 44,
                        fontSize: 16, fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                        <Calendar size={16} color={COLOR.ink60} aria-hidden="true" />
                        {monthLabel}
                    </div>
                    {/* Недоступная «вперёд» — та же secondary, бледнее (не серая заливка). */}
                    <Button
                        variant="secondary"
                        icon={<ChevronRight size={20} aria-hidden="true" />}
                        aria-label="Следующий месяц"
                        disabled={monthOffset >= 0}
                        onClick={() => setMonthOffset(o => o + 1)}
                        style={monthOffset >= 0 ? { background: 'var(--color-card)', opacity: 0.4 } : undefined}
                    />
                </div>
                {/* 09.11 фаза 3: итог месяца — общий SummaryCard (одно крупное число + ячейки). */}
                <SummaryCard
                    label="Заработано за месяц"
                    value={earned ? <Money value={earned.gel} /> : (!failed ? '…' : '—')}
                    caption={<>
                        {byCurrency(earned?.byCur) && <span className="num-inline" style={{ display: 'block' }}>{byCurrency(earned?.byCur)}</span>}
                        Проведённые и оплаченные сессии этого месяца — по дате сессии
                    </>}
                    stats={[
                        { label: 'Касса · с долгами', value: cell(dashboard?.revenueThisMonth, pending) },
                        { label: 'Сессий за месяц', value: pending ? '…' : <span className="num">{dashboard?.sessionsThisMonth ?? '—'}</span> },
                    ]}
                />
                <p style={{ margin: 0, padding: '0 4px', fontSize: 12, color: 'var(--color-ink-60)', lineHeight: 1.45 }}>
                    Касса — все оплаты за месяц, вместе с оплатой старых долгов
                    {byCurrency(dashboard?.revenueByCurrency) ? ` (${byCurrency(dashboard?.revenueByCurrency)})` : ''}.
                </p>
            </section>

            {/* ── Долги сейчас — не зависят от месяца ───────────────── */}
            <section aria-labelledby="crm-fin-debts" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 id="crm-fin-debts" style={sectionTitle}>Долги сейчас</h2>
                <SummaryCard
                    stats={[
                        { label: 'Долг всего', value: cell(dashboard?.totalActiveDebt, pending, 'debt') },
                        { label: 'Сессий без оплаты', value: pending ? '…' : <span className="num">{dashboard?.unpaidSessions ?? '—'}</span> },
                    ]}
                />
                {byCurrency(dashboard?.debtByCurrency) && (
                    <p style={{ margin: 0, padding: '0 4px', fontSize: 12, color: 'var(--color-ink-60)' }} className="num-inline">
                        {byCurrency(dashboard?.debtByCurrency)}
                    </p>
                )}
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
                    // Дизайн-ревью п. 17: аватары нейтральные, красным — только суммы.
                    <ListGroup aria-label="Должники">
                        {debts.map(d => (
                            <ListRow
                                key={d.clientId}
                                lead={<ListAvatar name={d.clientName} />}
                                title={d.clientName}
                                subtitle={<>
                                    Без оплаты: {d.unpaidSessionsCount} {pluralizeSessions(d.unpaidSessionsCount)}
                                    {(d.partialSessionsCount ?? 0) > 0 && (
                                        d.unpaidSessionsCount === 1 ? ', оплачена частично'
                                            : `, ${d.partialSessionsCount === d.unpaidSessionsCount ? 'все' : `из них ${d.partialSessionsCount}`} частично`
                                    )}
                                </>}
                                trail={<Money value={d.totalDebt} currency={d.currency || 'GEL'} tone="debt" />}
                                onClick={() => {
                                    const c = clients.find(x => x.id === d.clientId);
                                    if (c && !viewingOther) setDebtor(c);
                                    else navigate(`/m/crm/clients/${d.clientId}`);
                                }}
                                aria-label={`${d.clientName}: долг ${formatMoney(d.totalDebt, { currency: d.currency || 'GEL' })} — отметить оплату`}
                                action={(
                                    <Button
                                        variant="quiet"
                                        size="sm"
                                        icon={<ChevronRight size={18} aria-hidden="true" />}
                                        onClick={() => navigate(`/m/crm/clients/${d.clientId}`)}
                                        aria-label={`Карточка клиента: ${d.clientName}`}
                                        style={{ color: 'var(--color-ink-60)' }}
                                    />
                                )}
                            />
                        ))}
                    </ListGroup>
                )}
            </section>
            </div>
            {debtor && (
                <UnpaidSessionsSheet
                    open
                    onClose={() => setDebtor(null)}
                    client={debtor}
                    onChanged={() => { load(); }}
                />
            )}
        </div>
    );
}

const sectionTitle: React.CSSProperties = {
    margin: 0, padding: '0 4px', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: 'var(--color-ink-60)',
};

/** 1 сессия, 2 сессии, 5 сессий, 11 сессий, 21 сессия. */
function pluralizeSessions(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'сессия';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сессии';
    return 'сессий';
}
