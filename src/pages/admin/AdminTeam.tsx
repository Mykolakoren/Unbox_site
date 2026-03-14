import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Eye, EyeOff, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { teamApi, type TeamMember, type TeamMemberCreate } from '../../api/team';
import { createPortal } from 'react-dom';

const ROLE_TYPES = [
    { value: 'founder', label: 'Основатель' },
    { value: 'senior_admin', label: 'Ст. администратор' },
    { value: 'admin', label: 'Администратор' },
    { value: 'other', label: 'Другое' },
];

interface FormData {
    name: string;
    role: string;
    role_type: string;
    photo_url: string;
    bio: string;
    sort_order: number;
    is_active: boolean;
}

const defaultForm = (): FormData => ({
    name: '',
    role: '',
    role_type: 'admin',
    photo_url: '',
    bio: '',
    sort_order: 0,
    is_active: true,
});

interface MemberModalProps {
    member: TeamMember | null;
    onClose: () => void;
    onSaved: () => void;
}

function MemberModal({ member, onClose, onSaved }: MemberModalProps) {
    const [form, setForm] = useState<FormData>(
        member
            ? {
                name: member.name,
                role: member.role,
                role_type: member.roleType,
                photo_url: member.photoUrl ?? '',
                bio: member.bio ?? '',
                sort_order: member.sortOrder,
                is_active: member.isActive,
            }
            : defaultForm()
    );
    const [saving, setSaving] = useState(false);

    const set = (k: keyof FormData, v: string | number | boolean) =>
        setForm(f => ({ ...f, [k]: v }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim() || !form.role.trim()) {
            toast.error('Заполните имя и должность');
            return;
        }
        setSaving(true);
        try {
            const payload: TeamMemberCreate = {
                ...form,
                photo_url: form.photo_url || undefined,
                bio: form.bio || undefined,
            };
            if (member) {
                await teamApi.update(member.id, payload);
                toast.success('Карточка обновлена');
            } else {
                await teamApi.create(payload);
                toast.success('Участник добавлен');
            }
            onSaved();
            onClose();
        } catch {
            toast.error('Ошибка при сохранении');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                    <X size={20} />
                </button>
                <h3 className="text-lg font-bold text-unbox-dark mb-5">
                    {member ? 'Редактировать участника' : 'Новый участник'}
                </h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Photo preview */}
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 shrink-0">
                            {form.photo_url ? (
                                <img src={form.photo_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl font-bold">
                                    {form.name[0]?.toUpperCase() || '?'}
                                </div>
                            )}
                        </div>
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-600 mb-1">URL фото</label>
                            <input
                                type="url"
                                value={form.photo_url}
                                onChange={e => set('photo_url', e.target.value)}
                                placeholder="https://..."
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Имя *</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={e => set('name', e.target.value)}
                                placeholder="Николай"
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Тип роли</label>
                            <select
                                value={form.role_type}
                                onChange={e => set('role_type', e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            >
                                {ROLE_TYPES.map(r => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Должность (отображаемая) *</label>
                        <input
                            type="text"
                            value={form.role}
                            onChange={e => set('role', e.target.value)}
                            placeholder="Основатель, Администратор..."
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Bio (необязательно)</label>
                        <textarea
                            value={form.bio}
                            onChange={e => set('bio', e.target.value)}
                            rows={3}
                            placeholder="Краткое описание..."
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green resize-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Порядок</label>
                            <input
                                type="number"
                                value={form.sort_order}
                                onChange={e => set('sort_order', parseInt(e.target.value) || 0)}
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            />
                        </div>
                        <div className="flex items-end pb-0.5">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.is_active}
                                    onChange={e => set('is_active', e.target.checked)}
                                    className="w-4 h-4 accent-unbox-green"
                                />
                                <span className="text-sm text-gray-700">Активен</span>
                            </label>
                        </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose}
                            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">
                            Отмена
                        </button>
                        <button type="submit" disabled={saving}
                            className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 disabled:opacity-60">
                            {saving ? 'Сохранение...' : member ? 'Сохранить' : 'Добавить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}

export function AdminTeam() {
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [editMember, setEditMember] = useState<TeamMember | null | undefined>(undefined); // undefined = closed, null = new

    const load = async () => {
        try {
            const data = await teamApi.getAllAdmin();
            setMembers(data);
        } catch {
            toast.error('Ошибка загрузки команды');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleDelete = async (m: TeamMember) => {
        if (!confirm(`Удалить ${m.name}?`)) return;
        try {
            await teamApi.delete(m.id);
            toast.success('Участник удалён');
            load();
        } catch {
            toast.error('Ошибка удаления');
        }
    };

    const handleToggleActive = async (m: TeamMember) => {
        try {
            await teamApi.update(m.id, { is_active: !m.isActive });
            load();
        } catch {
            toast.error('Ошибка');
        }
    };

    const ROLE_LABEL: Record<string, string> = {
        founder: 'Основатель',
        senior_admin: 'Ст. администратор',
        admin: 'Администратор',
        other: 'Другое',
    };
    const ROLE_COLORS: Record<string, string> = {
        founder: 'bg-unbox-green/15 text-unbox-green',
        senior_admin: 'bg-blue-50 text-blue-700',
        admin: 'bg-gray-100 text-gray-600',
        other: 'bg-gray-50 text-gray-500',
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-unbox-dark">Наша команда</h1>
                    <p className="text-sm text-unbox-grey mt-0.5">Карточки отображаются на главной странице сайта</p>
                </div>
                <button
                    onClick={() => setEditMember(null)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90"
                >
                    <Plus size={15} />
                    Добавить участника
                </button>
            </div>

            {loading ? (
                <div className="text-center py-16 text-unbox-grey">Загрузка...</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                    {members.map(m => (
                        <div
                            key={m.id}
                            className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-opacity ${m.isActive ? 'border-unbox-light/50' : 'border-gray-200 opacity-60'}`}
                        >
                            {/* Photo */}
                            <div className="relative aspect-[3/4] bg-gray-100">
                                {m.photoUrl ? (
                                    <img src={m.photoUrl} alt={m.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-unbox-light to-white">
                                        <span className="text-4xl font-bold text-unbox-grey/30">{m.name[0]}</span>
                                    </div>
                                )}
                                {/* Actions overlay */}
                                <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                                    <button
                                        onClick={() => setEditMember(m)}
                                        className="w-9 h-9 rounded-xl bg-white text-gray-700 flex items-center justify-center hover:bg-unbox-green hover:text-white transition-colors shadow"
                                    >
                                        <Pencil size={15} />
                                    </button>
                                    <button
                                        onClick={() => handleToggleActive(m)}
                                        className="w-9 h-9 rounded-xl bg-white text-gray-700 flex items-center justify-center hover:bg-blue-500 hover:text-white transition-colors shadow"
                                    >
                                        {m.isActive ? <EyeOff size={15} /> : <Eye size={15} />}
                                    </button>
                                    <button
                                        onClick={() => handleDelete(m)}
                                        className="w-9 h-9 rounded-xl bg-white text-gray-700 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors shadow"
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                                {/* Sort order badge */}
                                <div className="absolute top-2 right-2 w-6 h-6 rounded-lg bg-white/80 flex items-center justify-center">
                                    <GripVertical size={12} className="text-gray-400" />
                                </div>
                            </div>

                            {/* Info */}
                            <div className="p-3">
                                <div className="font-semibold text-unbox-dark text-sm">{m.name}</div>
                                <div className="text-xs text-unbox-grey mt-0.5">{m.role}</div>
                                <div className="mt-2">
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[m.roleType] ?? 'bg-gray-100 text-gray-500'}`}>
                                        {ROLE_LABEL[m.roleType] ?? m.roleType}
                                    </span>
                                </div>
                                {m.bio && (
                                    <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">{m.bio}</p>
                                )}
                                <button
                                    onClick={() => setEditMember(m)}
                                    className="mt-3 w-full py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 hover:text-unbox-dark transition-colors"
                                >
                                    Редактировать
                                </button>
                            </div>
                        </div>
                    ))}

                    {/* Add card */}
                    <button
                        onClick={() => setEditMember(null)}
                        className="bg-white/50 rounded-2xl border-2 border-dashed border-gray-200 hover:border-unbox-green/40 hover:bg-white transition-all flex flex-col items-center justify-center gap-3 min-h-[200px] text-gray-400 hover:text-unbox-green"
                    >
                        <div className="w-10 h-10 rounded-xl border-2 border-dashed border-current flex items-center justify-center">
                            <Plus size={18} />
                        </div>
                        <span className="text-xs font-medium">Добавить</span>
                    </button>
                </div>
            )}

            {editMember !== undefined && (
                <MemberModal
                    member={editMember}
                    onClose={() => setEditMember(undefined)}
                    onSaved={load}
                />
            )}
        </div>
    );
}
