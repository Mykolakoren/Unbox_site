import { useState } from 'react';
import { Tag, Plus, X } from 'lucide-react';
import { useUserStore } from '../../store/userStore';

interface UserTagsProps {
    email: string;
    tags: string[];
}

const PRESET_TAGS = [
    { name: 'VIP', color: 'bg-yellow-100 text-yellow-700' },
    { name: 'Проблемный', color: 'bg-red-100 text-red-700' },
    { name: 'Новичок', color: 'bg-green-100 text-green-700' },
    { name: 'Должник', color: 'bg-orange-100 text-orange-700' },
    { name: 'Удаленщик', color: 'bg-blue-100 text-blue-700' },
];

export function UserTags({ email, tags }: UserTagsProps) {
    const { addUserTag, removeUserTag } = useUserStore();
    const [isAdding, setIsAdding] = useState(false);
    const [newTag, setNewTag] = useState('');

    const handleAdd = (tag: string) => {
        if (!tag.trim()) return;
        addUserTag(email, tag.trim());
        setNewTag('');
        setIsAdding(false);
    };

    return (
        <div className="bg-white p-6 rounded-2xl border border-gray-200">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Tag size={20} className="text-gray-400" />
                Теги клиента
            </h3>

            <div className="flex flex-wrap gap-2 mb-4">
                {tags.length === 0 && !isAdding && (
                    <span className="text-gray-400 text-sm italic">Нет тегов</span>
                )}

                {tags.map(tag => {
                    const preset = PRESET_TAGS.find(p => p.name === tag);
                    const colorClass = preset ? preset.color : 'bg-gray-100 text-gray-700';
                    return (
                        <div key={tag} className={`px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1 ${colorClass}`}>
                            {tag}
                            <button
                                onClick={() => removeUserTag(email, tag)}
                                className="hover:opacity-60"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    );
                })}

                {!isAdding ? (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="px-3 py-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-black transition-colors flex items-center gap-1 text-sm"
                    >
                        <Plus size={12} />
                        Добавить
                    </button>
                ) : (
                    <div className="relative flex items-center animate-in fade-in zoom-in duration-200">
                        <input
                            type="text"
                            autoFocus
                            className="px-3 py-1 rounded-full border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-black w-32"
                            placeholder="Название..."
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAdd(newTag);
                                if (e.key === 'Escape') setIsAdding(false);
                            }}
                            onBlur={() => {
                                if (newTag) handleAdd(newTag);
                                else setIsAdding(false);
                            }}
                        />
                    </div>
                )}
            </div>

            {/* Quick Presets */}
            {isAdding && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-50">
                    <span className="text-xs text-gray-400 w-full">Быстрый выбор:</span>
                    {PRESET_TAGS.filter(p => !tags.includes(p.name)).map(preset => (
                        <button
                            key={preset.name}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleAdd(preset.name)}
                            className={`px-2 py-0.5 rounded-md text-xs border border-transparent hover:border-black/10 transition-colors ${preset.color}`}
                        >
                            {preset.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
