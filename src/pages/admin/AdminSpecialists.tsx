import { useEffect, useRef, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Pencil, X, Clock, Check, XCircle, Loader2, Eye, EyeOff, Trash2,
    LayoutGrid, List, GripVertical, User, Video, MapPin, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, API_URL } from '../../api/client';
import { crmApi, type CrmAccessRequest } from '../../api/crm';
import { useUserStore } from '../../store/userStore';
import { hasPermission } from '../../utils/permissions';
import type { Specialist } from '../../components/Specialists/SpecialistCard';
import clsx from 'clsx';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { compressImage } from '../../utils/imageCompress';
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
    { value: 'neurology',  label: 'Неврологи' },
    { value: 'narcology',  label: 'Наркология' },
    { value: 'coaching',   label: 'Коучи и консультанты' },
    { value: 'education',  label: 'Игропрактики / Педагоги' },
];

// All fields in camelCase (after axios interceptor transforms snake_case → camelCase)
interface SpecialistExtended extends Specialist {
    category?: string | null;
    isVerified?: boolean;
    userId?: string;
    sortOrder?: number;
    /** Owner's card — pinned to the top, not draggable. */
    isOwner?: boolean;
    // Self-service application flow tag. NULL = legacy/admin-created (skip
    // queue). "pending" rows show up in the Заявки tab waiting for review.
    applicationStatus?: 'pending' | 'approved' | 'rejected' | null;
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
                                <label className="block text-xs text-unbox-grey mb-1">Фото профиля</label>
                                <SpecialistPhotoUpload onUploaded={setPhotoUrl} />
                                <input
                                    type="url"
                                    value={photoUrl}
                                    onChange={e => setPhotoUrl(e.target.value)}
                                    placeholder="…или вставьте ссылку https://..."
                                    className="w-full mt-2 px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                />
                                <div className="text-[10px] text-unbox-grey mt-1">jpg, png · до 2 МБ</div>
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

function SortablePreviewCard({ specialist, onEdit, onToggleVisibility, onDelete, toggling, deleting, onSpecClick, activeSpec }: {
    specialist: SpecialistExtended;
    onEdit: () => void;
    onToggleVisibility: () => void;
    onDelete: () => void;
    toggling: boolean;
    deleting: boolean;
    /** Click handler for specialization chips — toggles the page-level filter. */
    onSpecClick?: (spec: string) => void;
    activeSpec?: string;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: specialist.id, disabled: specialist.isOwner });
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
            {/* Drag handle + order badge. Owner card is pinned — no handle,
                a lock label instead. */}
            <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
                {specialist.isOwner ? (
                    <span className="bg-unbox-dark text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-sm">
                        Закреплено
                    </span>
                ) : (
                    <>
                        <div {...listeners} className="bg-white/90 backdrop-blur-sm rounded-lg p-1.5 cursor-grab active:cursor-grabbing shadow-sm border border-white/50 hover:bg-white transition-colors">
                            <GripVertical size={14} className="text-gray-400" />
                        </div>
                        <span className="bg-white/90 backdrop-blur-sm text-[10px] font-bold text-unbox-dark/50 px-2 py-1 rounded-lg shadow-sm border border-white/50">
                            #{(specialist.sortOrder ?? 0) + 1}
                        </span>
                    </>
                )}
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

                {/* Tags — clickable filter chips. Click toggles the page
                    filter; clicking the active chip clears it. */}
                <div className="flex flex-wrap gap-1 mb-3">
                    {(specialist.specializations ?? []).slice(0, 2).map((tag, idx) => {
                        const isActive = activeSpec === tag;
                        return (
                            <button
                                key={idx}
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onSpecClick?.(tag); }}
                                title={isActive ? `Снять фильтр «${tag}»` : `Фильтровать по «${tag}»`}
                                className={clsx(
                                    'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                                    isActive
                                        ? 'bg-unbox-dark text-white border-unbox-dark'
                                        : 'bg-unbox-light/50 text-unbox-grey border-unbox-light hover:bg-unbox-light',
                                    onSpecClick && 'cursor-pointer',
                                )}
                            >
                                {tag}
                            </button>
                        );
                    })}
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
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: specialist.id, disabled: specialist.isOwner });
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

