import { useEffect, useState } from 'react';
import { CheckCircle, Circle, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { Specialist } from '../../components/Specialists/SpecialistCard';

const CATEGORIES = [
    { value: '', label: 'Без категории' },
    { value: 'psychology', label: 'Психологи и психотерапевты' },
    { value: 'psychiatry', label: 'Психиатры' },
    { value: 'narcology', label: 'Наркология / Неврология' },
    { value: 'coaching', label: 'Коучи и консультанты' },
    { value: 'education', label: 'Игропрактики / Педагоги' },
];

interface SpecialistExtended extends Specialist {
    category?: string | null;
    is_verified?: boolean;
}

interface EditModalProps {
    specialist: SpecialistExtended;
    onClose: () => void;
    onSaved: () => void;
}

function EditModal({ specialist, onClose, onSaved }: EditModalProps) {
    const [category, setCategory] = useState(specialist.category ?? '');
    const [isVerified, setIsVerified] = useState(specialist.is_verified ?? false);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.patch(`/specialists/admin/${specialist.id}`, {
                category: category || null,
                is_verified: isVerified,
            });
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

export function AdminSpecialists() {
    const [specialists, setSpecialists] = useState<SpecialistExtended[]>([]);
    const [editing, setEditing] = useState<SpecialistExtended | null>(null);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        try {
            const r = await api.get('/specialists/admin/all');
            setSpecialists(r.data);
        } catch {
            toast.error('Не удалось загрузить специалистов');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const categoryLabel = (cat?: string | null) =>
        CATEGORIES.find(c => c.value === (cat ?? ''))?.label ?? '—';

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-unbox-dark">Специалисты</h1>
                <span className="text-sm text-unbox-dark/50">{specialists.length} записей</span>
            </div>

            {loading ? (
                <div className="text-center py-16 text-unbox-dark/40">Загрузка...</div>
            ) : (
                <div className="bg-white rounded-xl border border-unbox-light overflow-hidden shadow-sm">
                    <table className="w-full text-left">
                        <thead className="bg-unbox-light border-b border-unbox-light text-unbox-grey font-medium text-sm">
                            <tr>
                                <th className="p-4 pl-6">Специалист</th>
                                <th className="p-4">Категория</th>
                                <th className="p-4">Специализации</th>
                                <th className="p-4">Цена</th>
                                <th className="p-4">Статус</th>
                                <th className="p-4 text-right pr-6">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-unbox-light">
                            {specialists.map(s => (
                                <tr key={s.id} className="hover:bg-unbox-light/50 transition-colors">
                                    <td className="p-4 pl-6">
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
                                    <td className="p-4 text-sm text-unbox-dark/70">{categoryLabel((s as SpecialistExtended).category)}</td>
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
                                    <td className="p-4">
                                        {s.is_verified ? (
                                            <span className="flex items-center gap-1 text-unbox-green text-xs font-medium">
                                                <CheckCircle size={13} /> Верифицирован
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-unbox-dark/40 text-xs">
                                                <Circle size={13} /> Не верифицирован
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-4 text-right pr-6">
                                        <button
                                            onClick={() => setEditing(s)}
                                            className="p-1.5 rounded-lg hover:bg-unbox-light transition-colors text-unbox-dark/40 hover:text-unbox-dark"
                                        >
                                            <Pencil size={14} />
                                        </button>
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
        </div>
    );
}
