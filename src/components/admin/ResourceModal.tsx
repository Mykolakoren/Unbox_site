import { useState, useEffect } from 'react';
import {
    Trash, Plus, Upload, Image, Check,
    Shovel, Sun, VolumeX, Sofa, Droplet, DoorOpen, Coffee, Presentation, Projector, PenLine, Snowflake, Wifi,
    type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { useConfirmDialog } from '../ui/ConfirmDialogProvider';
import { ruCountWord } from '../../utils/plural';
import { resourcesApi } from '../../api/resources';
import { useBookingStore } from '../../store/bookingStore';
import { CABINET_SERVICES } from '../../utils/data';
import type { Resource, Location } from '../../types';

// Значки сервисов кабинета — Lucide вместо эмодзи из справочника (wave 1).
const SERVICE_ICONS: Record<string, LucideIcon> = {
    sandbox: Shovel,
    natural_light: Sun,
    soundproof: VolumeX,
    couch: Sofa,
    washbasin: Droplet,
    private_entrance: DoorOpen,
    coffee: Coffee,
    flipchart: Presentation,
    projector: Projector,
    whiteboard: PenLine,
    climate_control: Snowflake,
    wifi: Wifi,
};

interface ResourceModalProps {
    resource: Resource | null;
    isOpen: boolean;
    onClose: () => void;
    /** Живой список локаций — для подписи «Кабинет · Unbox Uni». */
    locations?: Location[];
}

/**
 * Правка кабинета — на общем Sheet (волна 4, пакет D; G8-09/G8-17):
 * Esc, фокус внутри, подвал с «Сохранить» всегда виден; закрыть с
 * несохранёнными правками — только через вопрос. Сохранение прежнее
 * (resourcesApi.update + fetchResources).
 */
export function ResourceModal({ resource, isOpen, onClose, locations }: ResourceModalProps) {
    const { fetchResources } = useBookingStore();
    const { confirm } = useConfirmDialog();
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'info' | 'media' | 'services'>('info');

    // Form State
    const [formData, setFormData] = useState<Partial<Resource>>({});
    const [newPhotoUrl, setNewPhotoUrl] = useState('');

    useEffect(() => {
        if (resource) {
            setFormData(JSON.parse(JSON.stringify(resource))); // Deep copy
        } else {
            setFormData({});
        }
        setActiveTab('info');
    }, [resource, isOpen]);

    if (!resource) return null;

    const dirty = JSON.stringify(formData) !== JSON.stringify(resource) || newPhotoUrl.trim() !== '';
    const requestClose = async () => {
        if (isLoading) return;
        if (!dirty) { onClose(); return; }
        const ok = await confirm({
            title: 'Закрыть без сохранения?',
            body: 'Правки в карточке кабинета пропадут.',
            confirmLabel: 'Закрыть без сохранения',
            cancelLabel: 'Вернуться к правке',
        });
        if (ok) onClose();
    };
    const locationName = locations?.find(l => l.id === resource.locationId)?.name;

    const handleSave = async () => {
        setIsLoading(true);
        try {
            await resourcesApi.update(resource.id, formData);
            await fetchResources();
            onClose();
        } catch (error) {
            console.error("Failed to update resource", error);
            toast.error('Не удалось сохранить кабинет. Проверьте интернет и нажмите «Сохранить» ещё раз.');
        } finally {
            setIsLoading(false);
        }
    };

    const addPhoto = () => {
        if (!newPhotoUrl.trim()) return;
        const currentPhotos = formData.photos || [];
        setFormData({ ...formData, photos: [...currentPhotos, newPhotoUrl.trim()] });
        setNewPhotoUrl('');
    };

    const removePhoto = (index: number) => {
        const currentPhotos = formData.photos || [];
        setFormData({ ...formData, photos: currentPhotos.filter((_, i) => i !== index) });
    };

    const toggleService = (serviceId: string) => {
        const current = formData.services || [];
        const updated = current.includes(serviceId)
            ? current.filter(s => s !== serviceId)
            : [...current, serviceId];
        setFormData({ ...formData, services: updated });
    };

    const selectedServices = formData.services || [];

    return (
        <Sheet
            open={isOpen}
            onClose={requestClose}
            title={resource.name}
            description={`Правка кабинета${locationName ? ` · ${locationName}` : ''}`}
            width={680}
            dismissible={!isLoading}
            footer={
                <>
                    <Button block loading={isLoading} onClick={handleSave}>Сохранить кабинет</Button>
                    <Button block variant="secondary" onClick={requestClose} disabled={isLoading}>Отмена</Button>
                </>
            }
        >
                {/* Tabs */}
                <div role="tablist" aria-label="Разделы карточки кабинета" className="flex gap-0 border-b border-ink-10 mb-4">
                    {(['info', 'media', 'services'] as const).map(tab => (
                        <button
                            key={tab}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                                activeTab === tab
                                    ? 'border-accent text-accent-ink'
                                    : 'border-transparent text-ink-60 hover:text-ink'
                            }`}
                        >
                            {tab === 'info' ? 'Основное'
                                : tab === 'media' ? `Фото${(formData.photos || []).length ? ` · ${(formData.photos || []).length}` : ''}`
                                : `Сервисы${selectedServices.length ? ` · ${selectedServices.length}` : ''}`}
                        </button>
                    ))}
                </div>

                <div>

                    {/* === TAB: INFO === */}
                    {activeTab === 'info' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-ink-60 uppercase tracking-wider mb-1.5">Название</label>
                                    <input
                                        type="text"
                                        className="w-full px-3 py-2 border border-ink-10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                                        value={formData.name || ''}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-ink-60 uppercase tracking-wider mb-1.5">Цена (₾/час)</label>
                                    <input
                                        type="number"
                                        className="w-full px-3 py-2 border border-ink-10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                                        value={formData.hourlyRate || ''}
                                        onChange={(e) => setFormData({ ...formData, hourlyRate: Number(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-ink-60 uppercase tracking-wider mb-1.5">Площадь (м²)</label>
                                    <input
                                        type="number"
                                        className="w-full px-3 py-2 border border-ink-10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                                        value={formData.area || ''}
                                        onChange={(e) => setFormData({ ...formData, area: Number(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-ink-60 uppercase tracking-wider mb-1.5">Вместимость (чел.)</label>
                                    <input
                                        type="number"
                                        className="w-full px-3 py-2 border border-ink-10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                                        value={formData.capacity || ''}
                                        onChange={(e) => setFormData({ ...formData, capacity: Number(e.target.value) })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-ink-60 uppercase tracking-wider mb-1.5">Описание</label>
                                <textarea
                                    rows={4}
                                    className="w-full px-3 py-2 border border-ink-10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none"
                                    placeholder="Опишите кабинет, его преимущества, для какой работы подходит..."
                                    value={formData.description || ''}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                />
                                <p className="text-xs text-ink-60 mt-1">{(formData.description || '').length} символов — это описание видят клиенты на сайте</p>
                            </div>

                            <div className="p-3 bg-sunken rounded-xl flex items-center gap-3">
                                <div className={`w-2.5 h-2.5 rounded-full ${formData.isActive ? 'bg-[var(--status-ok-fg)]' : 'bg-ink-40'}`} aria-hidden="true" />
                                <span className="text-sm text-ink-80">{formData.isActive ? 'Кабинет активен и виден клиентам' : 'Кабинет скрыт от клиентов'}</span>
                                <button
                                    onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                                    className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-ink-10 hover:bg-card transition-colors"
                                >
                                    {formData.isActive ? 'Скрыть' : 'Активировать'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* === TAB: MEDIA === */}
                    {activeTab === 'media' && (
                        <div className="space-y-5">
                            {/* Current photos grid */}
                            {(formData.photos || []).length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-ink-60 uppercase tracking-wider mb-3">Загруженные фото ({(formData.photos || []).length})</p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(formData.photos || []).map((url, idx) => (
                                            <div key={idx} className="relative group aspect-video bg-sunken rounded-xl overflow-hidden border border-ink-10">
                                                <img src={url} alt={`Фото ${idx + 1}`} className="w-full h-full object-cover" />
                                                {idx === 0 && (
                                                    <span className="absolute top-1 left-1 bg-ink text-paper text-xs font-semibold px-1.5 py-0.5 rounded-md">
                                                        Главное
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => removePhoto(idx)}
                                                    aria-label="Удалить фото"
                                                    className="absolute top-1 right-1 bg-card p-1 rounded-full text-[var(--status-danger-fg)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity shadow-sm"
                                                >
                                                    <Trash size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-ink-60 mt-2">Первое фото используется как обложка карточки</p>
                                </div>
                            )}

                            {/* Upload / URL add */}
                            <div className="border-2 border-dashed border-ink-10 rounded-xl p-4">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-8 h-8 bg-sunken rounded-lg flex items-center justify-center">
                                        <Image size={16} className="text-ink-60" />
                                    </div>
                                    <p className="text-sm font-medium text-ink-80">Добавить фото</p>
                                </div>

                                {/* File upload */}
                                <div className="mb-3">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        id="photo-upload"
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            const uploadData = new FormData();
                                            uploadData.append('file', file);
                                            try {
                                                const { api } = await import('../../api/client');
                                                const res = await api.post('/upload/', uploadData, {
                                                    headers: { 'Content-Type': 'multipart/form-data' }
                                                });
                                                const { API_URL } = await import('../../api/client');
                                                const baseUrl = API_URL.replace('/api/v1', '');
                                                const fullUrl = `${baseUrl}${res.data.url}`;
                                                const currentPhotos = formData.photos || [];
                                                setFormData({ ...formData, photos: [...currentPhotos, fullUrl] });
                                            } catch {
                                                toast.error('Не удалось загрузить фото. Попробуйте ещё раз или вставьте ссылку.');
                                            }
                                            e.target.value = '';
                                        }}
                                    />
                                    <label
                                        htmlFor="photo-upload"
                                        className="flex items-center justify-center gap-2 w-full py-2.5 border border-ink-10 rounded-xl cursor-pointer hover:bg-sunken bg-card text-sm font-medium transition-colors"
                                    >
                                        <Upload size={15} /> Загрузить с компьютера
                                    </label>
                                </div>

                                <div className="flex items-center gap-2 text-xs text-ink-60 mb-3">
                                    <span className="flex-1 border-t border-ink-10" />
                                    <span>или вставьте ссылку</span>
                                    <span className="flex-1 border-t border-ink-10" />
                                </div>

                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="https://example.com/photo.jpg"
                                        className="flex-1 px-3 py-2 border border-ink-10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                                        value={newPhotoUrl}
                                        onChange={(e) => setNewPhotoUrl(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && addPhoto()}
                                    />
                                    <button
                                        type="button"
                                        onClick={addPhoto}
                                        aria-label="Добавить фото по ссылке"
                                        className="px-3 py-2 bg-ink text-paper rounded-xl hover:bg-ink-80 transition-colors"
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Video URL */}
                            <div>
                                <label className="block text-xs font-semibold text-ink-60 uppercase tracking-wider mb-1.5">Ссылка на видео (YouTube / Vimeo)</label>
                                <input
                                    type="text"
                                    placeholder="https://youtube.com/watch?v=..."
                                    className="w-full px-3 py-2 border border-ink-10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                                    value={formData.videoUrl || ''}
                                    onChange={(e) => setFormData({ ...formData, videoUrl: e.target.value })}
                                />
                            </div>
                        </div>
                    )}

                    {/* === TAB: SERVICES === */}
                    {activeTab === 'services' && (
                        <div className="space-y-4">
                            <p className="text-sm text-ink-60">
                                Отметьте всё, что есть в этом кабинете. Это будет показано клиентам на странице выбора кабинета.
                            </p>

                            <div className="grid grid-cols-2 gap-2">
                                {CABINET_SERVICES.map(service => {
                                    const isSelected = selectedServices.includes(service.id);
                                    return (
                                        <button
                                            key={service.id}
                                            type="button"
                                            aria-pressed={isSelected}
                                            onClick={() => toggleService(service.id)}
                                            className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                                                isSelected
                                                    ? 'border-accent bg-accent-soft text-ink'
                                                    : 'border-ink-10 hover:border-ink-40 text-ink-80'
                                            }`}
                                        >
                                            {(() => {
                                                const Icon = SERVICE_ICONS[service.id] ?? Check;
                                                return <Icon size={20} aria-hidden="true" className="shrink-0" />;
                                            })()}
                                            <span className="text-sm font-medium flex-1">{service.label}</span>
                                            {isSelected && (
                                                <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0">
                                                    <Check size={11} className="text-card" />
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {selectedServices.length > 0 && (
                                <div className="pt-3 border-t border-ink-10">
                                    <p className="text-xs text-ink-60 mb-2">Выбрано {selectedServices.length} из {CABINET_SERVICES.length}:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {selectedServices.map(id => {
                                            const svc = CABINET_SERVICES.find(s => s.id === id);
                                            return svc ? (
                                                <span key={id} className="inline-flex items-center gap-1 px-2.5 py-1 bg-accent-soft text-accent-ink rounded-full text-xs font-medium">
                                                    {svc.label}
                                                </span>
                                            ) : null;
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
        </Sheet>
    );
}
