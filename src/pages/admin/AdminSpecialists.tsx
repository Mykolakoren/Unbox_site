import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Pencil, X, Clock, Check, XCircle, Loader2, Eye, EyeOff, Trash2,
    LayoutGrid, List, GripVertical, User, Video, MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { crmApi, type CrmAccessRequest } from '../../api/crm';
import { useUserStore } from '../../store/userStore';
import { hasPermission } from '../../utils/permissions';
import type { Specialist } from '../../components/Specialists/SpecialistCard';
import clsx from 'clsx';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import {
    DndContext, PointerSensor, TouchSensor,
    KeyboardSensor, useSensor, useSensors, type DragEndEvent,
    DragOverlay, closestCenter,
} from '@dnd-kit/core';
import {
    SortableContext, verticalListSortingStrategy,
    rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
    const [firstName, setFirstName] = useState((specialist as any).firstName ?? '');
    const [lastName, setLastName] = useState((specialist as any).lastName ?? '');
    const [photoUrl, setPhotoUrl] = useState((specialist as any).photoUrl ?? '');
    const [tagline, setTagline] = useState((specialist as any).tagline ?? '');
    const [bio, setBio] = useState((specialist as any).bio ?? '');
    const [basePriceGel, setBasePriceGel] = useState<number>((specialist as any).basePriceGel ?? 0);
    const [specializations, setSpecializations] = useState<string[]>((specialist as any).specializations ?? []);
    const [formats, setFormats] = useState<string[]>((specialist as any).formats ?? []);
    const [newSpec, setNewSpec] = useState('');
    const [allUsers, setAllUsers] = useState<{ id: string; email: string; name: string }[]>([]);
    const [saving, setSaving] = useState(false);

    const FORMAT_OPTIONS = [
        { value: 'ONLINE', label: 'Онлайн' },
        { value: 'OFFLINE', label: 'Оффлайн' },
    ];

    useEffect(() => {
        api.get('/users/').then(r => {
            setAllUsers(r.data.map((u: any) => ({ id: u.id, email: u.email, name: u.name })));
        }).catch(() => {});
    }, []);

    const toggleFormat = (fmt: string) =>
        setFormats(prev => prev.includes(fmt) ? prev.filter(f => f !== fmt) : [...prev, fmt]);

    const addSpec = (val: string) => {
        const trimmed = val.trim();
        if (!trimmed || specializations.includes(trimmed)) return;
        setSpecializations(prev => [...prev, trimmed]);
        setNewSpec('');
    };

    const removeSpec = (spec: string) =>
        setSpecializations(prev => prev.filter(s => s !== spec));

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload: any = {
                firstName,
                lastName,
                photoUrl: photoUrl || null,
                tagline,
                bio,
                basePriceGel,
                specializations,
                formats,
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-unbox-light px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                    <h3 className="font-bold text-lg text-unbox-dark">
                        Редактирование: {specialist.firstName} {specialist.lastName}
                    </h3>
                    <button onClick={onClose} className="text-unbox-dark/40 hover:text-unbox-dark">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Photo + Name */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-unbox-dark/60 uppercase tracking-wide">Основное</h4>
                        <div className="flex items-start gap-4">
                            <div className="shrink-0">
                                {photoUrl ? (
                                    <img src={photoUrl} alt="" className="w-16 h-16 rounded-xl object-cover border border-unbox-light" />
                                ) : (
                                    <div className="w-16 h-16 rounded-xl bg-unbox-green/15 flex items-center justify-center text-unbox-green font-bold text-xl">
                                        {firstName[0]}{lastName[0]}
                                    </div>
                                )}
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs text-unbox-grey mb-1">URL фото</label>
                                <input
                                    type="url"
                                    value={photoUrl}
                                    onChange={e => setPhotoUrl(e.target.value)}
                                    placeholder="https://..."
                                    className="w-full px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-unbox-grey mb-1">Имя</label>
                                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green" />
                            </div>
                            <div>
                                <label className="block text-xs text-unbox-grey mb-1">Фамилия</label>
                                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green" />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs text-unbox-grey mb-1">Tagline (короткое описание)</label>
                            <input type="text" value={tagline} onChange={e => setTagline(e.target.value)} maxLength={150}
                                className="w-full px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green" />
                        </div>

                        <div>
                            <label className="block text-xs text-unbox-grey mb-1">Bio (подробное описание)</label>
                            <textarea value={bio} onChange={e => setBio(e.target.value)} rows={4}
                                className="w-full px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green resize-none" />
                        </div>
                    </div>

                    {/* Specializations */}
                    <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-unbox-dark/60 uppercase tracking-wide">Специализации</h4>
                        <div className="flex flex-wrap gap-1.5">
                            {specializations.map(spec => (
                                <span key={spec} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-unbox-green/10 text-unbox-green">
                                    {spec}
                                    <button onClick={() => removeSpec(spec)} className="hover:text-red-500 transition-colors"><X size={10} /></button>
                                </span>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input type="text" value={newSpec} onChange={e => setNewSpec(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpec(newSpec); } }}
                                placeholder="Добавить специализацию..."
                                className="flex-1 px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green" />
                            <button onClick={() => addSpec(newSpec)} disabled={!newSpec.trim()}
                                className="px-3 py-2 rounded-lg bg-unbox-green/10 text-unbox-green hover:bg-unbox-green/20 disabled:opacity-40 transition-colors text-sm font-medium">
                                +
                            </button>
                        </div>
                    </div>

                    {/* Formats + Price */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-unbox-dark/60 uppercase tracking-wide">Формат и стоимость</h4>
                        <div className="flex gap-4">
                            {FORMAT_OPTIONS.map(opt => (
                                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={formats.includes(opt.value)} onChange={() => toggleFormat(opt.value)}
                                        className="w-4 h-4 rounded accent-unbox-green" />
                                    <span className="text-sm text-unbox-dark/80">{opt.label}</span>
                                </label>
                            ))}
                        </div>
                        <div>
                            <label className="block text-xs text-unbox-grey mb-1">Базовая цена (₾)</label>
                            <input type="number" value={basePriceGel} onChange={e => setBasePriceGel(Number(e.target.value))} min={0} step={5}
                                className="w-28 px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green" />
                        </div>
                    </div>

                    {/* Admin-only fields */}
                    <div className="space-y-3 pt-2 border-t border-unbox-light">
                        <h4 className="text-sm font-semibold text-unbox-dark/60 uppercase tracking-wide">Настройки (только для админа)</h4>

                        <div>
                            <label className="block text-xs text-unbox-grey mb-1">Категория</label>
                            <select value={category} onChange={e => setCategory(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm">
                                {CATEGORIES.map(c => (
                                    <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                            </select>
                        </div>

                        <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={isVerified} onChange={e => setIsVerified(e.target.checked)}
                                className="w-4 h-4 rounded accent-unbox-green" />
                            <span className="text-sm text-unbox-dark/70">Верифицирован (виден в каталоге)</span>
                        </label>

                        <div>
                            <label className="block text-xs text-unbox-grey mb-1">Привязать к аккаунту</label>
                            <select value={userId} onChange={e => setUserId(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm">
                                <option value="">— не привязан —</option>
                                {allUsers.map(u => (
                                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="sticky bottom-0 bg-white border-t border-unbox-light px-6 py-4 flex gap-2 rounded-b-2xl">
                    <button onClick={handleSave} disabled={saving}
                        className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        {saving ? 'Сохраняю...' : 'Сохранить'}
                    </button>
                    <button onClick={onClose}
                        className="px-4 py-2.5 rounded-xl border border-unbox-light text-sm text-unbox-dark/60 hover:bg-unbox-light">
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


// ── Sortable Card (Grid Preview) ────────────────────────────────────────────

function SortablePreviewCard({ specialist, onEdit, onToggleVisibility, onDelete, toggling, deleting }: {
    specialist: SpecialistExtended;
    onEdit: () => void;
    onToggleVisibility: () => void;
    onDelete: () => void;
    toggling: boolean;
    deleting: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: specialist.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 50 : 'auto' as any };

    const hasOnline = specialist.formats?.includes('ONLINE');
    const hasOffline = specialist.formats?.includes('OFFLINE') || specialist.formats?.includes('OFFLINE_ROOM');

    return (
        <div ref={setNodeRef} style={style} {...attributes}
            className={clsx(
                'bg-white rounded-2xl border overflow-hidden shadow-sm group relative transition-shadow',
                isDragging ? 'shadow-xl ring-2 ring-unbox-green' : 'hover:shadow-md',
                !specialist.isVerified && 'opacity-60'
            )}
        >
            {/* Drag handle + order badge */}
            <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
                <div {...listeners} className="bg-white/90 backdrop-blur-sm rounded-lg p-1.5 cursor-grab active:cursor-grabbing shadow-sm border border-white/50 hover:bg-white transition-colors">
                    <GripVertical size={14} className="text-gray-400" />
                </div>
                <span className="bg-white/90 backdrop-blur-sm text-[10px] font-bold text-unbox-dark/50 px-2 py-1 rounded-lg shadow-sm border border-white/50">
                    #{(specialist.sortOrder ?? 0) + 1}
                </span>
            </div>

            {/* Visibility badge */}
            <div className="absolute top-2 right-2 z-10">
                <span className={clsx(
                    'text-[10px] font-bold px-2 py-1 rounded-lg shadow-sm border border-white/50 backdrop-blur-sm',
                    specialist.isVerified ? 'bg-green-500/90 text-white' : 'bg-red-400/90 text-white'
                )}>
                    {specialist.isVerified ? 'Виден' : 'Скрыт'}
                </span>
            </div>

            {/* Image */}
            <div className="aspect-[3/4] overflow-hidden bg-gradient-to-br from-unbox-light to-white">
                {specialist.photoUrl ? (
                    <img src={specialist.photoUrl} alt={`${specialist.firstName} ${specialist.lastName}`}
                        className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-unbox-grey">
                        <User size={48} strokeWidth={1.5} />
                    </div>
                )}
            </div>

            {/* Price Badge (like on public site) */}
            <div className="absolute top-[58%] right-3 bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm text-sm font-bold text-unbox-dark border border-white/50">
                от {specialist.basePriceGel} ₾
            </div>

            {/* Content */}
            <div className="p-4">
                <h3 className="text-base font-bold text-unbox-dark leading-tight mb-1">
                    {specialist.firstName} {specialist.lastName}
                </h3>
                <p className="text-xs text-unbox-grey mb-3 line-clamp-2 border-l-2 border-unbox-green/30 pl-2">
                    {specialist.tagline}
                </p>

                {/* Formats */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {hasOnline && (
                        <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 bg-unbox-light text-unbox-green rounded-md">
                            <Video size={10} /> Онлайн
                        </span>
                    )}
                    {hasOffline && (
                        <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 bg-unbox-light text-unbox-dark rounded-md">
                            <MapPin size={10} /> Офлайн
                        </span>
                    )}
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1 mb-3">
                    {(specialist.specializations ?? []).slice(0, 2).map((tag, idx) => (
                        <span key={idx} className="text-[10px] px-2 py-0.5 bg-unbox-light/50 text-unbox-grey rounded-full border border-unbox-light">
                            {tag}
                        </span>
                    ))}
                    {(specialist.specializations?.length ?? 0) > 2 && (
                        <span className="text-[10px] px-2 py-0.5 bg-unbox-light/50 text-unbox-grey rounded-full border border-unbox-light">
                            +{specialist.specializations.length - 2}
                        </span>
                    )}
                </div>

                {/* Admin actions */}
                <div className="flex items-center gap-1 pt-2 border-t border-gray-100">
                    <button onClick={onToggleVisibility} disabled={toggling}
                        className={clsx('flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg transition-colors flex-1 justify-center',
                            specialist.isVerified ? 'text-unbox-green bg-unbox-green/10 hover:bg-unbox-green/20' : 'text-gray-400 bg-gray-50 hover:bg-gray-100'
                        )}>
                        {toggling ? <Loader2 size={11} className="animate-spin" /> : specialist.isVerified ? <Eye size={11} /> : <EyeOff size={11} />}
                        {specialist.isVerified ? 'Виден' : 'Скрыт'}
                    </button>
                    <button onClick={onEdit}
                        className="p-1.5 rounded-lg hover:bg-unbox-light transition-colors text-gray-400 hover:text-unbox-dark" title="Редактировать">
                        <Pencil size={13} />
                    </button>
                    <button onClick={onDelete} disabled={deleting}
                        className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-gray-300 hover:text-red-500" title="Удалить">
                        {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Sortable Table Row ──────────────────────────────────────────────────────

function SortableTableRow({ specialist, index, onEdit, onToggleVisibility, onDelete, toggling, deleting }: {
    specialist: SpecialistExtended;
    index: number;
    onEdit: () => void;
    onToggleVisibility: () => void;
    onDelete: () => void;
    toggling: boolean;
    deleting: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: specialist.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

    const categoryLabel = CATEGORIES.find(c => c.value === (specialist.category ?? ''))?.label ?? '—';

    return (
        <tr ref={setNodeRef} style={style} {...attributes}
            className={clsx('hover:bg-unbox-light/50 transition-colors', isDragging && 'bg-unbox-light/70 shadow-lg')}
        >
            {/* ── Drag handle + order ── */}
            <td className="p-2 pl-4 text-center">
                <div className="flex items-center gap-1 justify-center">
                    <div {...listeners} className="p-1 rounded cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors">
                        <GripVertical size={14} />
                    </div>
                    <span className="text-[11px] text-unbox-dark/40 font-mono leading-none w-5">{index + 1}</span>
                </div>
            </td>

            {/* ── Name + photo ── */}
            <td className="p-4">
                <div className="flex items-center gap-3">
                    {specialist.photoUrl ? (
                        <img src={specialist.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                    ) : (
                        <div className="w-9 h-9 rounded-full bg-unbox-green/15 flex items-center justify-center text-unbox-green font-bold text-sm">
                            {specialist.firstName?.[0]}{specialist.lastName?.[0]}
                        </div>
                    )}
                    <div>
                        <div className="font-medium text-unbox-dark text-sm">{specialist.firstName} {specialist.lastName}</div>
                        <div className="text-xs text-unbox-dark/40 truncate max-w-[180px]">{specialist.tagline}</div>
                    </div>
                </div>
            </td>

            <td className="p-4 text-sm text-unbox-dark/70">{categoryLabel}</td>

            <td className="p-4">
                <div className="flex flex-wrap gap-1">
                    {(specialist.specializations ?? []).slice(0, 2).map((sp: string) => (
                        <span key={sp} className="text-[10px] px-2 py-0.5 rounded-full bg-unbox-light text-unbox-dark/60">
                            {sp}
                        </span>
                    ))}
                </div>
            </td>

            <td className="p-4 text-sm text-unbox-dark/70">от {specialist.basePriceGel} ₾</td>

            {/* ── Visibility toggle ── */}
            <td className="p-4">
                <button
                    onClick={onToggleVisibility}
                    disabled={toggling}
                    className={clsx('flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors',
                        specialist.isVerified
                            ? 'text-unbox-green bg-unbox-green/10 hover:bg-unbox-green/20'
                            : 'text-unbox-dark/40 bg-unbox-light hover:bg-unbox-dark/10'
                    )}
                    title={specialist.isVerified ? 'Кликните чтобы скрыть' : 'Кликните чтобы показать'}
                >
                    {toggling ? <Loader2 size={13} className="animate-spin" /> : specialist.isVerified ? <Eye size={13} /> : <EyeOff size={13} />}
                    {specialist.isVerified ? 'Виден' : 'Скрыт'}
                </button>
            </td>

            {/* ── Actions ── */}
            <td className="p-4 text-right pr-6">
                <div className="flex items-center justify-end gap-1">
                    <button onClick={onEdit}
                        className="p-1.5 rounded-lg hover:bg-unbox-light transition-colors text-unbox-dark/40 hover:text-unbox-dark" title="Редактировать">
                        <Pencil size={14} />
                    </button>
                    <button onClick={onDelete} disabled={deleting}
                        className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-unbox-dark/30 hover:text-red-500" title="Удалить">
                        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                </div>
            </td>
        </tr>
    );
}


// ── Drag Overlay Cards ──────────────────────────────────────────────────────

function DragOverlayCard({ specialist }: { specialist: SpecialistExtended }) {
    return (
        <div className="bg-white rounded-2xl border border-unbox-green shadow-2xl overflow-hidden w-[240px] ring-2 ring-unbox-green">
            <div className="aspect-[3/4] overflow-hidden bg-gradient-to-br from-unbox-light to-white">
                {specialist.photoUrl ? (
                    <img src={specialist.photoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-unbox-grey">
                        <User size={48} strokeWidth={1.5} />
                    </div>
                )}
            </div>
            <div className="p-3">
                <h3 className="text-sm font-bold text-unbox-dark">{specialist.firstName} {specialist.lastName}</h3>
                <p className="text-[11px] text-unbox-grey line-clamp-1">{specialist.tagline}</p>
            </div>
        </div>
    );
}

function DragOverlayRow({ specialist }: { specialist: SpecialistExtended }) {
    return (
        <div className="bg-white rounded-xl shadow-2xl ring-2 ring-unbox-green px-4 py-3 flex items-center gap-3">
            {specialist.photoUrl ? (
                <img src={specialist.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
            ) : (
                <div className="w-9 h-9 rounded-full bg-unbox-green/15 flex items-center justify-center text-unbox-green font-bold text-sm">
                    {specialist.firstName?.[0]}{specialist.lastName?.[0]}
                </div>
            )}
            <div>
                <div className="font-medium text-unbox-dark text-sm">{specialist.firstName} {specialist.lastName}</div>
                <div className="text-xs text-unbox-dark/40">{specialist.tagline}</div>
            </div>
        </div>
    );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function AdminSpecialists() {
    const gridHouse = useDesignFlag();
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
    const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
    const [activeId, setActiveId] = useState<string | null>(null);
    const [specFilter, setSpecFilter] = useState<string>('all');

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
        useSensor(KeyboardSensor),
    );

    const load = async () => {
        try {
            const r = await api.get('/specialists/admin/all');
            const data: SpecialistExtended[] = r.data;
            data.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            setSpecialists(data);
        } catch {
            toast.error('Не удалось загрузить специалистов');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

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

    const handleDragStart = (event: any) => setActiveId(event.active.id as string);

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = specialists.findIndex(s => s.id === active.id);
        const newIndex = specialists.findIndex(s => s.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;

        const reordered = arrayMove(specialists, oldIndex, newIndex).map((s, i) => ({ ...s, sortOrder: i }));
        setSpecialists(reordered);

        // Save to backend
        api.post('/specialists/admin/reorder', {
            items: reordered.map(s => ({ id: s.id, sortOrder: s.sortOrder })),
        }).catch(() => {
            toast.error('Ошибка при сохранении порядка');
            load();
        });
    };

    const activeSpecialist = activeId ? specialists.find(s => s.id === activeId) : null;

    const verifiedCount = useMemo(() => specialists.filter(s => s.isVerified).length, [specialists]);

    // Unique specialization tags for filtering
    const allSpecTags = useMemo(() => {
        const tags = new Set<string>();
        specialists.forEach(s => (s.specializations ?? []).forEach(t => tags.add(t)));
        return Array.from(tags).sort((a, b) => a.localeCompare(b, 'ru'));
    }, [specialists]);

    const filteredSpecialists = useMemo(() => {
        if (specFilter === 'all') return specialists;
        return specialists.filter(s => (s.specializations ?? []).includes(specFilter));
    }, [specialists, specFilter]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (gridHouse) return (
        <GridHouseAdminSpecialists
            specialists={filteredSpecialists} loading={loading}
            activeTab={activeTab} setActiveTab={setActiveTab}
            viewMode={viewMode} setViewMode={setViewMode}
            canAcceptRequests={canAcceptRequests} verifiedCount={verifiedCount}
            editing={editing} setEditing={setEditing}
            toggling={toggling} deleting={deleting}
            handleToggleVisibility={handleToggleVisibility}
            handleDelete={handleDelete}
            sensors={sensors}
            handleDragStart={handleDragStart}
            handleDragEnd={handleDragEnd}
            activeSpecialist={activeSpecialist ?? null}
            load={load}
            specFilter={specFilter} setSpecFilter={setSpecFilter} allSpecTags={allSpecTags}
        />
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-unbox-dark">Специалисты</h1>
                    <p className="text-sm text-unbox-dark/50 mt-0.5">
                        {specialists.length} записей · {verifiedCount} видимых на сайте
                    </p>
                </div>
                {activeTab === 'specialists' && (
                    <div className="flex items-center gap-2">
                        <div className="flex bg-white/70 backdrop-blur rounded-xl p-1 border border-unbox-light">
                            <button onClick={() => setViewMode('table')}
                                className={clsx('p-2 rounded-lg transition-all', viewMode === 'table' ? 'bg-unbox-green text-white shadow-sm' : 'text-gray-400 hover:text-gray-600')}
                                title="Таблица">
                                <List size={16} />
                            </button>
                            <button onClick={() => setViewMode('cards')}
                                className={clsx('p-2 rounded-lg transition-all', viewMode === 'cards' ? 'bg-unbox-green text-white shadow-sm' : 'text-gray-400 hover:text-gray-600')}
                                title="Карточки (как на сайте)">
                                <LayoutGrid size={16} />
                            </button>
                        </div>
                    </div>
                )}
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
                    {/* Specialization filter tags */}
                    {allSpecTags.length > 1 && (
                        <div className="flex flex-wrap gap-1.5 mb-4">
                            <button
                                onClick={() => setSpecFilter('all')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${specFilter === 'all' ? 'bg-unbox-green text-white' : 'bg-unbox-light/50 text-unbox-grey hover:bg-unbox-light'}`}
                            >
                                Все направления
                            </button>
                            {allSpecTags.map(tag => (
                                <button
                                    key={tag}
                                    onClick={() => setSpecFilter(tag)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${specFilter === tag ? 'bg-unbox-green text-white' : 'bg-unbox-light/50 text-unbox-grey hover:bg-unbox-light'}`}
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                    )}
                    {loading ? (
                        <div className="text-center py-16 text-unbox-dark/40">
                            <Loader2 className="h-8 w-8 animate-spin mx-auto text-unbox-green mb-2" />
                            Загрузка...
                        </div>
                    ) : (
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                            {viewMode === 'cards' ? (
                                /* ── Card Grid View (like public site) ── */
                                <>
                                    <div className="bg-unbox-light/40 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-unbox-dark/50">
                                        <GripVertical size={12} />
                                        Перетащите карточки для изменения порядка отображения на сайте
                                    </div>
                                    <SortableContext items={filteredSpecialists.map(s => s.id)} strategy={rectSortingStrategy}>
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                            {filteredSpecialists.map(s => (
                                                <SortablePreviewCard key={s.id} specialist={s}
                                                    onEdit={() => setEditing(s)}
                                                    onToggleVisibility={() => handleToggleVisibility(s)}
                                                    onDelete={() => handleDelete(s)}
                                                    toggling={toggling === s.id}
                                                    deleting={deleting === s.id}
                                                />
                                            ))}
                                        </div>
                                    </SortableContext>
                                </>
                            ) : (
                                /* ── Table View ── */
                                <div className="bg-white rounded-xl border border-unbox-light overflow-hidden shadow-sm">
                                    <table className="w-full text-left">
                                        <thead className="bg-unbox-light border-b border-unbox-light text-unbox-grey font-medium text-sm">
                                            <tr>
                                                <th className="p-3 pl-4 w-16 text-center">№</th>
                                                <th className="p-4">Специалист</th>
                                                <th className="p-4">Категория</th>
                                                <th className="p-4">Специализации</th>
                                                <th className="p-4">Цена</th>
                                                <th className="p-4">Показ</th>
                                                <th className="p-4 text-right pr-6">Действия</th>
                                            </tr>
                                        </thead>
                                        <SortableContext items={filteredSpecialists.map(s => s.id)} strategy={verticalListSortingStrategy}>
                                            <tbody className="divide-y divide-unbox-light">
                                                {filteredSpecialists.map((s, idx) => (
                                                    <SortableTableRow key={s.id} specialist={s} index={idx}
                                                        onEdit={() => setEditing(s)}
                                                        onToggleVisibility={() => handleToggleVisibility(s)}
                                                        onDelete={() => handleDelete(s)}
                                                        toggling={toggling === s.id}
                                                        deleting={deleting === s.id}
                                                    />
                                                ))}
                                            </tbody>
                                        </SortableContext>
                                    </table>
                                </div>
                            )}
                            <DragOverlay>
                                {activeSpecialist && (
                                    viewMode === 'cards'
                                        ? <DragOverlayCard specialist={activeSpecialist} />
                                        : <DragOverlayRow specialist={activeSpecialist} />
                                )}
                            </DragOverlay>
                        </DndContext>
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

// ═══════════════════════════════════════════════════════════════════════════════
//  GRID HOUSE — AdminSpecialists
// ═══════════════════════════════════════════════════════════════════════════════

const ghaMono: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const,
};
const ghaHairline = `1px solid ${GH.ink10}`;

interface GHAdminSpecialistsProps {
    specialists: SpecialistExtended[];
    loading: boolean;
    activeTab: 'specialists' | 'crm-requests';
    setActiveTab: (t: 'specialists' | 'crm-requests') => void;
    viewMode: 'table' | 'cards';
    setViewMode: (m: 'table' | 'cards') => void;
    canAcceptRequests: boolean;
    verifiedCount: number;
    editing: SpecialistExtended | null;
    setEditing: (s: SpecialistExtended | null) => void;
    toggling: string | null;
    deleting: string | null;
    handleToggleVisibility: (s: SpecialistExtended) => void;
    handleDelete: (s: SpecialistExtended) => void;
    sensors: ReturnType<typeof useSensors>;
    handleDragStart: (event: any) => void;
    handleDragEnd: (event: DragEndEvent) => void;
    activeSpecialist: SpecialistExtended | null;
    load: () => void;
    specFilter?: string;
    setSpecFilter?: (f: string) => void;
    allSpecTags?: string[];
}

function GridHouseAdminSpecialists(props: GHAdminSpecialistsProps) {
    const {
        specialists, loading, activeTab, setActiveTab, viewMode, setViewMode,
        canAcceptRequests, verifiedCount, editing, setEditing,
        toggling, deleting, handleToggleVisibility, handleDelete,
        sensors, handleDragStart, handleDragEnd, activeSpecialist, load,
        specFilter = 'all', setSpecFilter, allSpecTags = [],
    } = props;

    const hiddenCount = specialists.length - verifiedCount;

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* ── Head ── */}
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 20, marginBottom: 32 }}>
                <p style={{ ...ghaMono, color: GH.ink30, marginBottom: 8 }}>ADMIN · SPECIALISTS</p>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                    <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1, margin: 0 }}>
                        Специалисты
                    </h1>
                    {activeTab === 'specialists' && (
                        <div style={{ display: 'flex' }}>
                            {(['table', 'cards'] as const).map((m, i) => (
                                <button key={m} onClick={() => setViewMode(m)}
                                    style={{
                                        padding: '6px 16px', border: 'none', cursor: 'pointer',
                                        fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                                        background: viewMode === m ? GH.ink : 'transparent',
                                        color: viewMode === m ? GH.paper : GH.ink60,
                                        borderTop: ghaHairline, borderBottom: ghaHairline,
                                        borderLeft: ghaHairline,
                                        borderRight: i === 1 ? ghaHairline : 'none',
                                    }}>
                                    {m === 'table' ? 'ТАБЛИЦА' : 'КАРТОЧКИ'}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── KPI strip ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 32, marginBottom: 32, alignItems: 'end' }}>
                <div>
                    <p style={{ ...ghaMono, color: GH.ink30, marginBottom: 4 }}>ВСЕГО</p>
                    <span style={{ fontFamily: GH_MONO, fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em' }}>
                        {specialists.length}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 28, paddingBottom: 6, flexWrap: 'wrap' }}>
                    <div>
                        <p style={{ ...ghaMono, color: GH.ink30, marginBottom: 2 }}>ВИДИМЫХ</p>
                        <span style={{ fontFamily: GH_MONO, fontSize: 22, fontWeight: 600, color: GH.accent }}>{verifiedCount}</span>
                    </div>
                    <div>
                        <p style={{ ...ghaMono, color: GH.ink30, marginBottom: 2 }}>СКРЫТЫХ</p>
                        <span style={{ fontFamily: GH_MONO, fontSize: 22, fontWeight: 600, color: GH.ink30 }}>{hiddenCount}</span>
                    </div>
                </div>
            </div>

            {/* ── Tabs ── */}
            {canAcceptRequests && (
                <div style={{ display: 'flex', gap: 0, borderBottom: ghaHairline, marginBottom: 24 }}>
                    {(['specialists', 'crm-requests'] as const).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)}
                            style={{
                                padding: '10px 20px', border: 'none', cursor: 'pointer',
                                fontFamily: GH_SANS, fontSize: 13, fontWeight: 600,
                                background: 'transparent',
                                color: activeTab === tab ? GH.ink : GH.ink30,
                                borderBottom: activeTab === tab ? `2px solid ${GH.ink}` : '2px solid transparent',
                                marginBottom: -1,
                            }}>
                            {tab === 'specialists' ? 'Специалисты' : 'Запросы CRM'}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Content ── */}
            {activeTab === 'crm-requests' && canAcceptRequests ? (
                <CrmAccessRequests />
            ) : (
                <>
                    {/* Specialization filter tags (GH) */}
                    {allSpecTags.length > 1 && setSpecFilter && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
                            {['all', ...allSpecTags].map(tag => (
                                <button key={tag} onClick={() => setSpecFilter(tag)}
                                    style={{
                                        fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                                        padding: '4px 12px', border: ghaHairline, cursor: 'pointer',
                                        background: specFilter === tag ? GH.ink : 'transparent',
                                        color: specFilter === tag ? GH.paper : GH.ink60,
                                    }}>
                                    {tag === 'all' ? 'Все' : tag}
                                </button>
                            ))}
                        </div>
                    )}
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '64px 0', color: GH.ink30 }}>
                            <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px', display: 'block' }} />
                            <p style={{ ...ghaMono }}>ЗАГРУЗКА…</p>
                        </div>
                    ) : (
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                            {viewMode === 'cards' ? (
                                <>
                                    <div style={{ ...ghaMono, color: GH.ink30, padding: '8px 0', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <GripVertical size={12} />
                                        ПЕРЕТАЩИТЕ ДЛЯ СОРТИРОВКИ
                                    </div>
                                    <SortableContext items={specialists.map(s => s.id)} strategy={rectSortingStrategy}>
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                            {specialists.map(s => (
                                                <SortablePreviewCard key={s.id} specialist={s}
                                                    onEdit={() => setEditing(s)}
                                                    onToggleVisibility={() => handleToggleVisibility(s)}
                                                    onDelete={() => handleDelete(s)}
                                                    toggling={toggling === s.id}
                                                    deleting={deleting === s.id}
                                                />
                                            ))}
                                        </div>
                                    </SortableContext>
                                </>
                            ) : (
                                /* ── GH Dense Table ── */
                                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '48px 1fr 140px 160px 72px 72px 56px',
                                        borderBottom: `2px solid ${GH.ink}`,
                                        padding: '8px 0',
                                        minWidth: 700,
                                    }}>
                                        {['№', 'СПЕЦИАЛИСТ', 'КАТЕГОРИЯ', 'СПЕЦИАЛИЗАЦИИ', 'ЦЕНА', 'ПОКАЗ', ''].map((h, i) => (
                                            <span key={i} style={{ ...ghaMono, color: GH.ink30, padding: '0 8px' }}>{h}</span>
                                        ))}
                                    </div>
                                    <SortableContext items={specialists.map(s => s.id)} strategy={verticalListSortingStrategy}>
                                        {specialists.map((s, idx) => (
                                            <GHSortableRow key={s.id} specialist={s} index={idx}
                                                onEdit={() => setEditing(s)}
                                                onToggleVisibility={() => handleToggleVisibility(s)}
                                                onDelete={() => handleDelete(s)}
                                                toggling={toggling === s.id}
                                                deleting={deleting === s.id}
                                            />
                                        ))}
                                    </SortableContext>
                                </div>
                            )}
                            <DragOverlay>
                                {activeSpecialist && (
                                    viewMode === 'cards'
                                        ? <DragOverlayCard specialist={activeSpecialist} />
                                        : <DragOverlayRow specialist={activeSpecialist} />
                                )}
                            </DragOverlay>
                        </DndContext>
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

            {/* ── Footer ── */}
            <div style={{ borderTop: `2px solid ${GH.ink}`, marginTop: 48, paddingTop: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ ...ghaMono, color: GH.ink30 }}>UNBOX ADMIN</span>
                <span style={{ ...ghaMono, color: GH.ink30 }}>2026</span>
            </div>
        </div>
    );
}

// ── GH Sortable Table Row ───────────────────────────────────────────────────

function GHSortableRow({ specialist, index, onEdit, onToggleVisibility, onDelete, toggling, deleting }: {
    specialist: SpecialistExtended;
    index: number;
    onEdit: () => void;
    onToggleVisibility: () => void;
    onDelete: () => void;
    toggling: boolean;
    deleting: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: specialist.id });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.3 : specialist.isVerified ? 1 : 0.45,
        display: 'grid',
        gridTemplateColumns: '48px 1fr 140px 160px 72px 72px 56px',
        alignItems: 'center',
        borderBottom: ghaHairline,
        padding: '10px 0',
        minWidth: 700,
    };

    const categoryLabel = CATEGORIES.find(c => c.value === (specialist.category ?? ''))?.label ?? '—';

    return (
        <div ref={setNodeRef} style={style} {...attributes}>
            {/* Drag + order */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                <div {...listeners} style={{ cursor: 'grab', padding: 2, color: GH.ink30 }}>
                    <GripVertical size={13} />
                </div>
                <span style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink30 }}>{index + 1}</span>
            </div>

            {/* Name + avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', minWidth: 0 }}>
                {specialist.photoUrl ? (
                    <img src={specialist.photoUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                    <div style={{
                        width: 32, height: 32, borderRadius: '50%', background: GH.ink5,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: GH_SANS, fontSize: 12, fontWeight: 700, color: GH.ink30, flexShrink: 0,
                    }}>
                        {specialist.firstName?.[0]}{specialist.lastName?.[0]}
                    </div>
                )}
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: GH_SANS, fontSize: 13, fontWeight: 600, color: GH.ink }}>{specialist.firstName} {specialist.lastName}</div>
                    <div style={{ fontFamily: GH_SANS, fontSize: 11, color: GH.ink30, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{specialist.tagline}</div>
                </div>
            </div>

            {/* Category */}
            <div style={{ fontFamily: GH_SANS, fontSize: 12, color: GH.ink60, padding: '0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {categoryLabel}
            </div>

            {/* Specializations */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '0 8px' }}>
                {(specialist.specializations ?? []).slice(0, 2).map((sp: string) => (
                    <span key={sp} style={{
                        fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.06em',
                        padding: '2px 6px', background: GH.ink5, color: GH.ink60,
                    }}>{sp}</span>
                ))}
                {(specialist.specializations?.length ?? 0) > 2 && (
                    <span style={{ fontFamily: GH_MONO, fontSize: 9, color: GH.ink30 }}>+{specialist.specializations!.length - 2}</span>
                )}
            </div>

            {/* Price */}
            <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, padding: '0 8px' }}>{specialist.basePriceGel}₾</div>

            {/* Visibility toggle */}
            <div style={{ padding: '0 8px' }}>
                <button onClick={onToggleVisibility} disabled={toggling}
                    style={{
                        border: 'none', cursor: 'pointer', padding: '3px 8px',
                        fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
                        background: specialist.isVerified ? 'rgba(71,109,107,0.12)' : GH.ink5,
                        color: specialist.isVerified ? GH.accent : GH.ink30,
                    }}>
                    {toggling ? '…' : specialist.isVerified ? 'ВКЛ' : 'ВЫКЛ'}
                </button>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end', padding: '0 4px' }}>
                <button onClick={onEdit} title="Редактировать"
                    style={{ border: 'none', cursor: 'pointer', padding: 4, background: 'transparent', color: GH.ink30, display: 'flex' }}>
                    <Pencil size={13} />
                </button>
                <button onClick={onDelete} disabled={deleting} title="Удалить"
                    style={{ border: 'none', cursor: 'pointer', padding: 4, background: 'transparent', color: GH.ink30, display: 'flex' }}>
                    {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
            </div>
        </div>
    );
}
