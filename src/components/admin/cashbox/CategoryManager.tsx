import { useState } from 'react';
import { Plus, ChevronDown, ChevronRight, Pencil, Check, X, Trash2, ArrowDownLeft, ArrowUpRight, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';
import type { ExpenseCategory } from '../../../api/cashbox';

const TYPE_LABELS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    // Цвет — только статусные токены: приход «ок», расход «опасно», оба — нейтрально.
    income: { label: 'Приход', color: 'bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] border-[var(--status-ok-fg)]/30', icon: ArrowDownLeft },
    expense: { label: 'Расход', color: 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] border-[var(--status-danger-fg)]/30', icon: ArrowUpRight },
    both: { label: 'Приход и расход', color: 'bg-[var(--status-muted-bg)] text-[var(--status-muted-fg)] border-[var(--status-muted-fg)]/30', icon: Repeat },
};

export function CategoryManager() {
    const { categories, createCategory, updateCategory, deleteCategory } = useCashboxStore();
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [addingTo, setAddingTo] = useState<string | null>(null);
    const [newName, setNewName] = useState('');
    const [newType, setNewType] = useState<'income' | 'expense' | 'both'>('expense');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [showAddRoot, setShowAddRoot] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');

    const toggleExpand = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleAdd = async (parentId?: string) => {
        if (!newName.trim()) return;
        try {
            await createCategory({ name: newName.trim(), parent_id: parentId, category_type: newType } as any);
            toast.success('Категория создана');
            setNewName('');
            setAddingTo(null);
            setShowAddRoot(false);
            if (parentId) setExpanded(prev => new Set(prev).add(parentId));
        } catch {
            toast.error('Не удалось создать категорию. Попробуйте ещё раз.');
        }
    };

    const handleEdit = async (id: string) => {
        if (!editName.trim()) return;
        try {
            await updateCategory(id, { name: editName.trim() });
            toast.success('Переименовано');
            setEditingId(null);
        } catch {
            toast.error('Не удалось сохранить изменения. Попробуйте ещё раз.');
        }
    };

    const handleChangeType = async (cat: ExpenseCategory, newCatType: 'income' | 'expense' | 'both') => {
        try {
            await updateCategory(cat.id, { category_type: newCatType } as any);
            toast.success(`Тип изменён на «${TYPE_LABELS[newCatType].label}»`);
        } catch {
            toast.error('Не удалось сохранить изменения. Попробуйте ещё раз.');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteCategory(id);
            toast.success('Категория удалена');
            setConfirmDeleteId(null);
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(msg || 'Не удалось удалить категорию');
            setConfirmDeleteId(null);
        }
    };

    const handleToggleActive = async (cat: ExpenseCategory) => {
        try {
            await updateCategory(cat.id, { is_active: !cat.isActive });
            toast.success(cat.isActive ? 'Скрыта' : 'Активирована');
        } catch {
            toast.error('Не удалось сохранить изменения. Попробуйте ещё раз.');
        }
    };

    const filteredCategories = filterType === 'all'
        ? categories
        : categories.filter(c => c.categoryType === filterType || c.categoryType === 'both');

    const renderCategory = (cat: ExpenseCategory, depth = 0) => {
        const hasChildren = cat.children && cat.children.length > 0;
        const isExpanded = expanded.has(cat.id);
        const isEditing = editingId === cat.id;
        const isAddingSub = addingTo === cat.id;
        const isConfirmingDelete = confirmDeleteId === cat.id;
        const catType = cat.categoryType || 'expense';
        const typeInfo = TYPE_LABELS[catType] || TYPE_LABELS.expense;

        return (
            <div key={cat.id}>
                <div
                    className={`flex items-center gap-2 px-3 py-2.5 hover:bg-white rounded-lg transition-colors group ${!cat.isActive ? 'opacity-40' : ''}`}
                    style={{ paddingLeft: `${12 + depth * 24}px` }}
                >
                    {depth === 0 ? (
                        <button
                            onClick={() => toggleExpand(cat.id)}
                            aria-label={isExpanded ? 'Свернуть' : 'Развернуть'}
                            aria-expanded={isExpanded}
                            className="text-ink-60 hover:text-gray-600 w-4 flex-shrink-0"
                        >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                    ) : (
                        <span className="w-4 flex-shrink-0 text-ink-30 text-xs select-none" aria-hidden="true">└</span>
                    )}

                    {isEditing ? (
                        <div className="flex items-center gap-1.5 flex-1">
                            <input
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleEdit(cat.id); if (e.key === 'Escape') setEditingId(null); }}
                                className="flex-1 px-2 py-1 text-sm border border-unbox-green/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-unbox-green"
                                autoFocus
                            />
                            <button onClick={() => handleEdit(cat.id)} aria-label="Сохранить название" className="text-[var(--status-ok-fg)] hover:brightness-90 p-0.5"><Check size={14} /></button>
                            <button onClick={() => setEditingId(null)} aria-label="Не сохранять" className="text-ink-60 hover:text-gray-600 p-0.5"><X size={14} /></button>
                        </div>
                    ) : isConfirmingDelete ? (
                        <div className="flex items-center gap-2 flex-1">
                            <span className="text-sm text-[var(--status-danger-fg)] flex-1">Удалить «{cat.name}»?</span>
                            <button
                                onClick={() => handleDelete(cat.id)}
                                className="px-2 py-0.5 rounded text-xs bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] hover:brightness-95 font-medium"
                            >
                                Удалить категорию
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)} aria-label="Оставить категорию" className="p-0.5 text-ink-60 hover:text-gray-600"><X size={14} /></button>
                        </div>
                    ) : (
                        <>
                            <span className="text-sm mr-0.5">{cat.icon}</span>
                            <span className={`text-sm flex-1 ${depth === 0 ? 'font-medium text-gray-800' : 'text-gray-600'}`}>
                                {cat.name}
                            </span>

                            {/* Type badge */}
                            <select
                                value={catType}
                                onChange={e => handleChangeType(cat, e.target.value as any)}
                                className={`text-xs font-medium px-1.5 py-0.5 rounded-full border cursor-pointer appearance-none text-center ${typeInfo.color}`}
                                title="Тип категории"
                            >
                                <option value="income">Приход</option>
                                <option value="expense">Расход</option>
                                <option value="both">Приход и расход</option>
                            </select>

                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                                <button
                                    onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}
                                    className="p-1.5 text-ink-60 hover:text-unbox-green rounded"
                                    title="Переименовать"
                                    aria-label="Переименовать"
                                >
                                    <Pencil size={12} />
                                </button>
                                {depth === 0 && (
                                    <button
                                        onClick={() => { setAddingTo(cat.id); setNewName(''); setExpanded(prev => new Set(prev).add(cat.id)); }}
                                        className="p-1.5 text-ink-60 hover:text-unbox-green rounded"
                                        title="Добавить подкатегорию"
                                        aria-label="Добавить подкатегорию"
                                    >
                                        <Plus size={12} />
                                    </button>
                                )}
                                <button
                                    onClick={() => handleToggleActive(cat)}
                                    className={`px-1.5 py-0.5 rounded text-xs font-medium ${cat.isActive ? 'text-ink-60 hover:text-ink' : 'text-[var(--status-ok-fg)] hover:brightness-90'}`}
                                >
                                    {cat.isActive ? 'Скрыть' : 'Вкл'}
                                </button>
                                <button
                                    onClick={() => setConfirmDeleteId(cat.id)}
                                    className="p-1.5 text-ink-60 hover:text-[var(--status-danger-fg)] rounded"
                                    title="Удалить"
                                    aria-label="Удалить категорию"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {isExpanded && hasChildren && cat.children.map(child => renderCategory(child, depth + 1))}

                {isAddingSub && (
                    <div className="flex items-center gap-1.5 py-1.5 pr-3" style={{ paddingLeft: `${40 + depth * 24}px` }}>
                        <input
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAdd(cat.id); if (e.key === 'Escape') setAddingTo(null); }}
                            placeholder="Подкатегория..."
                            className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-unbox-green"
                            autoFocus
                        />
                        <button onClick={() => handleAdd(cat.id)} aria-label="Добавить подкатегорию" className="text-[var(--status-ok-fg)] hover:brightness-90"><Check size={14} /></button>
                        <button onClick={() => setAddingTo(null)} aria-label="Не добавлять" className="text-ink-60 hover:text-gray-600"><X size={14} /></button>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <p className="text-xs text-ink-60 mr-2">Фильтр:</p>
                    {(['all', 'income', 'expense'] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setFilterType(t)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                                filterType === t
                                    ? 'bg-unbox-green text-white'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                        >
                            {t === 'all' ? 'Все' : (() => {
                                const Icon = TYPE_LABELS[t].icon;
                                return <span className="inline-flex items-center gap-1"><Icon size={12} aria-hidden="true" />{TYPE_LABELS[t].label}</span>;
                            })()}
                        </button>
                    ))}
                </div>
                <button
                    onClick={() => { setShowAddRoot(true); setNewName(''); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-unbox-green text-white text-xs font-medium hover:bg-unbox-green/90 transition-colors"
                >
                    <Plus size={13} />
                    Добавить категорию
                </button>
            </div>

            <div className="bg-gray-50/80 rounded-2xl border border-gray-100 overflow-hidden">
                {filteredCategories.length === 0 && !showAddRoot ? (
                    <div className="text-center py-10 text-ink-60 text-sm">Категорий пока нет</div>
                ) : (
                    <div className="py-2 px-2 divide-y divide-gray-100/50">
                        {filteredCategories.map(cat => renderCategory(cat))}
                    </div>
                )}

                {showAddRoot && (
                    <div className="flex items-center gap-1.5 px-4 py-3 border-t border-gray-200">
                        <select
                            value={newType}
                            onChange={e => setNewType(e.target.value as any)}
                            className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-unbox-green"
                        >
                            <option value="income">Приход</option>
                            <option value="expense">Расход</option>
                            <option value="both">Приход и расход</option>
                        </select>
                        <input
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setShowAddRoot(false); setNewName(''); } }}
                            placeholder="Название категории..."
                            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-unbox-green"
                            autoFocus
                        />
                        <button onClick={() => handleAdd()} aria-label="Добавить категорию" className="text-[var(--status-ok-fg)] hover:brightness-90"><Check size={16} /></button>
                        <button onClick={() => { setShowAddRoot(false); setNewName(''); }} aria-label="Не добавлять" className="text-ink-60 hover:text-gray-600"><X size={16} /></button>
                    </div>
                )}
            </div>
        </div>
    );
}
