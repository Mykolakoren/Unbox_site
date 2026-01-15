import { useState, useEffect } from 'react';
import { X, Save, Trash, Plus, Upload } from 'lucide-react';
import { Button } from '../ui/Button';

import { resourcesApi } from '../../api/resources';
import { useBookingStore } from '../../store/bookingStore';
import type { Resource } from '../../types';

interface ResourceModalProps {
    resource: Resource | null;
    isOpen: boolean;
    onClose: () => void;
}

export function ResourceModal({ resource, isOpen, onClose }: ResourceModalProps) {
    const { fetchResources } = useBookingStore();
    const [isLoading, setIsLoading] = useState(false);

    // Form State
    const [formData, setFormData] = useState<Partial<Resource>>({});
    const [newPhotoUrl, setNewPhotoUrl] = useState('');

    useEffect(() => {
        if (resource) {
            setFormData(JSON.parse(JSON.stringify(resource))); // Deep copy
        } else {
            setFormData({}); // Clear for create mode (future)
        }
    }, [resource, isOpen]);

    if (!isOpen || !resource) return null;

    const handleSave = async () => {
        setIsLoading(true);
        try {
            await resourcesApi.update(resource.id, formData);
            await fetchResources(); // Refresh store
            onClose();
        } catch (error) {
            console.error("Failed to update resource", error);
            alert("Failed to save changes");
        } finally {
            setIsLoading(false);
        }
    };

    const addPhoto = () => {
        if (!newPhotoUrl) return;
        const currentPhotos = formData.photos || [];
        setFormData({ ...formData, photos: [...currentPhotos, newPhotoUrl] });
        setNewPhotoUrl('');
    };

    const removePhoto = (index: number) => {
        const currentPhotos = formData.photos || [];
        setFormData({ ...formData, photos: currentPhotos.filter((_, i) => i !== index) });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
                    <h2 className="text-xl font-bold">Редактирование: {resource.name}</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Название</label>
                            <input
                                type="text"
                                className="w-full p-2 border rounded-lg"
                                value={formData.name || ''}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Цена (₾/час)</label>
                            <input
                                type="number"
                                className="w-full p-2 border rounded-lg"
                                value={formData.hourlyRate || ''}
                                onChange={(e) => setFormData({ ...formData, hourlyRate: Number(e.target.value) })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Площадь (м²)</label>
                            <input
                                type="number"
                                className="w-full p-2 border rounded-lg"
                                value={formData.area || ''}
                                onChange={(e) => setFormData({ ...formData, area: Number(e.target.value) })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Вместимость (чел.)</label>
                            <input
                                type="number"
                                className="w-full p-2 border rounded-lg"
                                value={formData.capacity || ''}
                                onChange={(e) => setFormData({ ...formData, capacity: Number(e.target.value) })}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Описание</label>
                        <textarea
                            className="w-full p-2 border rounded-lg h-24"
                            value={formData.description || ''}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>

                    {/* Media */}
                    <div className="space-y-4 pt-4 border-t border-gray-100">
                        <h3 className="font-bold">Фото и Видео</h3>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Ссылка на видео (YouTube/Vimeo)</label>
                            <input
                                type="text"
                                placeholder="https://..."
                                className="w-full p-2 border rounded-lg"
                                value={formData.videoUrl || ''}
                                onChange={(e) => setFormData({ ...formData, videoUrl: e.target.value })}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Фотографии</label>

                            {/* Upload & URL Input */}
                            <div className="flex flex-col gap-2 mb-4">
                                <div className="flex gap-2">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        id="photo-upload"
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;

                                            // Handle Upload
                                            const uploadData = new FormData();
                                            uploadData.append('file', file);

                                            try {
                                                const { api } = await import('../../api/client'); // Dynamic import to avoid cycles or simple access
                                                const res = await api.post('/upload', uploadData, {
                                                    headers: { 'Content-Type': 'multipart/form-data' }
                                                });
                                                // Backend returns relative URL: /uploads/filename.jpg
                                                // We need absolute URL for frontend? Or relative works if we proxy?
                                                // Vite dev server handles proxy? Or we need full URL.
                                                // Backend is on localhost:8000. Frontend on localhost:5173.
                                                // Relative /uploads/... will try localhost:5173/uploads/...
                                                // We need `http://localhost:8000/uploads/...`.
                                                // Let's prepend it here for store simplicity.
                                                // Wait, API_URL in client.ts is `http://127.0.0.1:8000/api/v1`.
                                                // We need `http://127.0.0.1:8000`.
                                                const { API_URL } = await import('../../api/client');
                                                const baseUrl = API_URL.replace('/api/v1', '');
                                                const fullUrl = `${baseUrl}${res.data.url}`;

                                                const currentPhotos = formData.photos || [];
                                                setFormData({ ...formData, photos: [...currentPhotos, fullUrl] });
                                            } catch (err) {
                                                console.error(err);
                                                alert("Ошибка загрузки фото");
                                            }
                                        }}
                                    />
                                    <label
                                        htmlFor="photo-upload"
                                        className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 bg-white text-sm font-medium transition-colors gap-2"
                                    >
                                        <Upload size={16} /> Загрузить фото
                                    </label>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span className="w-full border-t border-gray-200"></span>
                                    <span>ИЛИ ссылка</span>
                                    <span className="w-full border-t border-gray-200"></span>
                                </div>
                                <div className="flex gap-2">

                                    <input
                                        type="text"
                                        placeholder="https://example.com/photo.jpg"
                                        className="w-full p-2 border rounded-lg"
                                        value={newPhotoUrl}
                                        onChange={(e) => setNewPhotoUrl(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && addPhoto()}
                                    />
                                    <Button size="sm" onClick={addPhoto} variant="secondary">
                                        <Plus size={16} />
                                    </Button>
                                </div>
                            </div>

                            {/* Photo List */}
                            <div className="grid grid-cols-3 gap-2 mt-4">
                                {(formData.photos || []).map((url, idx) => (
                                    <div key={idx} className="relative group aspect-video bg-gray-100 rounded-lg overflow-hidden border">
                                        <img src={url} alt={`Photo ${idx}`} className="w-full h-full object-cover" />
                                        <button
                                            onClick={() => removePhoto(idx)}
                                            className="absolute top-1 right-1 bg-white/90 p-1 rounded-full text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                        >
                                            <Trash size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 rounded-b-2xl sticky bottom-0">
                    <Button variant="outline" onClick={onClose} disabled={isLoading}>
                        Отмена
                    </Button>
                    <Button onClick={handleSave} disabled={isLoading}>
                        {isLoading ? 'Сохранение...' : 'Сохранить изменения'} <Save size={16} className="ml-2" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
