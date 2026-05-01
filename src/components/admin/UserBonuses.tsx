import { useState, useEffect } from 'react';
import { Gift, Plus, Check, X, Loader2, Clock, Send } from 'lucide-react';
import { toast } from 'sonner';
import { bonusesApi, type Bonus } from '../../api/bonuses';
import { hasPermission } from '../../utils/permissions';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { safeFormat } from '../../utils/dateUtils';
import type { User } from '../../store/types';

interface Props {
    user: User;
    currentUser: User;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    active: { label: 'Активен', color: 'bg-green-50 text-green-700' },
    pending: { label: 'Ожидает', color: 'bg-amber-50 text-amber-700' },
    used: { label: 'Использован', color: 'bg-blue-50 text-blue-700' },
    expired: { label: 'Истёк', color: 'bg-gray-100 text-gray-500' },
    rejected: { label: 'Отклонён', color: 'bg-red-50 text-red-600' },
};

export function UserBonuses({ user, currentUser }: Props) {
    const [bonuses, setBonuses] = useState<Bonus[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        description: '',
        quantity: '1',
        expiresDays: '90',
    });

    const isSeniorOrOwner = currentUser.role === 'owner' || currentUser.role === 'senior_admin';
    const canGrant = isSeniorOrOwner || hasPermission(currentUser, 'bonuses.grant');

    useEffect(() => {
        loadBonuses();
    }, [user.id]);

    const loadBonuses = async () => {
        setLoading(true);
        try {
            const data = await bonusesApi.listBonuses({ userId: user.id });
            setBonuses(data);
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    };

    const handleGrant = async () => {
        const qty = parseFloat(form.quantity);
        if (!qty || qty <= 0) {
            toast.error('Укажите количество часов');
            return;
        }
        setSaving(true);
        try {
            await bonusesApi.createBonus({
                userId: user.id,
                description: form.description,
                quantity: qty,
                expiresDays: parseInt(form.expiresDays) || 90,
            });
            toast.success(
                isSeniorOrOwner
                    ? `Бонус ${qty}ч начислен`
                    : `Запрос на бонус ${qty}ч отправлен на одобрение`
            );
            setShowForm(false);
            setForm({ description: '', quantity: '1', expiresDays: '90' });
            loadBonuses();
        } catch {
            toast.error('Ошибка при начислении бонуса');
        } finally {
            setSaving(false);
        }
    };

    const handleApprove = async (id: string) => {
        try {
            await bonusesApi.approveBonus(id);
            toast.success('Бонус одобрен');
            loadBonuses();
        } catch {
            toast.error('Ошибка');
        }
    };

    const handleReject = async (id: string) => {
        try {
            await bonusesApi.rejectBonus(id);
            toast.success('Бонус отклонён');
            loadBonuses();
        } catch {
            toast.error('Ошибка');
        }
    };

    const handleUse = async (id: string) => {
        try {
            await bonusesApi.useBonus(id);
            toast.success('Бонус списан');
            loadBonuses();
        } catch {
            toast.error('Ошибка');
        }
    };

    const activeBonuses = bonuses.filter(b => b.status === 'active');
    const totalHours = activeBonuses.reduce((s, b) => s + b.quantity, 0);

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Gift size={16} className="text-amber-500" />
                    <span className="text-sm font-semibold text-unbox-dark">Бонусы</span>
                    {totalHours > 0 && (
                        <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                            {totalHours}ч активно
                        </span>
                    )}
                </div>
                {canGrant && !showForm && (
                    <button
                        onClick={() => setShowForm(true)}
                        className="flex items-center gap-1 text-xs font-medium text-unbox-green hover:text-unbox-dark transition-colors"
                    >
                        <Plus size={14} />
                        Начислить
                    </button>
                )}
            </div>

            {/* Grant form */}
            {showForm && (
                <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="text-xs font-semibold text-amber-800 mb-1">
                        {isSeniorOrOwner ? 'Начислить бонус' : 'Запросить начисление бонуса'}
                    </div>
                    <input
                        type="text"
                        placeholder="Описание (напр. Новогодний бонус)"
                        value={form.description}
                        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        className="w-full text-sm px-3 py-2 rounded-lg border border-amber-200 focus:outline-none focus:border-amber-400 bg-white"
                    />
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[11px] text-unbox-grey mb-1 block">Часов</label>
                            <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                value={form.quantity}
                                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                                className="w-full text-sm px-3 py-2 rounded-lg border border-amber-200 focus:outline-none focus:border-amber-400 bg-white"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] text-unbox-grey mb-1 block">Срок действия (дней)</label>
                            <input
                                type="number"
                                min="1"
                                value={form.expiresDays}
                                onChange={e => setForm(f => ({ ...f, expiresDays: e.target.value }))}
                                className="w-full text-sm px-3 py-2 rounded-lg border border-amber-200 focus:outline-none focus:border-amber-400 bg-white"
                            />
                        </div>
                    </div>
                    {!isSeniorOrOwner && (
                        <div className="text-[11px] text-amber-700 bg-amber-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                            <Clock size={12} />
                            Запрос будет отправлен на одобрение старшему администратору
                        </div>
                    )}
                    <div className="flex gap-2">
                        <button
                            onClick={handleGrant}
                            disabled={saving}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            {isSeniorOrOwner ? 'Начислить' : 'Отправить запрос'}
                        </button>
                        <button
                            onClick={() => setShowForm(false)}
                            className="px-3 py-2 rounded-lg border border-amber-200 text-amber-700 text-sm hover:bg-amber-100 transition-colors"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            )}

            {/* Bonus list */}
            {loading ? (
                <div className="text-center py-3">
                    <Loader2 size={16} className="animate-spin text-unbox-grey mx-auto" />
                </div>
            ) : bonuses.length === 0 ? (
                <div className="text-xs text-unbox-grey text-center py-3">Бонусов нет</div>
            ) : (
                <div className="space-y-1.5">
                    {bonuses.slice(0, 10).map(b => {
                        const st = STATUS_MAP[b.status] || { label: b.status, color: 'bg-gray-100 text-gray-600' };
                        return (
                            <div
                                key={b.id}
                                className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white border border-unbox-light hover:border-amber-200 transition-colors"
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                    b.status === 'active' ? 'bg-amber-50' :
                                    b.status === 'pending' ? 'bg-yellow-50' :
                                    'bg-gray-50'
                                }`}>
                                    <Gift size={16} className={
                                        b.status === 'active' ? 'text-amber-500' :
                                        b.status === 'pending' ? 'text-yellow-500' :
                                        'text-gray-400'
                                    } />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">
                                        {b.description || 'Бонусный час'} · {b.quantity}ч
                                    </div>
                                    <div className="text-[11px] text-unbox-grey">
                                        {b.grantedByName && `от ${b.grantedByName}`}
                                        {b.expiresAt && ` · до ${safeFormat(b.expiresAt, 'd MMM yyyy', ru, '—')}`}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.color}`}>
                                        {st.label}
                                    </span>
                                    {/* Approve/Reject for pending — only senior/owner */}
                                    {b.status === 'pending' && isSeniorOrOwner && (
                                        <>
                                            <button
                                                onClick={() => handleApprove(b.id)}
                                                className="w-6 h-6 rounded-md bg-green-50 hover:bg-green-100 text-green-600 flex items-center justify-center transition-colors"
                                                title="Одобрить"
                                            >
                                                <Check size={12} />
                                            </button>
                                            <button
                                                onClick={() => handleReject(b.id)}
                                                className="w-6 h-6 rounded-md bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center transition-colors"
                                                title="Отклонить"
                                            >
                                                <X size={12} />
                                            </button>
                                        </>
                                    )}
                                    {/* Use button for active bonuses */}
                                    {b.status === 'active' && (
                                        <button
                                            onClick={() => handleUse(b.id)}
                                            className="text-[11px] font-medium text-amber-600 hover:text-amber-800 transition-colors"
                                            title="Списать"
                                        >
                                            Списать
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