// ── Applications Panel ───────────────────────────────────────────────────────
// Self-service specialist applications — anything with applicationStatus
// set goes here. "Approve" flips is_verified=True (catalog-visible) and the
// row drops out of the queue. "Reject" keeps the row so the user sees the
// decision in /become-specialist and can iterate.

function ApplicationsPanel({
    specialists, onChange, onEdit,
}: {
    specialists: SpecialistExtended[];
    onChange: () => void | Promise<void>;
    onEdit: (s: SpecialistExtended) => void;
}) {
    const [busyId, setBusyId] = useState<string | null>(null);
    const pending = specialists.filter(s => s.applicationStatus === 'pending');
    const decided = specialists.filter(s => s.applicationStatus === 'approved' || s.applicationStatus === 'rejected');

    const act = async (s: SpecialistExtended, kind: 'approve' | 'reject') => {
        setBusyId(s.id);
        try {
            await api.post(`/specialists/admin/${s.id}/${kind}`);
            toast.success(kind === 'approve' ? 'Заявка одобрена — специалист в каталоге' : 'Заявка отклонена');
            await onChange();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Ошибка');
        } finally {
            setBusyId(null);
        }
    };

    const renderRow = (s: SpecialistExtended) => (
        <div key={s.id} style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 110px 90px 230px',
            alignItems: 'center', padding: '14px 0', borderBottom: ghaHairline, gap: 12,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {s.photoUrl
                    ? <img src={s.photoUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: '50%' }} />
                    : <div style={{ width: 36, height: 36, background: GH.ink10, borderRadius: '50%' }} />}
                <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{s.firstName} {s.lastName}</div>
                    <div style={{ ...ghaMono, fontSize: 9, color: GH.ink60 }}>{s.category || '—'}</div>
                </div>
            </div>
            <div style={{ fontSize: 13, color: GH.ink60, lineHeight: 1.4 }}>
                {s.tagline || <span style={{ fontStyle: 'italic' }}>—</span>}
            </div>
            <div style={{ ...ghaMono, fontSize: 10 }}>
                {(s.formats || []).length} формат{(s.formats || []).length === 1 ? '' : 'а'}
            </div>
            <div style={{ fontFamily: GH_MONO, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {s.basePriceGel ? `${s.basePriceGel}₾` : '—'}
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => onEdit(s)}
                    style={{
                        fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' as const,
                        padding: '6px 10px', background: 'transparent', border: ghaHairline, cursor: 'pointer', color: GH.ink60,
                    }}>
                    Открыть
                </button>
                {s.applicationStatus === 'pending' ? (
                    <>
                        <button onClick={() => act(s, 'reject')} disabled={busyId === s.id}
                            style={{
                                fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' as const,
                                padding: '6px 10px', background: 'transparent', border: `1px solid ${GH.danger}`, color: GH.danger, cursor: 'pointer',
                                opacity: busyId === s.id ? 0.5 : 1,
                            }}>
                            Отклонить
                        </button>
                        <button onClick={() => act(s, 'approve')} disabled={busyId === s.id}
                            style={{
                                fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' as const,
                                padding: '6px 12px', background: GH.ink, border: 'none', color: GH.paper, cursor: 'pointer',
                                opacity: busyId === s.id ? 0.5 : 1,
                            }}>
                            Одобрить
                        </button>
                    </>
                ) : (
                    <span style={{
                        ...ghaMono, fontSize: 9,
                        padding: '6px 10px',
                        background: s.applicationStatus === 'approved' ? '#D1FAE5' : '#FEE2E2',
                        color: s.applicationStatus === 'approved' ? '#065F46' : '#991B1B',
                    }}>
                        {s.applicationStatus === 'approved' ? 'Одобрено' : 'Отклонено'}
                    </span>
                )}
            </div>
        </div>
    );

    return (
        <div>
            {pending.length === 0 && decided.length === 0 ? (
                <div style={{ padding: '64px 0', textAlign: 'center' }}>
                    <div style={{ ...ghaMono, color: GH.ink30 }}>Заявок пока нет</div>
                    <div style={{ fontSize: 13, color: GH.ink60, marginTop: 8 }}>
                        Специалисты подают заявки через <code>/become-specialist</code>
                    </div>
                </div>
            ) : (
                <>
                    {pending.length > 0 && (
                        <div style={{ marginBottom: 32 }}>
                            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
                                На рассмотрении <span style={{ color: GH.ink60, fontWeight: 500 }}>· {pending.length}</span>
                            </h3>
                            {pending.map(renderRow)}
                        </div>
                    )}
                    {decided.length > 0 && (
                        <div>
                            <h3 style={{ fontSize: 14, fontWeight: 600, color: GH.ink60, marginBottom: 12 }}>
                                История решений · {decided.length}
                            </h3>
                            {decided.map(renderRow)}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}


// ── Main Component ───────────────────────────────────────────────────────────

export function AdminSpecialists() {
        const [specialists, setSpecialists] = useState<SpecialistExtended[]>([]);
    const [editing, setEditing] = useState<SpecialistExtended | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchParams] = useSearchParams();
    const tabFromQuery = searchParams.get('tab');
    const initialTab: 'specialists' | 'crm-requests' | 'applications' =
        tabFromQuery === 'crm-requests' ? 'crm-requests'
        : tabFromQuery === 'applications' ? 'applications'
        : 'specialists';
    const [activeTab, setActiveTab] = useState<'specialists' | 'crm-requests' | 'applications'>(initialTab);
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
            // Backend already returns the canonical order: owner pinned,
            // then complete cards, then incomplete (no photo / empty bio).
            // Don't re-sort by sortOrder here or that grouping is lost.
            setSpecialists(r.data as SpecialistExtended[]);
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

        // The owner card is pinned — refuse to move it, and refuse to drop
        // anything above it.
        const dragged = specialists.find(s => s.id === active.id);
        if (dragged?.isOwner) {
            toast.info('Анкета владельца закреплена первой');
            return;
        }

        const oldIndex = specialists.findIndex(s => s.id === active.id);
        const newIndex = specialists.findIndex(s => s.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;

        let reordered = arrayMove(specialists, oldIndex, newIndex);
        // Force the owner back to index 0 no matter where the drag landed.
        const ownerIdx = reordered.findIndex(s => s.isOwner);
        if (ownerIdx > 0) {
            const [owner] = reordered.splice(ownerIdx, 1);
            reordered = [owner, ...reordered];
        }
        // Re-index: owner stays 0, everyone else 1…N.
        reordered = reordered.map((s, i) => ({ ...s, sortOrder: i }));
        setSpecialists(reordered);

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
    return (

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
    activeTab: 'specialists' | 'crm-requests' | 'applications';
    setActiveTab: (t: 'specialists' | 'crm-requests' | 'applications') => void;
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

    /** Click on a spec chip in a row/card → toggle the page filter.
     *  Clicking the chip already active clears the filter ("all"). */
    const handleSpecChipClick = (spec: string) => {
        if (!setSpecFilter) return;
        setSpecFilter(specFilter === spec ? 'all' : spec);
    };
    const activeSpec = specFilter !== 'all' ? specFilter : undefined;

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
            {/* "Заявки" appears unconditionally — every admin should be able
                to review specialist applications, even ones without the
                CRM-access permission. The number badge surfaces the queue
                size so it's not invisible. */}
            <div style={{ display: 'flex', gap: 0, borderBottom: ghaHairline, marginBottom: 24 }}>
                {(['specialists', 'applications', ...(canAcceptRequests ? ['crm-requests' as const] : [])] as const).map(tab => {
                    const pendingCount = tab === 'applications'
                        ? specialists.filter(s => s.applicationStatus === 'pending').length
                        : 0;
                    return (
                        <button key={tab} onClick={() => setActiveTab(tab)}
                            style={{
                                padding: '10px 20px', border: 'none', cursor: 'pointer',
                                fontFamily: GH_SANS, fontSize: 13, fontWeight: 600,
                                background: 'transparent',
                                color: activeTab === tab ? GH.ink : GH.ink30,
                                borderBottom: activeTab === tab ? `2px solid ${GH.ink}` : '2px solid transparent',
                                marginBottom: -1,
                                display: 'inline-flex', alignItems: 'center', gap: 8,
                            }}>
                            {tab === 'specialists' ? 'Специалисты' : tab === 'crm-requests' ? 'Запросы CRM' : 'Заявки'}
                            {tab === 'applications' && pendingCount > 0 && (
                                <span style={{
                                    fontFamily: GH_MONO, fontSize: 10, fontWeight: 700,
                                    background: GH.danger, color: GH.paper,
                                    padding: '2px 7px', borderRadius: 999,
                                    letterSpacing: '0.06em',
                                }}>
                                    {pendingCount}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* ── Content ── */}
            {activeTab === 'crm-requests' && canAcceptRequests ? (
                <CrmAccessRequests />
            ) : activeTab === 'applications' ? (
                <ApplicationsPanel
                    specialists={specialists}
                    onChange={load}
                    onEdit={setEditing}
                />
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
                                                    onSpecClick={handleSpecChipClick}
                                                    activeSpec={activeSpec}
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
                                                onSpecClick={handleSpecChipClick}
                                                activeSpec={activeSpec}
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

function GHSortableRow({ specialist, index, onEdit, onToggleVisibility, onDelete, toggling, deleting, onSpecClick, activeSpec }: {
    specialist: SpecialistExtended;
    index: number;
    onEdit: () => void;
    onToggleVisibility: () => void;
    onDelete: () => void;
    toggling: boolean;
    deleting: boolean;
    /** Click on a specialization chip → toggles filter for that tag. */
    onSpecClick?: (spec: string) => void;
    /** Currently-active filter; matching chips render highlighted. */
    activeSpec?: string;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: specialist.id, disabled: specialist.isOwner });
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

            {/* Specializations — chips are clickable filters now (admin
                request: same affordance as the role chips above the
                table). Active chip renders inverted; clicking it again
                clears the filter. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '0 8px' }}>
                {(specialist.specializations ?? []).slice(0, 2).map((sp: string) => {
                    const isActive = activeSpec === sp;
                    return (
                        <button
                            key={sp}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onSpecClick?.(sp); }}
                            title={isActive ? `Снять фильтр «${sp}»` : `Фильтровать по «${sp}»`}
                            style={{
                                fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.06em',
                                padding: '2px 6px',
                                background: isActive ? GH.ink : GH.ink5,
                                color: isActive ? GH.paper : GH.ink60,
                                border: 'none', cursor: onSpecClick ? 'pointer' : 'default',
                            }}
                        >{sp}</button>
                    );
                })}
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

/** File-pick upload, same pattern as CrmProfile.PhotoUpload but in
 *  Tailwind classes to fit the admin modal's visual language. Hits
 *  /upload, which already does 2MB server-side guard + image-only check. */
function SpecialistPhotoUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);
    const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            const upload = await compressImage(file);
            if (upload.size > 2 * 1024 * 1024) {
                toast.error('Фото слишком большое даже после сжатия — попробуйте другое.');
                return;
            }
            const data = new FormData();
            data.append('file', upload);
            const res = await api.post<{ url: string }>('/upload/', data, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const baseUrl = (API_URL || '').replace('/api/v1', '');
            onUploaded(`${baseUrl}${res.data.url}`);
            toast.success('Фото загружено — не забудьте «Сохранить»');
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось загрузить фото');
        } finally {
            setBusy(false);
            e.target.value = '';
        }
    };
    return (
        <>
            <input ref={inputRef} type="file" accept="image/*" onChange={handlePick} className="hidden" />
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg bg-unbox-dark text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {busy ? 'Загружаем…' : 'Загрузить с устройства'}
            </button>
        </>
    );
}
