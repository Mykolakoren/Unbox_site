import { useState, useEffect } from 'react';
import { X, Save, Trash, Plus, Upload, Image, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { resourcesApi } from '../../api/resources';
import { useBookingStore } from '../../store/bookingStore';
import { CABINET_SERVICES } from '../../utils/data';
import type { Resource } from '../../types';

interface ResourceModalProps {
    resource: Resource | null;
    isOpen: boolean;
    onClose: () => void;
}

export function ResourceModal({ resource, isOpen, onClose }: ResourceModalProps) {
    const { fetchResources } = useBookingStore();
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

    if (!isOpen || !resource) return null;

    const handleSave = async () => {
        setIsLoading(true);
        try {
            await resourcesApi.update(resource.id, formData);
            await fetchResources();
            onClose();
        } catch (error) {
            console.error("Failed to update resource", error);
            alert("Ошибка сохранения. Попробуйте снова.");
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">

                {/* Header */}
                <div className="p-5 border-b border-gray-100 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-lg font-bold">{resource.name}</h2>
                        <p className="text-xs text-gray-500 mt-0.5">Редактирование кабинета</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-0 border-b border-gray-100 px-5 shrink-0">
                    {(['info', 'media', 'services'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                                activeTab === tab
                                    ? 'border-unbox-green text-unbox-green'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {tab === 'info' ? 'Основное' : tab === 'media' ? 'Фото' : 'Сервисы'}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5">

                    {/* === TAB: INFO === */}
                    {activeTab === 'info' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Название</label>
                                    <input
                                        type="text"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 focus:border-unbox-green"
                                        value={formData.name || ''}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Цена (₾/час)</label>
                                    <input
                                        type="number"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 focus:border-unbox-green"
                                        value={formData.hourlyRate || ''}
                                        onChange={(e) => setFormData({ ...formData, hourlyRate: Number(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Площадь (м²)</label>
                                    <input
                                        type="number"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 focus:border-unbox-green"
                                        value={formData.area || ''}
                                        onChange={(e) => setFormData({ ...formData, area: Number(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Вместимость (чел.)</label>
                                    <input
                                        type="number"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 focus:border-unbox-green"
                                        value={formData.capacity || ''}
                                        onChange={(e) => setFormData({ ...formData, capacity: Number(e.target.value) })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Описание</label>
                                <textarea
                                    rows={4}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 focus:border-unbox-green resize-none"
                                    placeholder="Опишите кабинет, его преимущества, для какой работы подходит..."
                                    value={formData.description || ''}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                />
                                <p className="text-xs text-gray-400 mt-1">{(formData.description || '').length} символов — это описание видят клиенты на сайте</p>
                            </div>

                            <div className="p-3 bg-gray-50 rounded-xl flex items-center gap-3">
                                <div className={`w-2.5 h-2.5 rounded-full ${formData.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                                <span className="text-sm text-gray-600">{formData.isActive ? 'Кабинет активен и виден клиентам' : 'Кабинет скрыт от клиентов'}</span>
                                <button
                                    onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                                    className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-white transition-colors"
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
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Загруженные фото ({(formData.photos || []).length})</p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(formData.photos || []).map((url, idx) => (
                                            <div key={idx} className="relative group aspect-video bg-gray-100 rounded-xl overflow-hidden border border-gray-200">
                                                <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                                                {idx === 0 && (
                                                    <span className="absolute top-1 left-1 bg-unbox-green text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                                                        Главное
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => removePhoto(idx)}
                                                    className="absolute top-1 right-1 bg-white/90 p-1 rounded-full text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                                >
                                                    <Trash size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-gray-400 mt-2">Первое фото используется как обложка карточки</p>
                                </div>
                            )}

                            {/* Upload / URL add */}
                            <div className="border-2 border-dashed border-gray-200 rounded-xl p-4">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-8 h-8 bg-unbox-light rounded-lg flex items-center justify-center">
                                        <Image size={16} className="text-unbox-grey" />
                                    </div>
                                    <p className="text-sm font-medium text-gray-700">Добавить фото</p>
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
                                                const res = await api.post('/upload', uploadData, {
                                                    headers: { 'Content-Type': 'multipart/form-data' }
                                                });
                                                const { API_URL } = await import('../../api/client');
                                                const baseUrl = API_URL.replace('/api/v1', '');
                                                const fullUrl = `${baseUrl}${res.data.url}`;
                                                const currentPhotos = formData.photos || [];
                                                setFormData({ ...formData, photos: [...currentPhotos, fullUrl] });
                                            } catch {
                                                alert("Ошибка загрузки фото");
                                            }
                                            e.target.value = '';
                                        }}
                                    />
                                    <label
                                        htmlFor="photo-upload"
                                        className="flex items-center justify-center gap-2 w-full py-2.5 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 bg-white text-sm font-medium transition-colors"
                                    >
                                        <Upload size={15} /> Загрузить с компьютера
                                    </label>
                                </div>

                                <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
                                    <span className="flex-1 border-t border-gray-200" />
                                    <span>или вставьте ссылку</span>
                                    <span className="flex-1 border-t border-gray-200" />
                                </div>

                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="https://example.com/photo.jpg"
                                        className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 focus:border-unbox-green"
                                        value={newPhotoUrl}
                                        onChange={(e) => setNewPhotoUrl(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && addPhoto()}
                                    />
                                    <button
                                        onClick={addPhoto}
                                        className="px-3 py-2 bg-unbox-green text-white rounded-xl hover:bg-unbox-dark transition-colors"
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Video URL */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Ссылка на видео (YouTube / Vimeo)</label>
                                <input
                                    type="text"
                                    placeholder="https://youtube.com/watch?v=..."
                                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 focus:border-unbox-green"
                                    value={formData.videoUrl || ''}
                                    onChange={(e) => setFormData({ ...formData, videoUrl: e.target.value })}
                                />
                            </div>
                        </div>
                    )}

                    {/* === TAB: SERVICES === */}
                    {activeTab === 'services' && (
                        <div className="space-y-4">
                            <p className="text-sm text-gray-500">
                                Отметьте всё, что есть в этом кабинете. Это будет показано клиентам на странице выбора кабинета.
                            </p>

                            <div className="grid grid-cols-2 gap-2">
                                {CABINET_SERVICES.map(service => {
                                    const isSelected = selectedServices.includes(service.id);
                                    return (
                                        <button
                                            key={service.id}
                                            onClick={() => toggleService(service.id)}
                                            className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                                                isSelected
                                                    ? 'border-unbox-green bg-unbox-green/5 text-unbox-dark'
                                                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                            }`}
                                        >
                                            <span className="text-xl leading-none">{service.emoji}</span>
                                            <span className="text-sm font-medium flex-1">{service.label}</span>
                                            {isSelected && (
                                                <div className="w-5 h-5 rounded-full bg-unbox-green flex items-center justify-center shrink-0">
                                                    <Check size={11} className="text-white" />
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {selectedServices.length > 0 && (
                                <div className="pt-3 border-t border-gray-100">
                                    <p className="text-xs text-gray-500 mb-2">Выбрано {selectedServices.length} из {CABINET_SERVICES.length}:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {selectedServices.map(id => {
                                            const svc = CABINET_SERVICES.find(s => s.id === id);
                                            return svc ? (
                                                <span key={id} className="inline-flex items-center gap-1 px-2.5 py-1 bg-unbox-green/10 text-unbox-green rounded-full text-xs font-medium">
                                                    {svc.emoji} {svc.label}
                                                </span>
                                            ) : null;
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-gray-100 bg-gray-50 flex justify-between items-center shrink-0 rounded-b-2xl">
                    <span className="text-xs text-gray-400">
                        {activeTab === 'services' && `${selectedServices.length} сервисов выбрано`}
                        {activeTab === 'media' && `${(formData.photos || []).length} фото`}
                    </span>
                    <div className="flex gap-3">
                        <Button variant="outline" onClick={onClose} disabled={isLoading}>
                            Отмена
                        </Button>
                        <Button onClick={handleSave} disabled={isLoading}>
                            {isLoading ? 'Сохранение...' : 'Сохранить'} <Save size={15} className="ml-2" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
