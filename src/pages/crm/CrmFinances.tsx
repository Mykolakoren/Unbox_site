import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import {
    ChevronLeft, ChevronRight, Loader2, Plus, Check, X, Calendar, Send,
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
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { UnpaidSessionsSheet } from '../../components/crm/UnpaidSessionsSheet';
import { AccountSelect } from '../../components/crm/AccountSelect';
import { accountLabel as accountLabelOf, defaultPaymentAccount, matchAccount } from '../../utils/paymentAccounts';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { ruPlural } from '../../utils/plural';
import { sessionDebt, sessionDebtIn } from '../../utils/sessionMoney';
import { telegramHref } from '../../utils/contactLinks';

/** «1 сессия / 2 сессии / 5 сессий». */
function sessionsWord(n: number): string {
    return ruPlural(n, ['сессия', 'сессии', 'сессий']);
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
    // Долги не загрузились ≠ долгов нет (X5-states-speed-M3): раньше сбой
    // молча показывал «0 ₾» и пустой список должников.
    const [debtLoadFailed, setDebtLoadFailed] = useState(false);
    const [debtTick, setDebtTick] = useState(0);
    const [unpaidFor, setUnpaidFor] = useState<CrmClient | null>(null);

    useDocumentTitle('Финансы · Psy-CRM');

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
            setDebtLoadFailed(false);
        }).catch(() => setDebtLoadFailed(true));
    }, [viewAsSpecialistId, payments, sessions, debtTick]); // refresh when payments/sessions change

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
            // Валюта ПЛАТЕЖА, а не клиента (как в «Кассе» CrmSessions): платёж в USDT
            // у клиента с гривнами иначе показывался бы как гривны.
            const cur = (p.currency || client?.currency || 'GEL').toUpperCase();
            revByCur[cur] = (revByCur[cur] || 0) + p.amount;
        });

        // Total debt grouped by currency — uses ALL unpaid sessions (not filtered by period)
        const debtByCur: Record<string, number> = {};
        // Долг — остаток по сессии (цена минус внесённое), а не вся цена.
        allUnpaidSessions.forEach(s => {
            const client = clientMap.get(s.clientId);
            if (!client || !client.isActive) return;
            const d = sessionDebt(s, client);
            debtByCur[d.currency] = (debtByCur[d.currency] || 0) + d.amount;
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
                // В валюте клиента: у клиента одна строка «Долг N», сессии могут быть в разных валютах.
                const owed = sessionDebtIn(s, client, client.currency || 'GEL');
                const ex = map.get(s.clientId) || { client, count: 0, total: 0 };
                ex.count++;
                ex.total += owed;
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
            <>
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
                    setDebtTick(t => t + 1);
                }}
                debtLoadFailed={debtLoadFailed}
                canWrite={!viewAsSpecialistId}
                onMarkPaid={setUnpaidFor}
                isToday={isToday}
                isThisMonth={isThisMonth}
                onCreatePayment={async (data: CrmPaymentCreate) => {
                    await createPayment(data);
                    setShowForm(false);
                    toast.success('Платёж добавлен');
                }}
                navigate={navigate}
            />
            {unpaidFor && (
                <UnpaidSessionsSheet
                    open={!!unpaidFor}
                    onClose={() => setUnpaidFor(null)}
                    client={unpaidFor}
                    // Шторка пишет через crmApi и стор не обновляет — перечитываем
                    // платежи и сессии периода, за ними долги (эффект выше).
                    onChanged={() => {
                        fetchPayments({ dateFrom, dateTo });
                        fetchSessions({ dateFrom, dateTo });
                        setDebtTick(t => t + 1);
                    }}
                />
            )}
            </>
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
    debtLoadFailed: boolean;
    /** false — «просмотр как специалист»: записывать нельзя. */
    canWrite: boolean;
    onMarkPaid: (client: CrmClient) => void;
};

