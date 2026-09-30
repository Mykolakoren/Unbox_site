import { useState, useEffect } from 'react';
import { Gift, Plus, Check, X, Loader2, Clock, Send } from 'lucide-react';
import { toast } from 'sonner';
import { bonusesApi, type Bonus } from '../../api/bonuses';
import { hasPermission } from '../../utils/permissions';
import type { User } from '../../store/types';
import { formatDayMonth } from '../../utils/format';
import { ErrorBar } from '../ui/ErrorBar';

interface Props {
    user: User;
    currentUser: User;
}

// Статусы бонус-часа (не брони — в общем словаре их нет). Цвет — только
// статусные токены через общий бейдж ui-badge (wave 1).
const STATUS_MAP: Record<string, { label: string; tone: 'ok' | 'pending' | 'muted' | 'danger' }> = {
    active: { label: 'Активен', tone: 'ok' },
    pending: { label: 'Ждёт одобрения', tone: 'pending' },
    used: { label: 'Использован', tone: 'muted' },
    expired: { label: 'Истёк', tone: 'muted' },
    rejected: { label: 'Отклонён', tone: 'danger' },
};

export function UserBonuses({ user, currentUser }: Props) {
    const [bonuses, setBonuses] = useState<Bonus[]>([]);
    const [loading, setLoading] = useState(true);
    // Не удалось загрузить — не пишем «Бонусов нет» (wave 1).
    const [loadError, setLoadError] = useState(false);
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
            setLoadError(false);
        } catch {
            setLoadError(true);
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
        // Основание обязательно (owner 2026-07-25): бонус без причины —
        // дыра в аудите, потом не разобрать, за что начислили.
        if (!form.description.trim()) {
            toast.error('Укажите основание начисления');
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
            toast.error('Не удалось начислить бонус. Попробуйте ещё раз.');
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
            toast.error('Не удалось одобрить бонус. Попробуйте ещё раз.');
        }
    };

    const handleReject = async (id: string) => {
        try {
            await bonusesApi.rejectBonus(id);
            toast.success('Бонус отклонён');
            loadBonuses();
        } catch {
            toast.error('Не удалось отклонить бонус. Попробуйте ещё раз.');
        }
    };

    const handleUse = async (id: string) => {
        try {
            await bonusesApi.useBonus(id);
            toast.success('Бонус списан');
            loadBonuses();
        } catch {
            toast.error('Не удалось списать бонус. Попробуйте ещё раз.');
        }
    };

    const activeBonuses = bonuses.filter(b => b.status === 'active');
    const totalHours = activeBonuses.reduce((s, b) => s + b.quantity, 0);

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Gift size={16} className="text-ink-60" aria-hidden="true" />
                    <span className="text-sm font-semibold text-unbox-dark">Бонусы</span>
                    {totalHours > 0 && (
                        <span className="text-xs font-semibold text-[var(--status-ok-fg)] bg-[var(--status-ok-bg)] px-2 py-0.5 rounded-full">
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
                <div className="bg-sunken border border-ink-10 rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="text-xs font-semibold text-ink mb-1">
                        {isSeniorOrOwner ? 'Начислить бонус' : 'Запросить начисление бонуса'}
                    </div>
                    <input
                        type="text"
                        placeholder="Основание * (напр. компенсация за отмену)"
                        value={form.description}
                        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        aria-label="Основание начисления"
                        className="w-full text-sm px-3 py-2 rounded-lg border border-ink-20 focus:outline-none focus:border-accent bg-white"
                    />
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-ink-60 mb-1 block">Часов</label>
                            <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                value={form.quantity}
                                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                                className="w-full text-sm px-3 py-2 rounded-lg border border-ink-20 focus:outline-none focus:border-accent bg-white"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-ink-60 mb-1 block">Срок действия (дней)</label>
                            <input
                                type="number"
                                min="1"
                                value={form.expiresDays}
                                onChange={e => setForm(f => ({ ...f, expiresDays: e.target.value }))}
                                className="w-full text-sm px-3 py-2 rounded-lg border border-ink-20 focus:outline-none focus:border-accent bg-white"
                            />
                        </div>
                    </div>
                    {!isSeniorOrOwner && (
                        <div className="text-xs text-[var(--status-pending-fg)] bg-[var(--status-pending-bg)] px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                            <Clock size={12} />
                            Запрос будет отправлен на одобрение старшему администратору
                        </div>
                    )}
                    <div className="flex gap-2">
                        <button
                            onClick={handleGrant}
                            disabled={saving}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium transition-colors disabled:opacity-60"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            {isSeniorOrOwner ? 'Начислить' : 'Отправить запрос'}
                        </button>
                        <button
                            onClick={() => setShowForm(false)}
                            aria-label="Не начислять"
                            className="px-3 py-2 rounded-lg border border-ink-20 text-ink text-sm hover:bg-ink-05 transition-colors"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            )}

            {/* Bonus list */}
            {loading ? (
                <div className="text-center py-3" role="status" aria-busy="true">
                    <Loader2 size={16} className="animate-spin text-ink-60 mx-auto" aria-hidden="true" />
                    <span className="sr-only">Загружаем бонусы…</span>
                </div>
            ) : loadError ? (
                <ErrorBar message="Не удалось загрузить бонусы" onRetry={loadBonuses} />
            ) : bonuses.length === 0 ? (
                <div className="text-xs text-ink-60 text-center py-3">Бонусов нет</div>
            ) : (
                <div className="space-y-1.5">
                    {bonuses.slice(0, 10).map(b => {
                        const st = STATUS_MAP[b.status] || { label: 'Другой статус', tone: 'muted' as const };
                        return (
                            <div
                                key={b.id}
                                className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white border border-unbox-light hover:border-ink-20 transition-colors"
                            >
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-sunken">
                                    <Gift size={16} className={b.status === 'active' ? 'text-ink' : 'text-ink-60'} aria-hidden="true" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">
                                        {b.description || 'Бонусный час'} · {b.quantity}ч
                                    </div>
                                    <div className="text-xs text-ink-60">
                                        {b.grantedByName && `от ${b.grantedByName}`}
                                        {b.expiresAt && ` · до ${formatDayMonth(b.expiresAt, { withYear: 'auto' })}`}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className={`ui-badge ui-badge--${st.tone}`} title={STATUS_MAP[b.status] ? undefined : b.status}>
                                        {st.label}
                                    </span>
                                    {/* Approve/Reject for pending — only senior/owner */}
                                    {b.status === 'pending' && isSeniorOrOwner && (
                                        <>
                                            <button
                                                onClick={() => handleApprove(b.id)}
                                                className="w-6 h-6 rounded-md bg-[var(--status-ok-bg)] hover:brightness-95 text-[var(--status-ok-fg)] flex items-center justify-center transition-colors"
                                                title="Одобрить"
                                                aria-label="Одобрить бонус"
                                            >
                                                <Check size={12} />
                                            </button>
                                            <button
                                                onClick={() => handleReject(b.id)}
                                                className="w-6 h-6 rounded-md bg-[var(--status-danger-bg)] hover:brightness-95 text-[var(--status-danger-fg)] flex items-center justify-center transition-colors"
                                                title="Отклонить"
                                                aria-label="Отклонить бонус"
                                            >
                                                <X size={12} />
                                            </button>
                                        </>
                                    )}
                                    {/* Use button for active bonuses */}
                                    {b.status === 'active' && (
                                        <button
                                            onClick={() => handleUse(b.id)}
                                            className="text-xs font-medium text-accent-ink hover:text-ink transition-colors"
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
