import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import {
    ChevronLeft, ChevronRight, Loader2, Plus, Check, X, Calendar,
} from 'lucide-react';
import {
    format,
    startOfMonth, endOfMonth, addMonths, subMonths,
    startOfWeek, endOfWeek, addWeeks, subWeeks,
    startOfDay, endOfDay, addDays, subDays,
    isSameDay,
} from 'date-fns';
import { toast } from 'sonner';
import { parseUTC } from '../../utils/dateUtils';
import { crmApi, type CrmPaymentCreate, type CrmClient, type CrmSession } from '../../api/crm';
import { totalInGel } from '../../utils/currency';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { formatMoney, formatGel, formatDayMonth, formatMonthLabel, formatTime } from '../../utils/format';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';

/** «1 сессия / 2 сессии / 5 сессий». */
function sessionsWord(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'сессия';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сессии';
    return 'сессий';
}

type Period = 'day' | 'week' | 'month';

function getPeriodRange(date: Date, period: Period): { from: Date; to: Date } {
    if (period === 'day') return { from: startOfDay(date), to: endOfDay(date) };
    if (period === 'week') return { from: startOfWeek(date, { weekStartsOn: 1 }), to: endOfWeek(date, { weekStartsOn: 1 }) };
    return { from: startOfMonth(date), to: endOfMonth(date) };
}

function navigatePeriod(date: Date, period: Period, dir: 1 | -1): Date {
    if (period === 'day') return dir === 1 ? addDays(date, 1) : subDays(date, 1);
    if (period === 'week') return dir === 1 ? addWeeks(date, 1) : subWeeks(date, 1);
    return dir === 1 ? addMonths(date, 1) : subMonths(date, 1);
}

function formatPeriodLabel(date: Date, period: Period): string {
    if (period === 'day') return formatDayMonth(date, { withYear: 'auto' });
    if (period === 'week') {
        const { from, to } = getPeriodRange(date, 'week');
        return `${formatDayMonth(from)} – ${formatDayMonth(to, { withYear: 'auto' })}`;
    }
    return formatMonthLabel(date);
}