function GridHouseCrmFinances(p: GHFinProps) {
    const eyebrow: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60 };
    const h2: React.CSSProperties = { fontFamily: GH_SANS, fontSize: 20, fontWeight: 600, margin: 0 };
    const periods: { id: Period; label: string }[] = [
        { id: 'day', label: 'День' },
        { id: 'week', label: 'Неделя' },
        { id: 'month', label: 'Месяц' },
    ];
    const accountLabel = (id?: string) =>
        id ? accountLabelOf(id, useCrmStore.getState().paymentAccounts) : '';
    const kpiLoading = p.loading && !p.payments.length;

    return (
        <div style={{ background: GH.paper, color: GH.ink, fontFamily: GH_SANS }}>
            <PageHeader
                title="Финансы"
                description="Платежи за период и долги клиентов"
                actions={p.canWrite && (
                    // inline-flex у общей кнопки: «+» больше не висит над текстом (G5-20).
                    <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => p.setShowForm(true)}>
                        Новый платёж
                    </Button>
                )}
            />

            {/* PERIOD BAR */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${GH.ink10}` }}>
                <div role="group" aria-label="Период" style={{ display: 'flex', border: `1px solid ${GH.ink10}` }}>
                    {periods.map(pp => {
                        const active = p.period === pp.id;
                        return (
                            <button
                                key={pp.id}
                                onClick={() => p.setPeriod(pp.id)}
                                aria-pressed={active}
                                style={{
                                    fontFamily: GH_SANS, fontSize: 14, fontWeight: active ? 600 : 400,
                                    padding: '0 16px', minHeight: 36,
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
                        style={{ width: 36, height: 36, border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span aria-live="polite" style={{ fontSize: 15, fontWeight: 600, minWidth: 200, textAlign: 'center' }}>
                        {formatPeriodLabel(p.anchor, p.period)}
                    </span>
                    <button
                        onClick={() => p.setAnchor((d: Date) => navigatePeriod(d, p.period, 1))}
                        aria-label="Следующий период"
                        style={{ width: 36, height: 36, border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>

                {!p.isToday && !p.isThisMonth && (
                    <Button variant="quiet" size="compact" icon={<Calendar size={14} aria-hidden="true" />} onClick={() => p.setAnchor(new Date())}>
                        Сейчас
                    </Button>
                )}
            </div>

            {p.loadError && (
                <ErrorBar message="Не удалось загрузить финансы" onRetry={p.onRetry} retrying={p.loading} className="mb-6" />
            )}

            {/* KPI — один ряд. «Касса · с долгами» — все платежи периода, включая
                оплату прошлых долгов (решение В1: одно слово на всех экранах). */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', borderTop: `1px solid ${GH.ink10}`, borderBottom: `1px solid ${GH.ink10}`, marginBottom: 32 }}>
                {[
                    { label: 'Касса · с долгами', value: p.stats.revenueLabel, sub: p.stats.revenueGel, hint: 'Все платежи за период, в том числе оплата прошлых долгов' },
                    { label: 'Долги сейчас', value: p.debtLoadFailed ? '—' : p.stats.debtLabel, sub: p.debtLoadFailed ? 'не загрузились' : `${p.stats.unpaidCount} ${sessionsWord(p.stats.unpaidCount)}${p.stats.debtGel ? ' · ' + p.stats.debtGel : ''}`, danger: !p.debtLoadFailed && p.stats.unpaidCount > 0, hint: 'За всё время, не зависит от периода' },
                    { label: 'Платежей', value: String(p.stats.totalPayments), sub: null },
                    { label: 'Сессий', value: String(p.stats.held), sub: null },
                ].map((k, i) => (
                    <div key={k.label} title={k.hint} style={{ padding: '16px', borderLeft: i > 0 ? `1px solid ${GH.ink10}` : 'none', minWidth: 0 }}>
                        <div style={{ ...eyebrow, marginBottom: 8 }}>{k.label}</div>
                        {kpiLoading ? (
                            <Skeleton height={28} width="70%" radius={0} />
                        ) : (
                            <div style={{ fontFamily: GH_MONO, fontSize: 24, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, color: k.danger ? GH.danger : GH.ink, wordBreak: 'break-word' }}>
                                {k.value}
                            </div>
                        )}
                        {k.sub && !kpiLoading && <div style={{ fontSize: 13, color: GH.ink60, marginTop: 6, wordBreak: 'break-word' }}>{k.sub}</div>}
                    </div>
                ))}
            </div>

            {/* New Payment Form */}
            {p.showForm && p.canWrite && (
                <div style={{ border: `2px solid ${GH.ink}`, padding: 24, marginBottom: 32 }}>
                    <GHPaymentForm
                        clients={p.clients}
                        onSave={p.onCreatePayment}
                        onCancel={() => p.setShowForm(false)}
                    />
                </div>
            )}

            {/* Долги по клиентам */}
            {p.debtLoadFailed && (
                <ErrorBar message="Не удалось загрузить долги клиентов" onRetry={p.onRetry} className="mb-6" />
            )}
            {p.debtByClient.length > 0 && (
                <section aria-labelledby="fin-debts" style={{ marginBottom: 32 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 8, marginBottom: 4 }}>
                        <h2 id="fin-debts" style={h2}>Долги</h2>
                        <span style={{ fontSize: 13, color: GH.ink60 }}>
                            {p.debtByClient.length} {ruPlural(p.debtByClient.length, ['клиент', 'клиента', 'клиентов'])}
                        </span>
                    </div>
                    <div>
                        {p.debtByClient.map(({ client, count, total }) => {
                            const tg = telegramHref(client.telegram);
                            return (
                                // flex с переносом: имя гибкое, сумма и кнопки
                                // справа на компьютере или строкой ниже на узком.
                                <div
                                    key={client.id}
                                    style={{
                                        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px',
                                        padding: '12px 0', borderBottom: `1px solid ${GH.ink10}`,
                                    }}
                                >
                                    <Link
                                        to={`/crm/clients/${client.id}`}
                                        style={{ fontSize: 15, fontWeight: 600, color: GH.ink, flex: '1 1 160px', minWidth: 0, wordBreak: 'break-word', textDecoration: 'none' }}
                                    >
                                        {client.name}
                                    </Link>
                                    <span style={{ fontSize: 13, color: GH.ink60, whiteSpace: 'nowrap', minWidth: 80, textAlign: 'right' }}>
                                        {count} {sessionsWord(count)}
                                    </span>
                                    <span className="num" style={{ fontFamily: GH_MONO, fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: GH.danger, whiteSpace: 'nowrap', minWidth: 90, textAlign: 'right' }}>
                                        {formatMoney(total, { currency: client.currency })}
                                    </span>
                                    <span style={{ display: 'flex', gap: 8, marginLeft: 'auto', minWidth: 250, justifyContent: 'flex-end' }}>
                                        {tg && (
                                            <a
                                                href={tg}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="ui-btn ui-btn--quiet ui-btn--compact"
                                                aria-label={`Написать ${client.name} в Telegram`}
                                            >
                                                <Send size={14} aria-hidden="true" /> Написать
                                            </a>
                                        )}
                                        {p.canWrite && (
                                            <Button size="compact" variant="secondary" onClick={() => p.onMarkPaid(client)}>
                                                Отметить оплату
                                            </Button>
                                        )}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* Журнал платежей */}
            <section aria-labelledby="fin-journal" style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 8, marginBottom: 4 }}>
                    <h2 id="fin-journal" style={h2}>Платежи за период</h2>
                    <span style={{ fontSize: 13, color: GH.ink60 }}>
                        {p.payments.length} {ruPlural(p.payments.length, ['платёж', 'платежа', 'платежей'])}
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
                            hint={p.canWrite ? 'Выберите другой период или добавьте платёж.' : 'Выберите другой период.'}
                            action={p.canWrite ? { label: 'Новый платёж', onClick: () => p.setShowForm(true) } : undefined}
                        />
                    )
                ) : (
                    <div>
                        {p.payments.map((pay) => {
                            const client = p.clientMap.get(pay.clientId);
                            const when = parseUTC(pay.date);
                            const rowStyle: React.CSSProperties = {
                                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 16px',
                                padding: '12px 0', borderBottom: `1px solid ${GH.ink10}`,
                                color: GH.ink, textDecoration: 'none',
                            };
                            const inner = (
                                <>
                                    <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                                        <div style={{ fontSize: 15, fontWeight: 600, wordBreak: 'break-word' }}>{client?.name || 'Клиент удалён'}</div>
                                        {pay.account && (
                                            <div style={{ fontSize: 13, color: GH.ink60, marginTop: 2 }}>{accountLabel(pay.account)}</div>
                                        )}
                                    </div>
                                    <div style={{ fontFamily: GH_MONO, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: GH.ink60, whiteSpace: 'nowrap' }}>
                                        {formatDayMonth(when, { withYear: 'auto' })} · {formatTime(when)}
                                    </div>
                                    <div className="num" style={{ fontFamily: GH_MONO, fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto', whiteSpace: 'nowrap', minWidth: 90, textAlign: 'right' }}>
                                        {formatMoney(pay.amount, { currency: pay.currency, sign: true })}
                                    </div>
                                </>
                            );
                            // Строка журнала ведёт в карточку клиента: там история
                            // оплат и удаление ошибочного платежа (G5-20).
                            return client ? (
                                <Link
                                    key={pay.id}
                                    to={`/crm/clients/${client.id}`}
                                    style={rowStyle}
                                    onMouseEnter={e => (e.currentTarget.style.background = GH.ink5)}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                    {inner}
                                </Link>
                            ) : (
                                <div key={pay.id} style={rowStyle}>{inner}</div>
                            );
                        })}
                    </div>
                )}
            </section>
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
    const paymentAccounts = useCrmStore(s => s.paymentAccounts);
    // Счёт — из списка счетов (как везде в CRM), по умолчанию — счёт клиента, иначе наличные.
    // Раньше тут было свободное поле: «Cash», «tbc», «TBC» набирались руками и плодили варианты.
    const [account, setAccount] = useState(() => defaultPaymentAccount(useCrmStore.getState().paymentAccounts));
    const [saving, setSaving] = useState(false);

    const selectedClient = clients.find(c => c.id === clientId);

    useEffect(() => {
        if (selectedClient) {
            setAmount(String(selectedClient.basePrice));
            setAccount(defaultPaymentAccount(paymentAccounts, selectedClient.defaultAccount));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedClient]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!clientId || !amount) return;
        setSaving(true);
        try {
            // 07.09: у счёта может быть своя валюта (напр. Mono → UAH) —
            // она важнее валюты клиента.
            const accCurrency = matchAccount(account, useCrmStore.getState().paymentAccounts)?.currency;
            await onSave({ clientId, amount: Number(amount), currency: accCurrency || selectedClient?.currency, account: account || undefined });
        } catch {
            // Ошибку уже показал стор (crmStore.createPayment) — второй тост не нужен.
        } finally {
            setSaving(false);
        }
    };

    const labelStyle: React.CSSProperties = { display: 'block', fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 };
    const hairlineInput: React.CSSProperties = {
        fontFamily: GH_SANS, fontSize: 15, background: 'transparent',
        border: 'none', borderBottom: `1px solid ${GH.ink10}`, padding: '10px 0',
        width: '100%', color: GH.ink,
    };

    return (
        <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 16, marginBottom: 24 }}>
                <h3 style={{ fontFamily: GH_SANS, fontSize: 20, fontWeight: 600, margin: 0 }}>
                    Новый платёж
                </h3>
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
                    <label htmlFor="fin-pay-client" style={labelStyle}>Клиент *</label>
                    <select
                        id="fin-pay-client"
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
                    <label htmlFor="fin-pay-amount" style={labelStyle}>Сумма *</label>
                    <input
                        id="fin-pay-amount"
                        type="number"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        required
                        style={{ ...hairlineInput, fontFamily: GH_MONO, fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                    />
                </div>
                <div>
                    <label htmlFor="fin-pay-account" style={labelStyle}>Счёт</label>
                    <AccountSelect value={account} onChange={setAccount} className="ui-input" />
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
                    Не добавлять
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
