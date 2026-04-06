import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import {
    Wallet, ChevronLeft, ChevronRight, Loader2,
    TrendingUp, AlertTriangle, Banknote, Plus, Check, X, Calendar,
} from 'lucide-react';
import {
    format,
    startOfMonth, endOfMonth, addMonths, subMonths,
    startOfWeek, endOfWeek, addWeeks, subWeeks,
    startOfDay, endOfDay, addDays, subDays,
    isSameDay,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { parseUTC } from '../../utils/dateUtils';
import { crmApi, type CrmPaymentCreate, type CrmClient, type CrmSession } from '../../api/crm';
import { totalInGel } from '../../utils/currency';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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
    if (period === 'day') return format(date, 'd MMMM yyyy', { locale: ru });
    if (period === 'week') {
        const { from, to } = getPeriodRange(date, 'week');
        return `${format(from, 'd MMM', { locale: ru })} – ${format(to, 'd MMM yyyy', { locale: ru })}`;
    }
    return format(date, 'LLLL yyyy', { locale: ru });
}

export function CrmFinances() {
    const gridHouse = useDesignFlag();
    const navigate = useNavigate();
    const {
        payments, sessions, clients,
        fetchPayments, fetchSessions, fetchClients,
        createPayment, loading,
    } = useCrmStore();

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
        fetchPayments({ dateFrom, dateTo });
        fetchSessions({ dateFrom, dateTo });
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
            if (entries.length === 0) return '0';
            return entries.map(([cur, val]) => `${val.toFixed(0)} ${cur}`).join(' · ');
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
            revenueGel: showRevEquiv ? `≈ ${revenueGel.toFixed(0)} ₾` : null,
            debtGel: showDebtEquiv ? `≈ ${debtGel.toFixed(0)} ₾` : null,
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

    if (gridHouse) {
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
                loading={loading}
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

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Финансы</h1>
                    <p className="text-unbox-dark/60 text-sm">Платежи и задолженности</p>
                </div>
                <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-unbox-green text-white rounded-xl font-medium text-sm hover:bg-unbox-dark transition-colors shadow-md"
                >
                    <Plus className="w-4 h-4" />
                    Добавить платёж
                </button>
            </div>

            {/* Period selector + navigation */}
            <div className="flex flex-wrap items-center gap-3">
                {/* Period tabs */}
                <div className="flex gap-1 bg-white rounded-xl border border-unbox-light p-1 shadow-sm">
                    {PERIODS.map(p => (
                        <button
                            key={p.id}
                            onClick={() => setPeriod(p.id)}
                            className={[
                                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                                period === p.id
                                    ? 'bg-unbox-green text-white shadow-sm'
                                    : 'text-unbox-grey hover:text-unbox-dark',
                            ].join(' ')}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                {/* Navigation arrows */}
                <div className="flex items-center gap-2 bg-white rounded-xl border border-unbox-light px-1 py-1 shadow-sm">
                    <button
                        onClick={() => setAnchor(d => navigatePeriod(d, period, -1))}
                        className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-medium text-sm w-36 sm:w-44 text-center capitalize">
                        {formatPeriodLabel(anchor, period)}
                    </span>
                    <button
                        onClick={() => setAnchor(d => navigatePeriod(d, period, 1))}
                        className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                {/* Today / This month shortcut */}
                {!isToday && !isThisMonth && (
                    <button
                        onClick={() => setAnchor(new Date())}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs text-unbox-grey bg-white border border-unbox-light rounded-xl hover:text-unbox-dark transition-colors shadow-sm"
                    >
                        <Calendar size={13} />
                        Сейчас
                    </button>
                )}
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl border border-unbox-light p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-9 h-9 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
                            <TrendingUp className="w-5 h-5" />
                        </div>
                        <div className="text-sm text-unbox-grey">Получено</div>
                    </div>
                    <div className="text-lg font-bold text-green-600 leading-snug">{stats.revenueLabel}</div>
                    {stats.revenueGel && <div className="text-xs text-unbox-grey mt-0.5">{stats.revenueGel}</div>}
                </div>

                <div className="bg-white rounded-2xl border border-unbox-light p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5" />
                        </div>
                        <div className="text-sm text-unbox-grey">Общий долг</div>
                    </div>
                    <div className="text-lg font-bold text-orange-600 leading-snug">{stats.debtLabel}</div>
                    <div className="text-xs text-unbox-grey mt-0.5">{stats.unpaidCount} сессий{stats.debtGel ? ` · ${stats.debtGel}` : ''}</div>
                </div>

                <div className="bg-white rounded-2xl border border-unbox-light p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-9 h-9 rounded-xl bg-unbox-light text-unbox-green flex items-center justify-center">
                            <Banknote className="w-5 h-5" />
                        </div>
                        <div className="text-sm text-unbox-grey">Платежей</div>
                    </div>
                    <div className="text-2xl font-bold text-unbox-dark">{stats.totalPayments}</div>
                </div>

                <div className="bg-white rounded-2xl border border-unbox-light p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                            <Calendar className="w-5 h-5" />
                        </div>
                        <div className="text-sm text-unbox-grey">Сессий</div>
                    </div>
                    <div className="text-2xl font-bold text-unbox-dark">{stats.held}</div>
                </div>
            </div>

            {/* New Payment Form */}
            {showForm && (
                <PaymentForm
                    clients={clients.filter(c => c.isActive)}
                    onSave={async (data) => {
                        await createPayment(data);
                        setShowForm(false);
                        toast.success('Платёж добавлен');
                    }}
                    onCancel={() => setShowForm(false)}
                />
            )}

            {/* Debt by Client */}
            {debtByClient.length > 0 && (
                <div className="bg-white rounded-2xl border border-orange-200 shadow-sm">
                    <div className="p-5 border-b border-orange-100 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-orange-500" />
                        <h2 className="font-bold text-lg">Задолженности по клиентам</h2>
                    </div>
                    <div className="divide-y divide-gray-50">
                        {debtByClient.map(({ client, count, total }) => (
                            <div
                                key={client.id}
                                className="flex items-center justify-between px-5 py-3.5 hover:bg-orange-50/30 cursor-pointer transition-colors"
                                onClick={() => navigate(`/crm/clients/${client.id}`)}
                            >
                                <div>
                                    <div className="font-medium text-unbox-dark hover:text-unbox-green transition-colors">{client.name}</div>
                                    <div className="text-sm text-unbox-grey">{count} неоплаченных сессий</div>
                                </div>
                                <div className="text-lg font-bold text-orange-600">{total} {client.currency}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Payments List */}
            <div className="bg-white rounded-2xl border border-unbox-light shadow-sm">
                <div className="p-5 border-b border-unbox-light flex items-center gap-2">
                    <Wallet className="w-5 h-5 text-unbox-grey" />
                    <h2 className="font-bold text-lg">Платежи за период</h2>
                </div>

                {loading && !payments.length ? (
                    <div className="flex items-center justify-center h-32">
                        <Loader2 className="w-6 h-6 animate-spin text-unbox-grey" />
                    </div>
                ) : payments.length === 0 ? (
                    <div className="p-8 text-center text-unbox-grey">Нет платежей за выбранный период</div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {payments.map(p => {
                            const client = clientMap.get(p.clientId);
                            return (
                                <div key={p.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-unbox-light/30 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
                                            <Banknote className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <div className="font-medium text-unbox-dark text-sm">{client?.name || 'Неизвестный'}</div>
                                            <div className="text-xs text-unbox-grey">
                                                {format(parseUTC(p.date), 'dd.MM.yyyy HH:mm')}
                                                {p.account && ` · ${p.account}`}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="font-semibold text-green-600">+{p.amount} {p.currency}</div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Payment Form ─────────────────────────────────────────────────────────────

function PaymentForm({ clients, onSave, onCancel }: {
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
            await onSave({ clientId, amount: Number(amount), currency: selectedClient?.currency, account: account || undefined });
        } catch (err: any) {
            toast.error(err.message || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-unbox-light shadow-sm p-5 space-y-4 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Новый платёж</h3>
                <button type="button" onClick={onCancel} className="p-1 hover:bg-unbox-light/50 rounded-lg">
                    <X className="w-5 h-5 text-unbox-grey" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Клиент *</label>
                    <select value={clientId} onChange={e => setClientId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green" required>
                        <option value="">Выберите клиента</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Сумма *</label>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green" required />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Счёт</label>
                    <input type="text" value={account} onChange={e => setAccount(e.target.value)}
                        placeholder="cash / bank / transfer"
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green" />
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-unbox-grey hover:bg-unbox-light/50 rounded-xl transition-colors">
                    Отмена
                </button>
                <button type="submit" disabled={saving || !clientId || !amount}
                    className="flex items-center gap-2 px-5 py-2 bg-unbox-green text-white text-sm font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-50 transition-colors">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Добавить
                </button>
            </div>
        </form>
    );
}

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
    isToday: boolean;
    isThisMonth: boolean;
    onCreatePayment: (data: CrmPaymentCreate) => Promise<void>;
    navigate: (path: string) => void;
};

function GridHouseCrmFinances(p: GHFinProps) {
    const eyebrow: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60 };
    const periods: { id: Period; label: string }[] = [
        { id: 'day', label: 'День' },
        { id: 'week', label: 'Неделя' },
        { id: 'month', label: 'Месяц' },
    ];

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, color: GH.ink, fontFamily: GH_SANS }}>
            <div style={{ maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px, 4vw, 48px)' }}>
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
                            fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
                            background: GH.ink, color: GH.paper, border: `1px solid ${GH.ink}`, padding: '14px 22px', cursor: 'pointer',
                        }}
                    >
                        <Plus size={12} style={{ verticalAlign: 'middle', marginRight: 8 }} />
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
                                        fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
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
                            style={{ width: 32, height: 32, border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <ChevronLeft size={14} />
                        </button>
                        <span style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', minWidth: 200, textAlign: 'center' }}>
                            {formatPeriodLabel(p.anchor, p.period)}
                        </span>
                        <button
                            onClick={() => p.setAnchor((d: Date) => navigatePeriod(d, p.period, 1))}
                            style={{ width: 32, height: 32, border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <ChevronRight size={14} />
                        </button>
                    </div>

                    {!p.isToday && !p.isThisMonth && (
                        <button
                            onClick={() => p.setAnchor(new Date())}
                            style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', background: 'transparent', color: GH.ink, border: `1px solid ${GH.ink10}`, padding: '8px 14px', cursor: 'pointer' }}
                        >
                            <Calendar size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                            Сейчас
                        </button>
                    )}
                </div>

                {/* KPI strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderTop: `1px solid ${GH.ink10}`, borderBottom: `1px solid ${GH.ink10}`, marginBottom: 40 }}>
                    {[
                        { label: 'Получено', value: p.stats.revenueLabel, sub: p.stats.revenueGel },
                        { label: 'Общий долг', value: p.stats.debtLabel, sub: `${p.stats.unpaidCount} сессий${p.stats.debtGel ? ' · ' + p.stats.debtGel : ''}`, danger: p.stats.unpaidCount > 0 },
                        { label: 'Платежей', value: String(p.stats.totalPayments), sub: null },
                        { label: 'Сессий', value: String(p.stats.held), sub: null },
                    ].map((k, i) => (
                        <div key={k.label} style={{ padding: '24px 20px', borderLeft: i > 0 ? `1px solid ${GH.ink10}` : 'none' }}>
                            <div style={{ ...eyebrow, marginBottom: 10 }}>{k.label}</div>
                            <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(22px, 2.6vw, 32px)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: k.danger ? GH.danger : GH.ink }}>
                                {k.value}
                            </div>
                            {k.sub && <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', color: GH.ink60, marginTop: 8, textTransform: 'uppercase' }}>{k.sub}</div>}
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
                                <div
                                    key={client.id}
                                    onClick={() => p.navigate(`/crm/clients/${client.id}`)}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '60px 1fr 100px 160px',
                                        alignItems: 'center',
                                        gap: 16,
                                        padding: '18px 0',
                                        borderBottom: `1px solid ${GH.ink10}`,
                                        cursor: 'pointer',
                                    }}
                                >
                                    <span style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60 }}>
                                        {String(i + 1).padStart(2, '0')}
                                    </span>
                                    <div style={{ fontFamily: GH_SANS, fontSize: 16, fontWeight: 600, color: GH.ink }}>{client.name}</div>
                                    <div style={{ fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.ink60 }}>
                                        {count} сессий
                                    </div>
                                    <div style={{ fontFamily: GH_MONO, fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: GH.danger, textAlign: 'right' }}>
                                        {total} {client.currency}
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
                        <div style={{ padding: 60, display: 'flex', justifyContent: 'center' }}>
                            <Loader2 className="animate-spin" size={20} color={GH.ink60} />
                        </div>
                    ) : p.payments.length === 0 ? (
                        <div style={{ padding: '80px 0', textAlign: 'center' }}>
                            <div style={{ fontFamily: GH_SANS, fontSize: 'clamp(28px, 3vw, 40px)', fontWeight: 800, letterSpacing: '-0.01em', marginBottom: 8 }}>
                                Платежей нет.
                            </div>
                            <div style={{ ...eyebrow }}>Выберите другой период или добавьте платёж</div>
                        </div>
                    ) : (
                        <div>
                            {p.payments.map((pay, i) => {
                                const client = p.clientMap.get(pay.clientId);
                                return (
                                    <div
                                        key={pay.id}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '60px 1fr 200px 140px',
                                            alignItems: 'center',
                                            gap: 16,
                                            padding: '16px 0',
                                            borderBottom: `1px solid ${GH.ink10}`,
                                        }}
                                    >
                                        <span style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60 }}>
                                            {String(i + 1).padStart(3, '0')}
                                        </span>
                                        <div>
                                            <div style={{ fontFamily: GH_SANS, fontSize: 15, fontWeight: 600 }}>{client?.name || 'Неизвестный'}</div>
                                            {pay.account && (
                                                <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', color: GH.ink60, marginTop: 3, textTransform: 'uppercase' }}>
                                                    {pay.account}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60 }}>
                                            {format(parseUTC(pay.date), 'dd.MM.yyyy · HH:mm')}
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: GH.ink, textAlign: 'right' }}>
                                            +{pay.amount} {pay.currency}
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
            await onSave({ clientId, amount: Number(amount), currency: selectedClient?.currency, account: account || undefined });
        } catch (err: any) {
            toast.error(err.message || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    const labelStyle: React.CSSProperties = { display: 'block', fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 };
    const hairlineInput: React.CSSProperties = {
        fontFamily: GH_SANS, fontSize: 15, background: 'transparent',
        border: 'none', borderBottom: `1px solid ${GH.ink10}`, padding: '10px 0',
        outline: 'none', width: '100%', color: GH.ink,
    };

    return (
        <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 16, marginBottom: 24 }}>
                <div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 6 }}>
                        Действие · Новый платёж
                    </div>
                    <h3 style={{ fontFamily: GH_SANS, fontSize: 28, fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }}>
                        Добавить платёж.
                    </h3>
                </div>
                <button
                    type="button"
                    onClick={onCancel}
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
                        flex: 1, fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
                        background: 'transparent', color: GH.ink, border: `1px solid ${GH.ink10}`, padding: '14px 20px', cursor: 'pointer',
                    }}
                >
                    Отмена
                </button>
                <button
                    type="submit"
                    disabled={saving || !clientId || !amount}
                    style={{
                        flex: 1, fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
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
