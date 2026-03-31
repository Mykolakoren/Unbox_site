import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, X, Clock, Check, XCircle, Loader2, Eye, EyeOff, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { crmApi, type CrmAccessRequest } from '../../api/crm';
import { useUserStore } from '../../store/userStore';
import { hasPermission } from '../../utils/permissions';
import type { Specialist } from '../../components/Specialists/SpecialistCard';

const CATEGORIES = [
    { value: '', label: 'Без категории' },
    { value: 'psychology', label: 'Психологи и психотерапевты' },
    { value: 'psychiatry', label: 'Психиатры' },
    { value: 'narcology', label: 'Наркология / Неврология' },
    { value: 'coaching', label: 'Коучи и консультанты' },
    { value: 'education', label: 'Игропрактики / Педагоги' },
];

// All fields in camelCase (after axios interceptor transforms snake_case → camelCase)
interface SpecialistExtended extends Specialist {
    category?: string | null;
    isVerified?: boolean;
    userId?: string;
    sortOrder?: number;
}

interface EditModalProps {
    specialist: SpecialistExtended;
    onClose: () => void;
    onSaved: () => void;
}

function EditModal({ specialist, onClose, onSaved }: EditModalProps) {
    const [category, setCategory] = useState(specialist.category ?? '');
    const [isVerified, setIsVerified] = useState(specialist.isVerified ?? false);
    const [userId, setUserId] = useState(specialist.userId ?? '');
    const [allUsers, setAllUsers] = useState<{ id: string; email: string; name: string }[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.get('/users/').then(r => {
            setAllUsers(r.data.map((u: any) => ({ id: u.id, email: u.email, name: u.name })));
        }).catch(() => {});
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload: any = {
                category: category || null,
                isVerified,
            };
            if (userId && userId !== specialist.userId) {
                payload.userId = userId;
            }
            await api.patch(`/specialists/admin/${specialist.id}`, payload);
            toast.success('Специалист обновлён');
            onSaved();
            onClose();
        } catch {
            toast.error('Ошибка при сохранении');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg text-unbox-dark">
                        {specialist.firstName} {specialist.lastName}
                    </h3>
                    <button onClick={onClose} className="text-unbox-dark/40 hover:text-unbox-dark">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-unbox-dark/70 mb-1">Категория</label>
                        <select
                            value={category}
                            onChange={e => setCategory(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm"
                        >
                            {CATEGORIES.map(c => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                        </select>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isVerified}
                            onChange={e => setIsVerified(e.target.checked)}
                            className="w-4 h-4 rounded accent-unbox-green"
                        />
                        <span className="text-sm font-medium text-unbox-dark/70">Верифицирован (виден в каталоге)</span>
                    </label>

                    <div>
                        <label className="block text-sm font-medium text-unbox-dark/70 mb-1">Привязать к аккаунту</label>
                        <select
                            value={userId}
                            onChange={e => setUserId(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm"
                        >
                            <option value="">— не привязан —</option>
                            {allUsers.map(u => (
                                <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex gap-2 mt-6">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 py-2 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                    >
                        {saving ? 'Сохраняю...' : 'Сохранить'}
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl border border-unbox-light text-sm text-unbox-dark/60 hover:bg-unbox-light"
                    >
                        Отмена
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── CRM Access Requests Tab ──────────────────────────────────────────────────

function CrmAccessRequests() {
    const [requests, setRequests] = useState<CrmAccessRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const load = async () => {
        try {
            const data = await crmApi.getAccessRequests();
            setRequests(data);
        } catch {
            toast.error('Не удалось загрузить запросы');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleApprove = async (userId: string) => {
        setProcessingId(userId);
        try {
            await crmApi.approveAccessRequest(userId, 30);
            toast.success('Доступ одобрен на 30 дней');
            setRequests(prev => prev.filter(r => r.userId !== userId));
        } catch {
            toast.error('Ошибка при одобрении');
        } finally {
            setProcessingId(null);
        }
    };

    const handleReject = async (userId: string) => {
        setProcessingId(userId);
        try {
            await crmApi.rejectAccessRequest(userId);
            toast.success('Запрос отклонён');
            setRequests(prev => prev.filter(r => r.userId !== userId));
        } catch {
            toast.error('Ошибка при отклонении');
        } finally {
            setProcessingId(null);
        }
    };

    if (loading) {
        return <div className="text-center py-16 text-unbox-dark/40">Загрузка...</div>;
    }

    if (requests.length === 0) {
        return (
            <div className="text-center py-16">
                <Clock size={48} className="mx-auto text-unbox-dark/20 mb-3" />
                <p className="text-unbox-dark/40 text-sm">Нет активных запросов на доступ к CRM</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-unbox-light overflow-hidden shadow-sm">
            <table className="w-full text-left">
                <thead className="bg-unbox-light border-b border-unbox-light text-unbox-grey font-medium text-sm">
                    <tr>
                        <th className="p-4 pl-6">Пользователь</th>
                        <th className="p-4">Профессия</th>
                        <th className="p-4">Сообщение</th>
                        <th className="p-4">Дата</th>
                        <th className="p-4 text-right pr-6">Действия</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-unbox-light">
                    {requests.map(req => (
                        <tr key={req.userId} className="hover:bg-unbox-light/50 transition-colors">
                            <td className="p-4 pl-6">
                                <div className="flex items-center gap-3">
                                    {req.avatarUrl ? (
                                        <img src={req.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                                    ) : (
                                        <div className="w-9 h-9 rounded-full bg-unbox-green/15 flex items-center justify-center text-unbox-green font-bold text-sm">
                                            {req.name?.[0]?.toUpperCase() || '?'}
                                        </div>
                                    )}
                                    <div>
                                        <div className="font-medium text-unbox-dark text-sm">{req.name}</div>
                                        <div className="text-xs text-unbox-dark/40">{req.email}</div>
                                    </div>
                                </div>
                            </td>
                            <td className="p-4 text-sm text-unbox-dark/70">{req.profession || '—'}</td>
                            <td className="p-4 text-sm text-unbox-dark/70 max-w-[200px] truncate">{req.message || '—'}</td>
                            <td className="p-4 text-sm text-unbox-dark/50">
                                {req.submittedAt ? new Date(req.submittedAt).toLocaleDateString('ru-RU') : '—'}
                            </td>
                            <td className="p-4 text-right pr-6">
                                <div className="flex items-center justify-end gap-2">
                                    {processingId === req.userId ? (
                                        <Loader2 size={18} className="animate-spin text-unbox-dark/40" />
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => handleApprove(req.userId)}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-unbox-green/10 text-unbox-green text-xs font-semibold hover:bg-unbox-green/20 transition-colors"
                                            >
                                                <Check size={14} />
                                                Одобрить
                                            </button>
                                            <button
                                                onClick={() => handleReject(req.userId)}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs font-semibold hover:bg-red-100 transition-colors"
                                            >
                                                <XCircle size={14} />
                                                Отклонить
                                            </button>
                                        </>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}


// ── Main Component ───────────────────────────────────────────────────────────

export function AdminSpecialists() {
    const [specialists, setSpecialists] = useState<SpecialistExtended[]>([]);
    const [editing, setEditing] = useState<SpecialistExtended | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchParams] = useSearchParams();
    const initialTab = searchParams.get('tab') === 'crm-requests' ? 'crm-requests' : 'specialists';
    const [activeTab, setActiveTab] = useState<'specialists' | 'crm-requests'>(initialTab);
    const currentUser = useUserStore(s => s.currentUser);
    const canAcceptRequests = currentUser ? hasPermission(currentUser, 'admin.accept_requests') : false;

    const [deleting, setDeleting] = useState<string | null>(null);
    const [toggling, setToggling] = useState<string | null>(null);

    const load = async () => {
        try {
            const r = await api.get('/specialists/admin/all');
            const data: SpecialistExtended[] = r.data;
            // Sort by sortOrder (camelCase after interceptor), then by index
            data.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            setSpecialists(data);
        } catch {
            toast.error('Не удалось загрузить специалистов');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    // Toggle visibility (isVerified) — camelCase for request interceptor
    const handleToggleVisibility = async (s: SpecialistExtended) => {
        setToggling(s.id);
        try {
            await api.patch(`/specialists/admin/${s.id}`, { isVerified: !s.isVerified });
            setSpecialists(prev => prev.map(sp =>
                sp.id === s.id ? { ...sp, isVerified: !sp.isVerified } : sp
            ));
            toast.success(s.isVerified ? 'Специалист скрыт из каталога' : 'Специалист виден в каталоге');
        } catch {
            toast.error('Ошибка при обновлении');
        } finally {
            setToggling(null);
        }
    };

    const handleDelete = async (s: SpecialistExtended) => {
        if (!window.confirm(`Удалить анкету ${s.firstName} ${s.lastName}? Это действие необратимо.`)) return;
        setDeleting(s.id);
        try {
            await api.delete(`/specialists/admin/${s.id}`);
            setSpecialists(prev => prev.filter(sp => sp.id !== s.id));
            toast.success('Анкета удалена');
        } catch {
            toast.error('Ошибка при удалении');
        } finally {
            setDeleting(null);
        }
    };

    // Move specialist up/down and save new order
    const handleMove = async (index: number, direction: 'up' | 'down') => {
        const newList = [...specialists];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= newList.length) return;
        [newList[index], newList[targetIndex]] = [newList[targetIndex], newList[index]];
        const updated = newList.map((s, i) => ({ ...s, sortOrder: i }));
        setSpecialists(updated);
        try {
            // Send as camelCase — request interceptor converts to snake_case for backend
            await api.post('/specialists/admin/reorder', updated.map(s => ({ id: s.id, sortOrder: s.sortOrder ?? 0 })));
        } catch {
            toast.error('Ошибка при сохранении порядка');
            load(); // revert on error
        }
    };

    const categoryLabel = (cat?: string | null) =>
        CATEGORIES.find(c => c.value === (cat ?? ''))?.label ?? '—';

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-unbox-dark">Специалисты</h1>
                <span className="text-sm text-unbox-dark/50">
                    {activeTab === 'specialists' ? `${specialists.length} записей` : ''}
                </span>
            </div>

            {/* Tabs */}
            {canAcceptRequests && (
                <div className="flex gap-1 bg-white/70 backdrop-blur rounded-xl p-1 border border-unbox-light w-fit">
                    <button
                        onClick={() => setActiveTab('specialists')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            activeTab === 'specialists'
                                ? 'bg-unbox-green text-white shadow-sm'
                                : 'text-unbox-grey hover:text-unbox-dark hover:bg-unbox-light/60'
                        }`}
                    >
                        Специалисты
                    </button>
                    <button
                        onClick={() => setActiveTab('crm-requests')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            activeTab === 'crm-requests'
                                ? 'bg-unbox-green text-white shadow-sm'
                                : 'text-unbox-grey hover:text-unbox-dark hover:bg-unbox-light/60'
                        }`}
                    >
                        Запросы CRM
                    </button>
                </div>
            )}

            {activeTab === 'crm-requests' && canAcceptRequests ? (
                <CrmAccessRequests />
            ) : (
                <>
                    {loading ? (
                        <div className="text-center py-16 text-unbox-dark/40">Загрузка...</div>
                    ) : (
                        <div className="bg-white rounded-xl border border-unbox-light overflow-hidden shadow-sm">
                            <table className="w-full text-left">
                                <thead className="bg-unbox-light border-b border-unbox-light text-unbox-grey font-medium text-sm">
                                    <tr>
                                        <th className="p-3 pl-4 w-16 text-center">Порядок</th>
                                        <th className="p-4">Специалист</th>
                                        <th className="p-4">Категория</th>
                                        <th className="p-4">Специализации</th>
                                        <th className="p-4">Цена</th>
                                        <th className="p-4">Показ</th>
                                        <th className="p-4 text-right pr-6">Действия</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-unbox-light">
                                    {specialists.map((s, idx) => (
                                        <tr key={s.id} className="hover:bg-unbox-light/50 transition-colors">

                                            {/* ── Sort order arrows ── */}
                                            <td className="p-2 pl-4 text-center">
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <button
                                                        onClick={() => handleMove(idx, 'up')}
                                                        disabled={idx === 0}
                                                        className="p-1 rounded hover:bg-unbox-light text-unbox-dark/40 hover:text-unbox-dark disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                                                        title="Переместить вверх"
                                                    >
                                                        <ChevronUp size={14} />
                                                    </button>
                                                    <span className="text-[11px] text-unbox-dark/40 font-mono leading-none">{idx + 1}</span>
                                                    <button
                                                        onClick={() => handleMove(idx, 'down')}
                                                        disabled={idx === specialists.length - 1}
                                                        className="p-1 rounded hover:bg-unbox-light text-unbox-dark/40 hover:text-unbox-dark disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                                                        title="Переместить вниз"
                                                    >
                                                        <ChevronDown size={14} />
                                                    </button>
                                                </div>
                                            </td>

                                            {/* ── Name + photo ── */}
                                            <td className="p-4">
                                                <div className="flex items-center gap-3">
                                                    {s.photoUrl ? (
                                                        <img src={s.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                                                    ) : (
                                                        <div className="w-9 h-9 rounded-full bg-unbox-green/15 flex items-center justify-center text-unbox-green font-bold text-sm">
                                                            {s.firstName?.[0]}{s.lastName?.[0]}
                                                        </div>
                                                    )}
                                                    <div>
                                                        <div className="font-medium text-unbox-dark text-sm">{s.firstName} {s.lastName}</div>
                                                        <div className="text-xs text-unbox-dark/40 truncate max-w-[180px]">{s.tagline}</div>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="p-4 text-sm text-unbox-dark/70">{categoryLabel(s.category)}</td>

                                            <td className="p-4">
                                                <div className="flex flex-wrap gap-1">
                                                    {(s.specializations ?? []).slice(0, 2).map((sp: string) => (
                                                        <span key={sp} className="text-[10px] px-2 py-0.5 rounded-full bg-unbox-light text-unbox-dark/60">
                                                            {sp}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>

                                            <td className="p-4 text-sm text-unbox-dark/70">от {s.basePriceGel} ₾</td>

                                            {/* ── Visibility toggle ── */}
                                            <td className="p-4">
                                                <button
                                                    onClick={() => handleToggleVisibility(s)}
                                                    disabled={toggling === s.id}
                                                    className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                                                        s.isVerified
                                                            ? 'text-unbox-green bg-unbox-green/10 hover:bg-unbox-green/20'
                                                            : 'text-unbox-dark/40 bg-unbox-light hover:bg-unbox-dark/10'
                                                    }`}
                                                    title={s.isVerified ? 'Кликните чтобы скрыть' : 'Кликните чтобы показать'}
                                                >
                                                    {toggling === s.id ? (
                                                        <Loader2 size={13} className="animate-spin" />
                                                    ) : s.isVerified ? (
                                                        <Eye size={13} />
                                                    ) : (
                                                        <EyeOff size={13} />
                                                    )}
                                                    {s.isVerified ? 'Виден' : 'Скрыт'}
                                                </button>
                                            </td>

                                            {/* ── Actions ── */}
                                            <td className="p-4 text-right pr-6">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        onClick={() => setEditing(s)}
                                                        className="p-1.5 rounded-lg hover:bg-unbox-light transition-colors text-unbox-dark/40 hover:text-unbox-dark"
                                                        title="Редактировать"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(s)}
                                                        disabled={deleting === s.id}
                                                        className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-unbox-dark/30 hover:text-red-500"
                                                        title="Удалить"
                                                    >
                                                        {deleting === s.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {editing && (
                        <EditModal
                            specialist={editing}
                            onClose={() => setEditing(null)}
                            onSaved={load}
                        />
                    )}
                </>
            )}
        </div>
    );
}
