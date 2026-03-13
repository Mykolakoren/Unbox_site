import { useEffect, useState, useMemo } from 'react';
import { useCrmStore } from '../../store/crmStore';
import {
    Wallet,
    ChevronLeft,
    ChevronRight,
    Loader2,
    TrendingUp,
    AlertTriangle,
    Banknote,
    Plus,
    Check,
    X,
} from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import type { CrmPaymentCreate, CrmClient } from '../../api/crm';

export function CrmFinances() {
    const {
        payments,
        sessions,
        clients,
        fetchPayments,
        fetchSessions,
        fetchClients,
        createPayment,
        loading,
    } = useCrmStore();
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [showForm, setShowForm] = useState(false);

    const dateFrom = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const dateTo = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

    useEffect(() => {
        fetchClients();
    }, [fetchClients]);

    useEffect(() => {
        fetchPayments({ dateFrom, dateTo });
        fetchSessions({ dateFrom, dateTo });
    }, [fetchPayments, fetchSessions, dateFrom, dateTo]);

    const clientMap = useMemo(() => {
        const map = new Map<string, CrmClient>();
        clients.forEach((c) => map.set(c.id, c));
        return map;
    }, [clients]);

    // Revenue stats
    const stats = useMemo(() => {
        const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
        const unpaidSessions = sessions.filter(
            (s) =>
                !s.isPaid &&
                s.status !== 'CANCELLED_CLIENT' &&
                s.status !== 'CANCELLED_THERAPIST'
        );
        const unpaidTotal = unpaidSessions.reduce((sum, s) => {
            const client = clientMap.get(s.clientId);
            return sum + (s.price ?? client?.basePrice ?? 0);
        }, 0);
        return { totalRevenue, unpaidCount: unpaidSessions.length, unpaidTotal };
    }, [payments, sessions, clientMap]);

    // Debt by client
    const debtByClient = useMemo(() => {
        const map = new Map<string, { client: CrmClient; count: number; total: number }>();
        sessions
            .filter(
                (s) =>
                    !s.isPaid &&
                    s.status !== 'CANCELLED_CLIENT' &&
                    s.status !== 'CANCELLED_THERAPIST'
            )
            .forEach((s) => {
                const client = clientMap.get(s.clientId);
                if (!client) return;
                const existing = map.get(s.clientId) || { client, count: 0, total: 0 };
                existing.count++;
                existing.total += s.price ?? client.basePrice;
                map.set(s.clientId, existing);
            });
        return Array.from(map.values()).sort((a, b) => b.total - a.total);
    }, [sessions, clientMap]);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Финансы</h1>
                    <p className="text-unbox-grey text-sm">Платежи и задолженности</p>
                </div>
                <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-unbox-green text-white rounded-xl font-medium text-sm hover:bg-unbox-dark transition-colors shadow-md"
                >
                    <Plus className="w-4 h-4" />
                    Добавить платёж
                </button>
            </div>

            {/* Month Navigation */}
            <div className="flex items-center gap-2 bg-white rounded-xl border border-unbox-light px-1 py-1 shadow-sm w-fit">
                <button
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                    className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-medium text-sm w-32 text-center capitalize">
                    {format(currentMonth, 'LLLL yyyy', { locale: ru })}
                </span>
                <button
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                    className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl border border-unbox-light p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
                            <TrendingUp className="w-5 h-5" />
                        </div>
                        <div className="text-sm text-unbox-grey">Получено</div>
                    </div>
                    <div className="text-3xl font-bold text-green-600">{stats.totalRevenue.toFixed(0)} ₾</div>
                </div>
                <div className="bg-white rounded-2xl border border-unbox-light p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5" />
                        </div>
                        <div className="text-sm text-unbox-grey">Задолженность</div>
                    </div>
                    <div className="text-3xl font-bold text-orange-600">{stats.unpaidTotal.toFixed(0)} ₾</div>
                    <div className="text-sm text-unbox-grey mt-1">{stats.unpaidCount} сессий</div>
                </div>
                <div className="bg-white rounded-2xl border border-unbox-light p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-unbox-light text-unbox-green flex items-center justify-center">
                            <Banknote className="w-5 h-5" />
                        </div>
                        <div className="text-sm text-unbox-grey">Платежей</div>
                    </div>
                    <div className="text-3xl font-bold text-unbox-dark">{payments.length}</div>
                </div>
            </div>

            {/* New Payment Form */}
            {showForm && (
                <PaymentForm
                    clients={clients.filter((c) => c.isActive)}
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
                                className="flex items-center justify-between px-5 py-3.5"
                            >
                                <div>
                                    <div className="font-medium text-unbox-dark">{client.name}</div>
                                    <div className="text-sm text-unbox-grey">
                                        {count} неоплаченных сессий
                                    </div>
                                </div>
                                <div className="text-lg font-bold text-orange-600">
                                    {total} {client.currency}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Payments List */}
            <div className="bg-white rounded-2xl border border-unbox-light shadow-sm">
                <div className="p-5 border-b border-unbox-light flex items-center gap-2">
                    <Wallet className="w-5 h-5 text-unbox-grey" />
                    <h2 className="font-bold text-lg">Платежи за месяц</h2>
                </div>

                {loading && !payments.length ? (
                    <div className="flex items-center justify-center h-32">
                        <Loader2 className="w-6 h-6 animate-spin text-unbox-grey" />
                    </div>
                ) : payments.length === 0 ? (
                    <div className="p-8 text-center text-unbox-grey">
                        <p>Нет платежей за выбранный период</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {payments.map((p) => {
                            const client = clientMap.get(p.clientId);
                            return (
                                <div
                                    key={p.id}
                                    className="flex items-center justify-between px-5 py-3.5 hover:bg-unbox-light/30 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
                                            <Banknote className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <div className="font-medium text-unbox-dark text-sm">
                                                {client?.name || 'Неизвестный'}
                                            </div>
                                            <div className="text-xs text-unbox-grey">
                                                {format(parseISO(p.date), 'dd.MM.yyyy HH:mm')}
                                                {p.account && ` · ${p.account}`}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="font-semibold text-green-600">
                                        +{p.amount} {p.currency}
                                    </div>
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

function PaymentForm({
    clients,
    onSave,
    onCancel,
}: {
    clients: CrmClient[];
    onSave: (data: CrmPaymentCreate) => Promise<void>;
    onCancel: () => void;
}) {
    const [clientId, setClientId] = useState('');
    const [amount, setAmount] = useState('');
    const [account, setAccount] = useState('');
    const [saving, setSaving] = useState(false);

    const selectedClient = clients.find((c) => c.id === clientId);

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
            await onSave({
                clientId,
                amount: Number(amount),
                currency: selectedClient?.currency,
                account: account || undefined,
            });
        } catch (err: any) {
            toast.error(err.message || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl border border-unbox-light shadow-sm p-5 space-y-4 animate-in fade-in slide-in-from-top-2"
        >
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Новый платёж</h3>
                <button type="button" onClick={onCancel} className="p-1 hover:bg-unbox-light/50 rounded-lg">
                    <X className="w-5 h-5 text-unbox-grey" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Клиент <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        required
                    >
                        <option value="">Выберите клиента</option>
                        {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Сумма <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        required
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Счёт</label>
                    <input
                        type="text"
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        placeholder="cash / bank / transfer"
                    />
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-sm text-unbox-grey hover:bg-unbox-light/50 rounded-xl transition-colors"
                >
                    Отмена
                </button>
                <button
                    type="submit"
                    disabled={saving || !clientId || !amount}
                    className="flex items-center gap-2 px-5 py-2 bg-unbox-green text-white text-sm font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Добавить
                </button>
            </div>
        </form>
    );
}