export function CrmFinances() {
        const navigate = useNavigate();
    const {
        payments, sessions, clients,
        fetchPayments, fetchSessions, fetchClients,
        createPayment, loading, error,
    } = useCrmStore();
    // Первый ответ ещё не пришёл — вместо «0» и «Платежей нет» скелетон (rule 8).
    const [loaded, setLoaded] = useState(false);

    const [period, setPeriod] = useState<Period>('month');
    const [anchor, setAnchor] = useState(new Date());
    const [showForm, setShowForm] = useState(false);
    const [allUnpaidSessions, setAllUnpaidSessions] = useState<CrmSession[]>([]);

    const { from, to } = getPeriodRange(anchor, period);
    const dateFrom = format(from, 'yyyy-MM-dd');
    const dateTo = format(to, 'yyyy-MM-dd');

    const viewAsSpecialistId = useCrmStore(s => s.viewAsSpecialistId);

    useEffect(() => { fetchClients(); }, [fetchClients]);
    useEffect(() => {
        Promise.all([
            fetchPayments({ dateFrom, dateTo }),
            fetchSessions({ dateFrom, dateTo }),
        ]).finally(() => setLoaded(true));
    }, [fetchPayments, fetchSessions, dateFrom, dateTo]);

    // Fetch ALL unpaid completed sessions (no date filter) for total debt calculation
    useEffect(() => {
        crmApi.getSessions({
            status: 'COMPLETED',
            specialistId: viewAsSpecialistId ?? undefined,
        }).then(all => {
            setAllUnpaidSessions(all.filter(s => !s.isPaid));
        }).catch(() => {});
    }, [viewAsSpecialistId, payments, sessions]); // refresh when payments/sessions change

    const clientMap = useMemo(() => {
        const map = new Map<string, CrmClient>();
        clients.forEach(c => map.set(c.id, c));
        return map;
    }, [clients]);

    const stats = useMemo(() => {
        // Revenue grouped by currency
        const revByCur: Record<string, number> = {};
        payments.forEach(p => {
            const client = clientMap.get(p.clientId);
            const cur = client?.currency || 'GEL';
            revByCur[cur] = (revByCur[cur] || 0) + p.amount;
        });

        // Total debt grouped by currency — uses ALL unpaid sessions (not filtered by period)
        const debtByCur: Record<string, number> = {};
        allUnpaidSessions.forEach(s => {
            const client = clientMap.get(s.clientId);
            if (!client || !client.isActive) return;
            const cur = client.currency || 'GEL';
            const price = (s.price != null && s.price > 0) ? s.price : (client.basePrice || 0);
            debtByCur[cur] = (debtByCur[cur] || 0) + price;
        });

        const held = sessions.filter(
            s => s.status !== 'CANCELLED_CLIENT' && s.status !== 'CANCELLED_THERAPIST'
        ).length;

        const formatMultiCur = (map: Record<string, number>) => {
            const entries = Object.entries(map).filter(([, v]) => v > 0);
            if (entries.length === 0) return formatGel(0);
            return entries.map(([cur, val]) => formatMoney(val, { currency: cur, fraction: 0 })).join(' · ');
        };

        const revenueGel = totalInGel(revByCur);
        const debtGel = totalInGel(debtByCur);
        const revEntries = Object.entries(revByCur).filter(([, v]) => v > 0);
        const debtEntries = Object.entries(debtByCur).filter(([, v]) => v > 0);
        const showRevEquiv = revEntries.length > 1 || (revEntries.length === 1 && revEntries[0][0] !== 'GEL');
        const showDebtEquiv = debtEntries.length > 1 || (debtEntries.length === 1 && debtEntries[0][0] !== 'GEL');

        return {
            revenueLabel: formatMultiCur(revByCur),
            debtLabel: formatMultiCur(debtByCur),
            revenueGel: showRevEquiv ? `≈ ${formatGel(revenueGel, { fraction: 0 })}` : null,
            debtGel: showDebtEquiv ? `≈ ${formatGel(debtGel, { fraction: 0 })}` : null,
            unpaidCount: allUnpaidSessions.length,
            totalPayments: payments.length,
            held,
        };
    }, [payments, sessions, allUnpaidSessions, clientMap]);

    const debtByClient = useMemo(() => {
        const map = new Map<string, { client: CrmClient; count: number; total: number }>();
        allUnpaidSessions
            .forEach(s => {
                const client = clientMap.get(s.clientId);
                if (!client || !client.isActive) return;
                const price = (s.price != null && s.price > 0) ? s.price : (client.basePrice || 0);
                const ex = map.get(s.clientId) || { client, count: 0, total: 0 };
                ex.count++;
                ex.total += price;
                map.set(s.clientId, ex);
            });
        return Array.from(map.values()).filter(v => v.total > 0).sort((a, b) => b.total - a.total);
    }, [allUnpaidSessions, clientMap]);

    const PERIODS: { id: Period; label: string }[] = [
        { id: 'day',   label: 'День' },
        { id: 'week',  label: 'Неделя' },
        { id: 'month', label: 'Месяц' },
    ];

    const isToday = period === 'day' && isSameDay(anchor, new Date());
    const isThisMonth = period === 'month' && format(anchor, 'yyyy-MM') === format(new Date(), 'yyyy-MM');

    return (

            <GridHouseCrmFinances
                period={period} setPeriod={setPeriod}
                anchor={anchor} setAnchor={setAnchor}
                showForm={showForm} setShowForm={setShowForm}
                stats={stats}
                debtByClient={debtByClient}
                payments={payments}
                clients={clients.filter(c => c.isActive)}
                clientMap={clientMap}
                loading={loading || !loaded}
                loadError={loaded && !loading ? error : null}
                onRetry={() => {
                    fetchClients();
                    fetchPayments({ dateFrom, dateTo });
                    fetchSessions({ dateFrom, dateTo });
                }}
                isToday={isToday}
                isThisMonth={isThisMonth}
                onCreatePayment={async (data: CrmPaymentCreate) => {
                    await createPayment(data);
                    setShowForm(false);
                    toast.success('Платёж добавлен');
                }}
                navigate={navigate}
            />
        );
}


// PaymentForm (старая форма до Grid House) нигде не рендерилась — удалена в wave 1.

// ============================================================================
// Grid House variant — Vignelli/Bierut CRM finance index
// ============================================================================

type GHFinProps = {
    period: Period; setPeriod: (p: Period) => void;
    anchor: Date; setAnchor: (fn: any) => void;
    showForm: boolean; setShowForm: (v: boolean) => void;
    stats: any;
    debtByClient: { client: CrmClient; count: number; total: number }[];
    payments: any[];
    clients: CrmClient[];
    clientMap: Map<string, CrmClient>;
    loading: boolean;
    loadError: string | null;
    onRetry: () => void;
    isToday: boolean;
    isThisMonth: boolean;
    onCreatePayment: (data: CrmPaymentCreate) => Promise<void>;
    navigate: (path: string) => void;
};

