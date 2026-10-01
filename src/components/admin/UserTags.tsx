import { useState } from 'react';
import { Tag, Plus, X } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { undoToast } from '../ui/undoToast';

interface UserTagsProps {
    email: string;
    tags: string[];
}

// Цвет тега — по смыслу, только статусные токены (wave 1): «опасно» —
// проблемный/должник, «ок» — новичок, VIP — нейтрально-выделенный.
const PRESET_TAGS = [
    { name: 'VIP', color: 'bg-accent-soft text-accent-ink' },
    { name: 'Проблемный', color: 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]' },
    { name: 'Новичок', color: 'bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]' },
    { name: 'Должник', color: 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]' },
    { name: 'Удаленщик', color: 'bg-[var(--status-muted-bg)] text-[var(--status-muted-fg)]' },
];

export function UserTags({ email, tags }: UserTagsProps) {
    const { addUserTag, removeUserTag } = useUserStore();
    const [isAdding, setIsAdding] = useState(false);
    const [newTag, setNewTag] = useState('');

    // Волна 4: тег снимается сразу, «Вернуть» — 5 секунд.
    const handleRemove = (tag: string) => {
        removeUserTag(email, tag);
        undoToast(`Тег «${tag}» снят`, () => addUserTag(email, tag));
    };

    const handleAdd = (tag: string) => {
        if (!tag.trim()) return;
        addUserTag(email, tag.trim());
        setNewTag('');
        setIsAdding(false);
    };

    return (
        <div className="bg-white p-6 rounded-2xl border border-gray-200">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Tag size={20} className="text-ink-60" />
                Теги клиента
            </h3>

            <div className="flex flex-wrap gap-2 mb-4">
                {tags.length === 0 && !isAdding && (
                    <span className="text-ink-60 text-sm italic">Нет тегов</span>
                )}

                {tags.map(tag => {
                    const preset = PRESET_TAGS.find(p => p.name === tag);
                    const colorClass = preset ? preset.color : 'bg-gray-100 text-gray-700';
                    return (
                        <div key={tag} className={`px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1 ${colorClass}`}>
                            {tag}
                            <button
                                onClick={() => handleRemove(tag)}
                                aria-label={`Убрать тег «${tag}»`}
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
                            className="px-3 py-1 rounded-full border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green w-32"
                            placeholder="Название..."
                            aria-label="Новый тег"
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
                    <span className="text-xs text-ink-60 w-full">Быстрый выбор:</span>
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