function GridHouseCrmFinances(p: GHFinProps) {
    const eyebrow: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60 };
    const periods: { id: Period; label: string }[] = [
        { id: 'day', label: 'День' },
        { id: 'week', label: 'Неделя' },
        { id: 'month', label: 'Месяц' },
    ];

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, color: GH.ink, fontFamily: GH_SANS }}>
            <div style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(16px, 4vw, 48px)' }}>
                {/* HEAD */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 20, borderBottom: `2px solid ${GH.ink}`, paddingBottom: 32, marginBottom: 40 }}>
                    <div>
                        <div style={{ ...eyebrow, marginBottom: 12 }}>Раздел · Финансы</div>
                        <h1 style={{ fontFamily: GH_SANS, fontSize: 'clamp(36px, 4.5vw, 56px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 0.95, margin: 0 }}>
                            Платежи и долги.
                        </h1>
                    </div>
                    <button
                        onClick={() => p.setShowForm(true)}
                        style={{
                            fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                            background: GH.ink, color: GH.paper, border: `1px solid ${GH.ink}`, padding: '14px 22px', cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 8,
                        }}
                    >
                        <Plus size={12} aria-hidden="true" />
                        Новый платёж
                    </button>
                </div>

                {/* PERIOD BAR */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20, marginBottom: 40, paddingBottom: 16, borderBottom: `1px solid ${GH.ink10}` }}>
                    <div style={{ display: 'flex', border: `1px solid ${GH.ink10}` }}>
                        {periods.map(pp => {
                            const active = p.period === pp.id;
                            return (
                                <button
                                    key={pp.id}
                                    onClick={() => p.setPeriod(pp.id)}
                                    style={{
                                        fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                                        padding: '10px 16px',
                                        background: active ? GH.ink : 'transparent',
                                        color: active ? GH.paper : GH.ink,
                                        border: 'none',
                                        borderRight: `1px solid ${active ? GH.paper : GH.ink10}`,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {pp.label}
                                </button>
                            );
                        })}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                            onClick={() => p.setAnchor((d: Date) => navigatePeriod(d, p.period, -1))}
                            aria-label="Предыдущий период"
                            style={{ width: 32, height: 32, border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <ChevronLeft size={14} />
                        </button>
                        <span style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', minWidth: 200, textAlign: 'center' }}>
                            {formatPeriodLabel(p.anchor, p.period)}
                        </span>
                        <button
                            onClick={() => p.setAnchor((d: Date) => navigatePeriod(d, p.period, 1))}
                            aria-label="Следующий период"
                            style={{ width: 32, height: 32, border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <ChevronRight size={14} />
                        </button>
                    </div>

                    {!p.isToday && !p.isThisMonth && (
                        <button
                            onClick={() => p.setAnchor(new Date())}
                            style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'transparent', color: GH.ink, border: `1px solid ${GH.ink10}`, padding: '8px 14px', cursor: 'pointer' }}
                        >
                            <Calendar size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                            Сейчас
                        </button>
                    )}
                </div>

                {p.loadError && (
                    <ErrorBar message="Не удалось загрузить финансы" onRetry={p.onRetry} retrying={p.loading} className="mb-6" />
                )}

                {/* KPI strip — auto-fit columns: 4-up на десктопе, 2-up на
                    узком mobile (≤~600px). Раньше было `repeat(4, 1fr)`,
                    из-за чего на телефоне колонки были по ~80px и числа вроде
                    "GEL · 14500 RUB · 60 USDT" складывались вертикально и
                    плохо читались. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', borderTop: `1px solid ${GH.ink10}`, borderBottom: `1px solid ${GH.ink10}`, marginBottom: 40 }}>
                    {[
                        { label: 'Получено', value: p.stats.revenueLabel, sub: p.stats.revenueGel },
                        { label: 'Общий долг', value: p.stats.debtLabel, sub: `${p.stats.unpaidCount} ${sessionsWord(p.stats.unpaidCount)}${p.stats.debtGel ? ' · ' + p.stats.debtGel : ''}`, danger: p.stats.unpaidCount > 0 },
                        { label: 'Платежей', value: String(p.stats.totalPayments), sub: null },
                        { label: 'Сессий', value: String(p.stats.held), sub: null },
                    ].map((k, i) => (
                        <div key={k.label} style={{ padding: '20px 16px', borderLeft: i > 0 ? `1px solid ${GH.ink10}` : 'none', minWidth: 0 }}>
                            <div style={{ ...eyebrow, marginBottom: 10 }}>{k.label}</div>
                            {p.loading && !p.payments.length ? (
                                <Skeleton height={28} width="70%" radius={0} />
                            ) : (
                                <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(18px, 2.6vw, 32px)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: k.danger ? GH.danger : GH.ink, wordBreak: 'break-word' }}>
                                    {k.value}
                                </div>
                            )}
                            {k.sub && !(p.loading && !p.payments.length) && <div style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', color: GH.ink60, marginTop: 8, textTransform: 'uppercase', wordBreak: 'break-word' }}>{k.sub}</div>}
                        </div>
                    ))}
                </div>

                {/* New Payment Form */}
                {p.showForm && (
                    <div style={{ border: `2px solid ${GH.ink}`, padding: 28, marginBottom: 40 }}>
                        <GHPaymentForm
                            clients={p.clients}
                            onSave={p.onCreatePayment}
                            onCancel={() => p.setShowForm(false)}
                        />
                    </div>
                )}

                {/* Debt by client */}
                {p.debtByClient.length > 0 && (
                    <section style={{ marginBottom: 40 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 12, marginBottom: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
                                <span style={{ ...eyebrow, color: GH.danger }}>01 · Задолженности</span>
                                <h2 style={{ fontFamily: GH_SANS, fontSize: 'clamp(22px, 2.4vw, 30px)', fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }}>
                                    По клиентам.
                                </h2>
                            </div>
                            <span style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60 }}>
                                {p.debtByClient.length}
                            </span>
                        </div>
                        <div>
                            {p.debtByClient.map(({ client, count, total }, i) => (
                                // Раньше grid с `60px 1fr 100px 160px` фиксированной
                                // суммой ~336px не оставлял места имени на узком
                                // экране, а сумма "2100 GEL" на правом краю
                                // обрезалась до "2100 GE". Сейчас flex с
                                // wrap'ом: имя гибкое, сумма всегда видна
                                // справа на десктопе или в новой строке снизу
                                // на узком экране.
                                <div
                                    key={client.id}
                                    onClick={() => p.navigate(`/crm/clients/${client.id}`)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: '8px 14px',
                                        padding: '14px 0',
                                        borderBottom: `1px solid ${GH.ink10}`,
                                        cursor: 'pointer',
                                    }}
                                >
                                    <span style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60, minWidth: 28 }}>
                                        {String(i + 1).padStart(2, '0')}
                                    </span>
                                    <div style={{ fontFamily: GH_SANS, fontSize: 15, fontWeight: 600, color: GH.ink, flex: '1 1 140px', minWidth: 0, wordBreak: 'break-word' }}>{client.name}</div>
                                    <div style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, whiteSpace: 'nowrap' }}>
                                        {count} {sessionsWord(count)}
                                    </div>
                                    <div style={{ fontFamily: GH_MONO, fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: GH.danger, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                                        {formatMoney(total, { currency: client.currency })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Payments list */}
                <section style={{ marginBottom: 40 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 12, marginBottom: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
                            <span style={{ ...eyebrow }}>{p.debtByClient.length > 0 ? '02' : '01'} · Журнал</span>
                            <h2 style={{ fontFamily: GH_SANS, fontSize: 'clamp(22px, 2.4vw, 30px)', fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }}>
                                Платежи за период.
                            </h2>
                        </div>
                        <span style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60 }}>
                            {p.payments.length}
                        </span>
                    </div>

                    {p.loading && !p.payments.length ? (
                        <div role="status" aria-busy="true" style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <span className="sr-only">Загружаем платежи…</span>
                            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={20} radius={0} />)}
                        </div>
                    ) : p.payments.length === 0 ? (
                        p.loadError ? null : (
                            <EmptyState
                                title="За этот период платежей нет"
                                hint="Выберите другой период или добавьте платёж."
                                action={{ label: 'Новый платёж', onClick: () => p.setShowForm(true) }}
                            />
                        )
                    ) : (
                        <div>
                            {p.payments.map((pay, i) => {
                                const client = p.clientMap.get(pay.clientId);
                                return (
                                    // Тот же fix что и для debt-rows: flex
                                    // вместо фиксированного 60+1fr+200+140 grid,
                                    // который на мобильном съедал имя клиента
                                    // и обрезал сумму справа.
                                    <div
                                        key={pay.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            flexWrap: 'wrap',
                                            gap: '8px 14px',
                                            padding: '14px 0',
                                            borderBottom: `1px solid ${GH.ink10}`,
                                        }}
                                    >
                                        <span style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60, minWidth: 32 }}>
                                            {String(i + 1).padStart(3, '0')}
                                        </span>
                                        <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                            <div style={{ fontFamily: GH_SANS, fontSize: 15, fontWeight: 600, wordBreak: 'break-word' }}>{client?.name || 'Неизвестный'}</div>
                                            {pay.account && (
                                                <div style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', color: GH.ink60, marginTop: 3, textTransform: 'uppercase' }}>
                                                    {pay.account}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60, whiteSpace: 'nowrap' }}>
                                            {formatDayMonth(parseUTC(pay.date), { withYear: 'auto' })} · {formatTime(parseUTC(pay.date))}
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: GH.ink, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                                            {formatMoney(pay.amount, { currency: pay.currency, sign: true })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* Footer */}
                <div style={{ borderTop: `2px solid ${GH.ink}`, paddingTop: 20, marginTop: 32, display: 'flex', justifyContent: 'space-between', ...eyebrow }}>
                    <span>Unbox · CRM · Финансы · {new Date().getFullYear()}</span>
                    <span>{formatPeriodLabel(p.anchor, p.period)}</span>
                </div>
            </div>
        </div>
    );
}

function GHPaymentForm({ clients, onSave, onCancel }: {
    clients: CrmClient[];
    onSave: (data: CrmPaymentCreate) => Promise<void>;
    onCancel: () => void;
}) {
    const [clientId, setClientId] = useState('');
    const [amount, setAmount] = useState('');
    const [account, setAccount] = useState('');
    const [saving, setSaving] = useState(false);

    const selectedClient = clients.find(c => c.id === clientId);

    useEffect(() => {
        if (selectedClient) {
            setAmount(String(selectedClient.basePrice));
            setAccount(selectedClient.defaultAccount || '');
        }
    }, [selectedClient]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!clientId || !amount) return;
        setSaving(true);
        try {
            // 07.09: у счёта может быть своя валюта (напр. Mono → UAH) —
            // она важнее валюты клиента.
            const accCurrency = useCrmStore.getState().paymentAccounts.find(a => a.id === account)?.currency;
            await onSave({ clientId, amount: Number(amount), currency: accCurrency || selectedClient?.currency, account: account || undefined });
        } catch (err: any) {
            toast.error(err.message || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    const labelStyle: React.CSSProperties = { display: 'block', fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 };
    const hairlineInput: React.CSSProperties = {
        fontFamily: GH_SANS, fontSize: 15, background: 'transparent',
        border: 'none', borderBottom: `1px solid ${GH.ink10}`, padding: '10px 0',
        outline: 'none', width: '100%', color: GH.ink,
    };

    return (
        <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 16, marginBottom: 24 }}>
                <div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 6 }}>
                        Действие · Новый платёж
                    </div>
                    <h3 style={{ fontFamily: GH_SANS, fontSize: 28, fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }}>
                        Добавить платёж.
                    </h3>
                </div>
                <button
                    type="button"
                    onClick={onCancel}
                    aria-label="Закрыть"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60, padding: 4 }}
                >
                    <X size={20} />
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24, marginBottom: 24 }}>
                <div>
                    <label style={labelStyle}>Клиент *</label>
                    <select
                        value={clientId}
                        onChange={e => setClientId(e.target.value)}
                        required
                        style={hairlineInput}
                    >
                        <option value="">Выберите клиента</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div>
                    <label style={labelStyle}>Сумма *</label>
                    <input
                        type="number"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        required
                        style={{ ...hairlineInput, fontFamily: GH_MONO, fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    />
                </div>
                <div>
                    <label style={labelStyle}>Счёт</label>
                    <input
                        type="text"
                        value={account}
                        onChange={e => setAccount(e.target.value)}
                        placeholder="cash / bank / transfer"
                        style={hairlineInput}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: 0, borderTop: `2px solid ${GH.ink}`, paddingTop: 20 }}>
                <button
                    type="button"
                    onClick={onCancel}
                    style={{
                        flex: 1, fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                        background: 'transparent', color: GH.ink, border: `1px solid ${GH.ink10}`, padding: '14px 20px', cursor: 'pointer',
                    }}
                >
                    Отмена
                </button>
                <button
                    type="submit"
                    disabled={saving || !clientId || !amount}
                    style={{
                        flex: 1, fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                        background: GH.ink, color: GH.paper, border: `1px solid ${GH.ink}`, padding: '14px 20px',
                        opacity: (saving || !clientId || !amount) ? 0.4 : 1,
                        cursor: (saving || !clientId || !amount) ? 'not-allowed' : 'pointer',
                    }}
                >
                    {saving ? <Loader2 className="animate-spin inline" size={12} style={{ marginRight: 8, verticalAlign: 'middle' }} /> : <Check size={12} style={{ marginRight: 8, verticalAlign: 'middle' }} />}
                    Добавить
                </button>
            </div>
        </form>
    );
}
